# loadcraft-autopack

LoadCraft の autopack アルゴリズム (`src/core/AutoPacker.ts`) を Rust に移植したスタンドアロン CLI。
MCP サーバーから子プロセスとして呼び出すことで、ブラウザ/Node.js 実行より高速に積載計算を行う。

## ビルド

```bash
cd rust/autopack
cargo build --release
```

バイナリは `rust/autopack/target/release/loadcraft-autopack` に生成される。

## テスト

```bash
cargo test          # ユニットテスト (24) + 統合テスト (8)
cargo test -- --nocapture  # 出力表示付き
```

## CLI

```
loadcraft-autopack [OPTIONS] [INPUT_FILE]

引数:
  [INPUT_FILE]           SaveData JSON パス (省略または "-" で stdin)

オプション:
  -m, --mode <MODE>      "repack" | "pack_staged"  [default: repack]
  -t, --timeout <MS>     タイムアウト (ms)          [default: 30000]
  -s, --strategy <STR>   default|layer|wall|lff    [default: default]
  -o, --output <FILE>    出力パス (省略で stdout)
  -p, --pretty           JSON 整形出力
  -h, --help             ヘルプ表示
```

### 使用例

```bash
# stdin から読み込み、stdout に出力
cat state.json | loadcraft-autopack -m repack -t 10000

# ファイル指定、pretty 出力
loadcraft-autopack state.json -m repack --pretty

# pack_staged モード (既存配置を保持して追加分のみ配置)
loadcraft-autopack state.json -m pack_staged -t 20000 -o result.json
```

### 入力形式 (SaveData JSON)

`save_state` / `load_state` MCP ツールと同じ形式:

```json
{
  "version": 1,
  "container": {
    "widthCm": 590,
    "heightCm": 239,
    "depthCm": 235,
    "maxPayloadKg": 28200
  },
  "cargoDefs": [
    {
      "id": "box-a",
      "name": "Box A",
      "widthCm": 100,
      "heightCm": 50,
      "depthCm": 80,
      "weightKg": 15,
      "color": "#FF0000",
      "noFlip": false,
      "noStack": false,
      "maxStackWeightKg": 100
    }
  ],
  "placements": [],
  "nextInstanceId": 1,
  "stagedItems": [
    { "cargoDefId": "box-a", "count": 3 }
  ]
}
```

### 出力形式

```json
{
  "success": true,
  "placements": [
    {
      "instanceId": 1,
      "cargoDefId": "box-a",
      "positionCm": { "x": 0.0, "y": 0.0, "z": 0.0 },
      "rotationDeg": { "x": 0.0, "y": 0.0, "z": 0.0 }
    }
  ],
  "nextInstanceId": 4,
  "failedDefIds": [],
  "failureReasons": [],
  "stagedItems": []
}
```

## モード

| モード | 説明 |
|--------|------|
| `repack` | 既存 placements + staged items を全てクリアし、ゼロから再配置 |
| `pack_staged` | 既存 placements を保持し、staged items のみ追加配置 |

## 戦略 (strategy)

| 戦略 | 説明 |
|------|------|
| `default` | スコアリングベースの単一パス。床・奥壁・サポート率を重視 |
| `layer` | 同種アイテムを水平レイヤーに積層 (repack のみ有効) |
| `wall` | George-Robinson 法で奥壁から垂直壁を構築 (repack のみ有効) |
| `lff` | Less Flexibility First — 配置自由度が低いアイテムから先に配置 |

> MCP integration では常に `default` が使用される。`--strategy` はスタンドアロン利用向け。

## MCP 連携

環境変数 `AUTOPACK_RUST_BIN` にバイナリパスを設定すると、MCP の `auto_pack` ツールが Rust バイナリを使用する。
未設定の場合は既存の TypeScript 実装にフォールバック。

```bash
# Rust バイナリを使用して MCP サーバーを起動
AUTOPACK_RUST_BIN=./rust/autopack/target/release/loadcraft-autopack npm run mcp:dev
```

## アーキテクチャ

```
src/
  main.rs              CLI エントリポイント (clap)
  types.rs             型定義 (SaveData, PlacedCargo, etc.)
  voxelizer.rs         回転行列 (Y-X-Z Euler), AABB 計算
  occupancy_map.rs     2D 高さマップ (u16, 10cm セル)
  stack_checker.rs     積み重ね制約チェック (支持グラフ, 重量キャッシュ)
  auto_packer.rs       4 戦略の配置アルゴリズム
```

### CLI の責務範囲

- 純粋なアルゴリズム計算のみ。VoxelGrid への書き込みは `session.ts` 側の責務。
- History/Undo は `session.ts` 側。CLI は PackResult を返すだけ。
- voxelizeResults は出力に含めない。`session.ts` が結果を受けた後、必要なら自前で voxelize する。

### 制約

- **最大アイテム数**: 500 (超過時は即エラー)
- **タイムアウト**: `--timeout` で指定 (デフォルト 30 秒)
- **座標単位**: 全て cm
