import { resolve } from 'node:path'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'

const coreEntry = resolve(__dirname, '../../packages/core/src/index.ts')

const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'"
]

function cspPlugin(): Plugin {
  return {
    name: 'ione-csp',
    transformIndexHtml(html, context) {
      const directives = [...CSP_DIRECTIVES]
      directives.push(
        context.server
          ? "connect-src 'self' ws: wss: http://localhost:* http://127.0.0.1:*"
          : "connect-src 'self'"
      )
      return html.replace(
        '<!-- ione-csp -->',
        `<meta http-equiv="Content-Security-Policy" content="${directives.join('; ')}" />`
      )
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@ione/core'] })],
    resolve: { alias: { '@ione/core': coreEntry } }
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@ione/core'] })],
    resolve: { alias: { '@ione/core': coreEntry } }
  },
  renderer: {
    resolve: { alias: { '@ione/core': coreEntry } },
    plugins: [svelte(), cspPlugin()]
  }
})

