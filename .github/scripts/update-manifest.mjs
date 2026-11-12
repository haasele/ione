#!/usr/bin/env node
/**
 * Generate the release's update-manifest.json (schema v1, see src/shared/updates.ts) and, when
 * UPDATE_MANIFEST_SIGNING_KEY is set, update-manifest.json.sig for the exact manifest bytes.
 *
 * Inputs (environment):
 *   VERSION       required, semver without the leading v (0.5.87, 0.5.87-nightly.123)
 *   TAG           optional, must be v<VERSION>; defaults to v<VERSION>
 *   REPOSITORY    optional, owner/repo; defaults to haasele/ione
 *   COMMIT        optional, the release commit
 *   PRERELEASE    optional, true/false; defaults to whether VERSION has a prerelease suffix
 *   DIST_DIR      optional, directory holding the packages and latest*.yml feeds; defaults to dist
 *   NOTES_FILE    optional, markdown to embed as the manifest's `notes`
 *   UPDATE_MANIFEST_SIGNING_KEY
 *                 optional, an ed25519 private key as PEM or base64 (PEM or PKCS#8 DER)
 *
 * Only asset kinds the app can install are listed: NSIS .exe, macOS .dmg/.zip, Linux
 * .AppImage/.deb and Android .apk. MSI, rpm, Flatpak and the portable Windows ZIP are published
 * on the release but deliberately omitted from the manifest rather than assigned a wrong kind.
 */
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const DEFAULT_REPOSITORY = 'haasele/ione'

function fail(message) {
  console.error(`update-manifest: ${message}`)
  process.exit(1)
}

function parseBoolean(value) {
  if (value === undefined) return null
  const text = value.trim().toLowerCase()
  if (text === '') return null
  if (text === 'true' || text === '1' || text === 'yes') return true
  if (text === 'false' || text === '0' || text === 'no') return false
  fail(`PRERELEASE must be true or false, not "${value}"`)
}

function archOf(name, fallback) {
  if (/(?:^|[-_.])(arm64|aarch64)(?:[-_.]|$)/i.test(name)) return 'arm64'
  if (/(?:^|[-_.])(x64|x86_64|amd64)(?:[-_.]|$)/i.test(name)) return 'x64'
  if (/(?:^|[-_.])universal(?:[-_.]|$)/i.test(name)) return 'universal'
  return fallback
}

function kindOf(name) {
  const lower = name.toLowerCase()
  if (lower.endsWith('.exe')) {
    return /-setup\.exe$/.test(lower) ? { os: 'windows', arch: archOf(name, 'x64'), kind: 'nsis' } : null
  }
  if (lower.endsWith('.dmg')) {
    return { os: 'macos', arch: archOf(name, 'universal'), kind: 'dmg' }
  }
  if (lower.endsWith('.zip')) {
    // The Windows portable build is a zip that the app cannot update in place; only macOS
    // updater zips (named with an architecture) belong in the manifest.
    if (/-portable\.zip$/.test(lower)) return null
    if (!/-(x64|arm64|universal)\.zip$/i.test(name)) return null
    return { os: 'macos', arch: archOf(name, 'universal'), kind: 'zip' }
  }
  if (lower.endsWith('.appimage')) {
    return { os: 'linux', arch: archOf(name, 'x64'), kind: 'appimage' }
  }
  if (lower.endsWith('.deb')) {
    return { os: 'linux', arch: archOf(name, 'x64'), kind: 'deb' }
  }
  if (lower.endsWith('.apk')) {
    // One APK carries all Android ABIs.
    return { os: 'android', arch: 'universal', kind: 'apk' }
  }
  return null
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await listFiles(path)))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

function sha256File(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolveHash(hash.digest('hex')))
  })
}

