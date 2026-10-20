import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const coreEntry = fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@ione/core': coreEntry
    }
  },
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    pool: 'forks',
    testTimeout: 10_000
  }
})
