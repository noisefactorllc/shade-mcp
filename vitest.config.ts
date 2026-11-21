import { defineConfig } from 'vitest/config'
import { createRequire } from 'node:module'

const { version } = createRequire(import.meta.url)('./package.json') as { version: string }

export default defineConfig({
  // Mirrors tsup.config.ts so src/version.ts resolves the same way under test
  // as it does in the build. Both read package.json, which stays the source.
  define: { __SHADE_VERSION__: JSON.stringify(version) },
  test: {
    reporters: ['default', './scripts/strict-test-reporter.mjs'],
    allowOnly: !process.env.CI,
    passWithNoTests: false,
  },
})
