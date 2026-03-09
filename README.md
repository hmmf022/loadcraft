# LoadCraft

Container loading simulator with WebGPU 3D visualization.

> [日本語版 README はこちら](README.ja.md)

## Features

- **3D WebGPU rendering** — Real-time instanced drawing with WGSL shaders
- **Drag & drop placement** — Place cargo from the sidebar into the container
- **Collision detection** — 1 cm voxel-resolution overlap checking
- **Weight & stability analysis** — Total weight, center of gravity deviation, support ratio
- **Undo / Redo** — Full command-pattern history
- **Save / Load** — JSON project files, CSV/JSON cargo import
- **Camera presets** — Front / Back / Left / Right / Top / Iso + free orbit
- **Grid snap** — 1 / 5 / 10 cm snap options
- **Responsive layout** — Desktop sidebar + mobile hamburger menu
- **Voxel Shape Editor** — Minecraft-style block editor for composite cargo shapes
- **Auto-pack failure reasons** — UI and MCP return detailed reason codes for unplaceable items

## Requirements

- Node.js (compatible with Vite 7.x)
- WebGPU-capable browser (Chrome 113+, Edge 113+, etc.)

## Getting Started

```bash
git clone https://github.com/<your-username>/loadcraft.git
cd loadcraft
npm install
npm run dev
```

- Simulator: `http://localhost:5173/`
- Shape Editor: `http://localhost:5173/editor.html`

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server |
| `npm run build` | TypeScript check + production build |
| `npm run lint` | ESLint |
| `npm test` | Run all tests (Vitest) |

## Tech Stack

WebGPU + WGSL, React 19, Zustand, TypeScript, Vite

## Architecture

Three-layer design — UI, Core, and Renderer are cleanly separated.

```
UI (React + Zustand)  →  Core (VoxelGrid, Physics)  →  Renderer (WebGPU)
```

- **Core** (`src/core/`) — Data layer. VoxelGrid, collision detection, weight/gravity analysis, history, save/load, import/export. No DOM or GPU dependencies.
- **Renderer** (`src/renderer/`) — WebGPU rendering. Shaders, camera, pipelines. No React dependencies.
- **UI + State** (`src/ui/`, `src/state/`) — React components + Zustand store. The store is the single source of truth.

## Project Structure

```
src/
├── core/           # VoxelGrid, Voxelizer, History, WeightCalculator, ...
├── renderer/       # WebGPU Renderer, Camera, Raycaster, Pipelines, Shaders
├── state/          # Zustand store
├── ui/             # React components (App, Sidebar, ToolBar, StatsPanel, ...)
├── editor/         # Voxel Shape Editor (separate entry point)
│   ├── renderer/   # Editor-specific WebGPU renderer
│   ├── state/      # Editor reducer + history
│   └── ui/         # Editor UI components
└── main.tsx        # Simulator entry point
docs/               # Design documents (Japanese)
editor.html         # Shape Editor HTML entry
```

## MCP Server (Docker)

The two MCP servers (simulator / editor) can be run via Docker. Since tsup bundles all dependencies into a single JS file, the runtime image only needs Node.js + two JS files.

```bash
# Build
docker build -t loadcraft-mcp .

# Test simulator MCP
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | docker run --rm -i loadcraft-mcp

# Test editor MCP
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | docker run --rm -i loadcraft-mcp node dist-mcp-editor/main.js
```

### `.mcp.json` example

```json
{
  "mcpServers": {
    "loadcraft": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "loadcraft-mcp"]
    },
    "loadcraft-editor": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "loadcraft-mcp", "node", "dist-mcp-editor/main.js"]
    }
  }
}
```

Add `-v ./data:/data` to `args` for file persistence (save/load).

`auto_pack` MCP tool responses include `failureReasons` with reason codes for unplaced items.
MCP shape import/export uses fixed 1cm blocks (`gridSize` must be `1`); editor display scaling is UI-only and not part of MCP data.

## License

[MIT](LICENSE)
