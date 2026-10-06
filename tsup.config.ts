import { defineConfig } from 'tsup'
import { createRequire } from 'node:module'

const { version } = createRequire(import.meta.url)('./package.json') as { version: string }

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'harness/index': 'src/harness/index.ts',
    'formats/index': 'src/formats/index.ts',
    'ai/provider': 'src/ai/provider.ts',
    'analysis/index': 'src/analysis/index.ts',
    'knowledge/index': 'src/knowledge/index.ts',
  },
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  // noisemaker and portable vendor dist/harness, dist/ai and dist/analysis as
  // a plain file drop and import them directly — no npm install of this
  // package, so nothing resolves shade-mcp's own dependencies. tsup leaves
  // anything listed in `dependencies` as a bare import, which means declaring
  // zod as a direct dependency in 0.2.0 silently turned `import { z } from
  // "zod"` into an unresolvable specifier for both of them and broke
  // noisemaker's shader test run. Bundling it keeps the drop self-contained.
  //
  // playwright, openai and @anthropic-ai/sdk stay external on purpose: they
  // are large, and the consumers already supply them (noisemaker has
  // playwright, and it defers the two AI SDKs behind a dynamic import so a
  // run without AI keys never reaches them). scripts/check-dist-externals.mjs
  // holds that contract.
  noExternal: ['zod', 'acorn'],
  // Declarations are emitted by `tsc --emitDeclarationOnly`, not by tsup.
  //
  // tsup generates .d.ts via rollup-plugin-dts, which imports the TypeScript
  // compiler API from the `typescript` main entry. TypeScript 7 is the native
  // port: its package exports map resolves "." to ./lib/version.cjs, which
  // exports only { version, versionMajorMinor }. `ts.sys` is undefined there,
  // so rollup-plugin-dts dies with
  //   TypeError: Cannot read properties of undefined
  //     (reading 'useCaseSensitiveFileNames')
  // That is an intentional API removal, not a bug awaiting a tsup patch —
  // the compiler API now lives behind `typescript/unstable/*`.
  //
  // tsup's JS output goes through esbuild and needs no TypeScript API, so it
  // works fine on 7.x. See the `build` script for the declaration step.
  dts: false,
  // src/version.ts reads this instead of the file, so the drop carries its
  // own version and reaches for nothing above dist/.
  define: { __SHADE_VERSION__: JSON.stringify(version) },
})