function loadPrivateKey(raw) {
  const text = raw.trim()
  let key
  try {
    if (text.includes('-----BEGIN')) {
      key = createPrivateKey({ key: text, format: 'pem' })
    } else {
      const der = Buffer.from(text.replace(/\s+/g, ''), 'base64')
      if (der.length === 0) throw new Error('the value is not PEM or base64')
      const decoded = der.toString('utf8')
      key = decoded.includes('-----BEGIN')
        ? createPrivateKey({ key: decoded, format: 'pem' })
        : createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
    }
  } catch (error) {
    fail(
      `UPDATE_MANIFEST_SIGNING_KEY is not a valid ed25519 private key: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    fail(`UPDATE_MANIFEST_SIGNING_KEY is a ${key.asymmetricKeyType} key, not ed25519`)
  }
  return key
}

async function main() {
  const rawVersion = (process.env.VERSION ?? '').trim().replace(/^v/, '')
  const versionMatch = SEMVER.exec(rawVersion)
  if (!versionMatch) fail(`VERSION "${process.env.VERSION ?? ''}" is not semver`)
  const version = rawVersion
  const hasPrerelease = versionMatch[4] !== undefined

  const tagInput = (process.env.TAG ?? '').trim()
  const tag = tagInput || `v${version}`
  if (tag !== `v${version}`) fail(`TAG "${tag}" must be v${version}`)

  const repository = (process.env.REPOSITORY ?? '').trim() || DEFAULT_REPOSITORY
  if (!REPOSITORY.test(repository)) fail(`REPOSITORY "${repository}" is not owner/repo`)

  const commit = (process.env.COMMIT ?? '').trim()

  const envPrerelease = parseBoolean(process.env.PRERELEASE)
  if (hasPrerelease && envPrerelease === false) {
    fail(`VERSION "${version}" has a prerelease suffix but PRERELEASE is false`)
  }
  const prerelease = envPrerelease ?? hasPrerelease

  const distDir = resolve((process.env.DIST_DIR ?? '').trim() || 'dist')
  const distStat = await stat(distDir).catch(() => null)
  if (!distStat || !distStat.isDirectory()) fail(`DIST_DIR "${distDir}" is not a directory`)

  const notesFile = (process.env.NOTES_FILE ?? '').trim()
  let notes = ''
  if (notesFile) {
    notes = (await readFile(notesFile, 'utf8').catch((error) => {
      fail(`cannot read NOTES_FILE "${notesFile}": ${error instanceof Error ? error.message : error}`)
    })).trim()
  }

  const downloadBase = `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}`
  const releaseUrl = `https://github.com/${repository}/releases/tag/${encodeURIComponent(tag)}`

  const files = await listFiles(distDir)
  const assets = []
  const byName = new Map()
  const feedPaths = new Map()

  for (const path of files) {
    const name = basename(path)
    const kind = kindOf(name)
    if (!kind) continue
    if (byName.has(name)) {
      fail(`duplicate asset name "${name}" (${byName.get(name)} and ${path})`)
    }
    const info = await stat(path)
    if (info.size <= 0) fail(`asset "${name}" is empty`)
    const asset = {
      os: kind.os,
      arch: kind.arch,
      kind: kind.kind,
      name,
      url: `${downloadBase}/${encodeURIComponent(name)}`,
      size: info.size,
      sha256: await sha256File(path),
      signed: false
    }
    byName.set(name, path)
    assets.push(asset)
  }

  for (const path of files) {
    const name = basename(path)
    if (name !== 'latest.yml' && name !== 'latest-linux.yml' && name !== 'latest-mac.yml') continue
    if (feedPaths.has(name)) fail(`duplicate feed name "${name}"`)
    feedPaths.set(name, path)
  }

  if (assets.length === 0) {
    fail(
      'found no supported packages (NSIS .exe, macOS .dmg/.zip, Linux .AppImage/.deb, Android .apk)'
    )
  }
  assets.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

  const oses = new Set(assets.map((asset) => asset.os))
  const feedSpecs = [
    { file: 'latest.yml', key: 'windows-x64', os: 'windows' },
    { file: 'latest-linux.yml', key: 'linux-x64', os: 'linux' },
    { file: 'latest-mac.yml', key: 'macos', os: 'macos' }
  ]
  const feeds = {}
  for (const spec of feedSpecs) {
    const exists = feedPaths.has(spec.file)
    const applicable = oses.has(spec.os)
    if (exists && !applicable) fail(`feed ${spec.file} has no ${spec.os} packages`)
    if (applicable && !exists) fail(`missing electron-updater feed ${spec.file} for ${spec.os} packages`)
    if (exists) feeds[spec.key] = `${downloadBase}/${encodeURIComponent(spec.file)}`
  }

  const manifest = {
    schemaVersion: 1,
    name: 'Ione',
    version,
    tag,
    prerelease,
    publishedAt: new Date().toISOString(),
    commit,
    releaseUrl,
    notesUrl: releaseUrl,
    checksumsUrl: `${downloadBase}/SHA256SUMS.txt`,
    assets,
    feeds
  }
  if (notes) manifest.notes = notes

  const manifestPath = join(distDir, 'update-manifest.json')
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`
  await writeFile(manifestPath, manifestText, 'utf8')
  console.log(manifestPath)

  const signingKey = (process.env.UPDATE_MANIFEST_SIGNING_KEY ?? '').trim()
  if (!signingKey) {
    console.log('UPDATE_MANIFEST_SIGNING_KEY is not set; wrote an unsigned manifest')
    return
  }
  const privateKey = loadPrivateKey(signingKey)
  const spki = createPublicKey(privateKey).export({ type: 'spki', format: 'der' })
  const publicKey = spki.subarray(spki.length - 32)
  if (publicKey.length !== 32) fail('the signing key did not yield a raw 32-byte ed25519 public key')
  const signature = sign(null, Buffer.from(manifestText, 'utf8'), privateKey)
  const envelope = {
    algorithm: 'ed25519',
    publicKey: publicKey.toString('base64'),
    signature: signature.toString('base64')
  }
  const signaturePath = join(distDir, 'update-manifest.json.sig')
  await writeFile(signaturePath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8')
  console.log(signaturePath)
}

await main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
