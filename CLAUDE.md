# CLAUDE.md

## Commands

```bash
npm run dev          # Vite dev server (COOP/COEP enabled for SharedArrayBuffer)
npm run build        # tsc -b && vite build
npm run lint         # ESLint
npm test             # vitest run
npm run test:watch   # vitest watch
npx vitest run src/core/__tests__/VoxelGrid.test.ts  # single test file example
```

Voxel Shape Editor: `http://localhost:5173/editor.html` (separate Vite entry point)

MCP Simulator server:
```bash
npm run build:mcp    # tsup → dist-mcp/main.js
npm run mcp          # run built server
npm run mcp:dev      # tsx dev run
```

MCP Editor server:
```bash
npm run build:mcp-editor  # tsup → dist-mcp-editor/main.js
npm run mcp-editor        # run built server
npm run mcp-editor:dev    # tsx dev run
```

## TypeScript Constraints

- `erasableSyntaxOnly: true` — No constructor parameter properties. Use class fields instead.
- `noUncheckedIndexedAccess: true` — Index access returns `T | undefined`. Use `!` when the index is known valid.
- WGSL shaders: import with `?raw` suffix (e.g. `import shader from './foo.wgsl?raw'`).

## Architecture Rules

- **Dependency constraints**: Core (`src/core/`) must not import DOM, GPU, or React. Renderer (`src/renderer/`) must not import React.
- **VoxelGrid** is a mutable singleton (`src/core/voxelGridSingleton.ts`), living outside the Zustand store (too large for immutable state). It must be initialized in `main.tsx` before React mounts.
- **renderVersion** (`src/state/store.ts`): increment triggers Renderer GPU buffer rebuild via non-React subscription.
- **Units**: all coordinates and dimensions are in centimeters.

## References

Detailed design specs are in `docs/`.
