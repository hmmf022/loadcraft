# save_state / load_state にファイルパス対応を追加

## Context

MCP Server の `save_state` は JSON 文字列を返すだけで、ファイルに書き出す手段がない。LLM に「結果を保存して」と頼んだとき、1回のツール呼び出しで完結させたい。`load_state` も同様にファイルから直接読み込めるようにする。

## 変更ファイル

`src/mcp/tools/save.ts` のみ

## 変更内容

### save_state

- `filePath` (optional) パラメータを追加
- 指定あり: `fs.writeFile` で保存 → `{ success, filePath }` を返す
- 指定なし: 従来通り JSON 文字列を返す（後方互換）
- `writeFile` 失敗時は try/catch で `isError: true` を返す

### load_state

- `filePath` (optional) パラメータを追加（既存の `json` と排他）
- 指定あり: `fs.readFile` で読み込み → session.loadFromSaveData に渡す
- 指定なし: 従来通り `json` パラメータを使用
- 両方未指定 / 両方指定 → エラーを返す
- `readFile` 失敗時は try/catch で `isError: true` を返す

### import 追加

```typescript
import { writeFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
```

## 検証

1. `npm run build:mcp`
2. MCP ツールで `save_state({ filePath: "./test-layout.json" })` → ファイル生成確認
3. `load_state({ filePath: "./test-layout.json" })` → 状態復元確認
4. `save_state({})` → 従来通り JSON 文字列が返ることを確認
5. `npm test` → 既存テスト破壊なし
