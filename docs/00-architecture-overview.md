# LoadCraft アーキテクチャ概要

## 1. 概要

LoadCraft は、WebGPU 3D 表示を使ったコンテナ積載シミュレータです。  
UI での対話操作（ドラッグ配置、回転、ドロップ）に加えて、MCP サーバー経由で同等の操作を自動化できます。

主要機能:

- コンテナ選択（20ft / 40ft / 40ft HC / カスタム）
- 貨物定義（直方体 + 複合ボクセル形状）
- 配置検証（境界、衝突、支持、上積み制約）
- 自動積載（`packStaged` / `repack`）
- 重量・重心・干渉・支持率の分析
- JSON Save/Load
- MCP サーバー（simulator / editor）

## 2. 層構造

```
UI (React) -> State (Zustand) -> Core (domain logic)
                             -> Renderer (WebGPU)
```

- `src/ui/`: React コンポーネント
- `src/state/`: Zustand ストア（単一の状態ソース）
- `src/core/`: 物理・配置・保存・解析ロジック（DOM/GPU 非依存）
- `src/renderer/`: WebGPU 描画エンジン
- `src/mcp/`: シミュレータ MCP サーバー
- `src/mcp-editor/`: 形状エディタ MCP サーバー

## 3. 重要データフロー

### 3.1 手動配置

1. UI 操作で `store` のアクションを呼び出す
2. `core` でボクセル化・衝突判定・境界判定を実施
3. `History` にコマンドを記録
4. `store` 更新を契機に UI と Renderer が再描画

### 3.2 自動積載

1. `autoPack` が候補姿勢と候補位置を探索
2. 各候補に対して以下を検証
   - コンテナ境界
   - 既存 AABB との干渉
   - 支持率（下部支持）
   - 上積み制約（`maxStackWeightKg` / `noStack`）
3. 合格候補をスコアリング
   - 重心偏差
   - 床面寄り配置
   - 奥壁寄り配置
   - 支持率
4. 最良候補を採用し、失敗時は理由コードを返す

失敗理由コード:

- `OUT_OF_BOUNDS`
- `NO_FEASIBLE_POSITION`
- `COLLISION`
- `NO_SUPPORT`
- `STACK_CONSTRAINT`

## 4. MCP インターフェース

- エントリ:
  - `src/mcp/main.ts`
  - `src/mcp-editor/main.ts`
- 通信方式: stdio
- `auto_pack` は結果として `placed`, `failed` に加えて `failureReasons` を返却

## 5. 開発スタック

- React 19
- TypeScript 5.9
- Vite 7
- Zustand 5
- Vitest 3
- ESLint 9
- Node.js 20（Docker でも利用）

