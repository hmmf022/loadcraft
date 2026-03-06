import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/mcp-editor/main.ts'],
  outDir: 'dist-mcp-editor',
  format: 'esm',
  platform: 'node',
  target: 'node20',
  bundle: true,
  banner: { js: '#!/usr/bin/env node' },
  external: [],
  noExternal: [/(.*)/],
  clean: true,
})
