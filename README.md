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

## License

[MIT](LICENSE)
