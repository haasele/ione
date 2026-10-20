/**
 * Fractional indexing: keys are strings over a base-62 alphabet, compared
 * lexicographically. A key represents the fraction `0.<digits>` in base 62;
 * canonical keys are non-empty and never end in '0', so lexicographic order
 * matches numeric order.
 *
 * The midpoint algorithm is a compact adaptation of the CC0 `fractional-indexing`
 * reference implementation by Rocicorp (https://github.com/rocicorp/fractional-indexing),
 * itself derived from the "Jitter" scheme used by Figma. This variant drops the
 * integer-length prefix scheme and works on the fraction digits directly.
 */

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const BASE = DIGITS.length
/** Digit used when only a lower bound exists. */
const MID_DIGIT = Math.floor(BASE / 2)

function digitAt(key: string, index: number): number {
  if (index >= key.length) return 0
  return DIGITS.indexOf(key[index] as string)
}

function validateKey(key: string, label: string): string {
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  if (key[key.length - 1] === '0') {
    throw new Error(`${label} must not end with '0': ${key}`)
  }
  for (let i = 0; i < key.length; i += 1) {
    if (DIGITS.indexOf(key[i] as string) < 0) {
      throw new Error(`${label} contains an invalid digit: ${key}`)
    }
  }
  return key
}

/**
 * Returns a key strictly between `lower` and `upper`.
 * `lower` may be the empty string, meaning zero. `upper` null means +1
 * (i.e. only the lower bound applies).
 */
function midpoint(lower: string, upper: string | null): string {
  if (upper === null) {
    return lower + (DIGITS[MID_DIGIT] as string)
  }

  let index = 0
  for (;;) {
    const lowerDigit = digitAt(lower, index)
    const upperDigit = digitAt(upper, index)
    if (lowerDigit !== upperDigit) break
    index += 1
    if (index > Math.max(lower.length, upper.length)) {
      throw new Error(`Unable to find a midpoint between ${lower} and ${upper}`)
    }
  }

  const lowerDigit = digitAt(lower, index)
  const upperDigit = digitAt(upper, index)
  if (lowerDigit >= upperDigit) {
    throw new Error(`lower bound ${lower} is not below upper bound ${upper}`)
  }

  const prefix = lower.padEnd(index, '0')
  if (upperDigit - lowerDigit > 1) {
    const mid = lowerDigit + Math.floor((upperDigit - lowerDigit) / 2)
    return prefix + (DIGITS[mid] as string)
  }

  // Consecutive digits: keep the lower digit and extend its tail downward.
  const tail = lower.length > index + 1 ? lower.slice(index + 1) : ''
  return prefix + (DIGITS[lowerDigit] as string) + midpoint(tail, null)
}

/**
 * Generates a key strictly between `prev` and `next`.
 * Null means "no bound": `(null, null)` yields the initial key.
 */
export function generateKeyBetween(prev: string | null, next: string | null): string {
  const lower = prev === null ? null : validateKey(prev, 'prev')
  const upper = next === null ? null : validateKey(next, 'next')
  if (lower !== null && upper !== null && lower >= upper) {
    throw new Error(`prev must be less than next: ${lower} >= ${upper}`)
  }
  if (lower === null && upper === null) {
    return DIGITS[MID_DIGIT] as string
  }
  if (lower === null) {
    return midpoint('', upper)
  }
  if (upper === null) {
    return midpoint(lower, null)
  }
  return midpoint(lower, upper)
}

function generateNBetween(lower: string | null, upper: string | null, count: number): string[] {
  if (count === 0) return []
  if (count === 1) return [generateKeyBetween(lower, upper)]
  if (upper === null) {
    const keys: string[] = []
    let cursor = lower
    for (let i = 0; i < count; i += 1) {
      const key = generateKeyBetween(cursor, null)
      keys.push(key)
      cursor = key
    }
    return keys
  }

  const mid = Math.floor(count / 2)
  const pivot = generateKeyBetween(lower, upper)
  return [
    ...generateNBetween(lower, pivot, mid),
    pivot,
    ...generateNBetween(pivot, upper, count - mid - 1)
  ]
}

/**
 * Generates `count` keys strictly between `prev` and `next`, in ascending order.
 * A count of 0 returns an empty array; negative or fractional counts throw.
 */
export function generateNKeysBetween(
  prev: string | null,
  next: string | null,
  count: number
): string[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`count must be a non-negative integer: ${count}`)
  }
  if (count === 0) return []

  const lower = prev === null ? null : validateKey(prev, 'prev')
  const upper = next === null ? null : validateKey(next, 'next')
  if (lower !== null && upper !== null && lower >= upper) {
    throw new Error(`prev must be less than next: ${lower} >= ${upper}`)
  }
  return generateNBetween(lower, upper, count)
}
