# LoadCraft

WebGPU 3D ビジュアライゼーションによるコンテナ積載シミュレータ。

> [English README](README.md)

## 機能

- **3D WebGPU レンダリング** — WGSL シェーダによるリアルタイムインスタンス描画
- **ドラッグ＆ドロップ配置** — サイドバーからコンテナへ荷物を配置
- **衝突判定** — 1cm ボクセル精度のオーバーラップ検出
- **重量・安定性分析** — 総重量、重心偏差、支持率の算出
- **Undo / Redo** — コマンドパターンによる完全な履歴管理
- **Save / Load** — JSON プロジェクトファイル、CSV/JSON 荷物インポート
- **カメラプリセット** — Front / Back / Left / Right / Top / Iso + 自由回転
- **グリッドスナップ** — 1 / 5 / 10 cm のスナップ切替
- **レスポンシブ対応** — デスクトップサイドバー + モバイルハンバーガーメニュー
- **ボクセルシェイプエディタ** — Minecraft 風ブロックエディタで複合形状の荷物を作成
- **自動積載失敗理由** — 配置不可アイテムの理由コードを UI と MCP の両方で確認可能

## 必要環境

- Node.js（Vite 7.x 対応版）
- WebGPU 対応ブラウザ（Chrome 113+, Edge 113+ など）

## はじめに

```bash
git clone https://github.com/<your-username>/loadcraft.git
cd loadcraft
npm install
npm run dev
```

- シミュレータ: `http://localhost:5173/`
- シェイプエディタ: `http://localhost:5173/editor.html`

## スクリプト

| コマンド | 説明 |
|---|---|
| `npm run dev` | 開発サーバー起動 |
| `npm run build` | 型チェック + プロダクションビルド |
| `npm run lint` | ESLint |
| `npm test` | テスト実行（Vitest） |

## 技術スタック

WebGPU + WGSL, React 19, Zustand, TypeScript, Vite

## アーキテクチャ

3層構造 — UI・Core・Renderer を分離。

```
UI (React + Zustand)  →  Core (VoxelGrid, Physics)  →  Renderer (WebGPU)
```

- **Core** (`src/core/`) — データ層。VoxelGrid、衝突判定、重量/重力分析、履歴、保存/読込、インポート/エクスポート。DOM・GPU 依存なし。
- **Renderer** (`src/renderer/`) — WebGPU 描画。シェーダ、カメラ、パイプライン。React 依存なし。
- **UI + State** (`src/ui/`, `src/state/`) — React コンポーネント + Zustand ストア。ストアが唯一の信頼源。

## プロジェクト構成

```
src/
├── core/           # VoxelGrid, Voxelizer, History, WeightCalculator, ...
├── renderer/       # WebGPU Renderer, Camera, Raycaster, Pipelines, Shaders
├── state/          # Zustand ストア
├── ui/             # React コンポーネント (App, Sidebar, ToolBar, StatsPanel, ...)
├── editor/         # ボクセルシェイプエディタ（別エントリポイント）
│   ├── renderer/   # エディタ専用 WebGPU レンダラー
│   ├── state/      # エディタ Reducer + 履歴
│   └── ui/         # エディタ UI コンポーネント
└── main.tsx        # シミュレータ エントリポイント
docs/               # 設計書
editor.html         # シェイプエディタ HTML エントリ
```

## MCP サーバー (Docker)

2 つの MCP サーバー（simulator / editor）を Docker で実行できます。tsup が全依存を単一 JS ファイルにバンドルするため、ランタイムイメージは Node.js + JS ファイル 2 つだけで動作します。

```bash
# ビルド
docker build -t loadcraft-mcp .

# simulator MCP テスト
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | docker run --rm -i loadcraft-mcp

# editor MCP テスト
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | docker run --rm -i loadcraft-mcp node dist-mcp-editor/main.js
```

### `.mcp.json` 設定例

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

ファイル永続化が必要な場合は `args` に `-v ./data:/data` を追加してください。

`auto_pack` MCP ツールは、配置できなかった荷物の理由コードを `failureReasons` で返します。

## ライセンス

[MIT](LICENSE)
