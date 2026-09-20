# 石板回し 試作プレビュー

このフォルダは、会話で作ったプレイ可能版を**試作**として置いたものです。

公式の実装は、`docs/planning/PR_ROADMAP.md` の6件のPull Requestで進めます。この試作は `feat/01-stone-ring-core` の代わりではありません。

## 含まれるもの

- 12方向・可動環3本の光線判定
- 初級30問・中級30問・上級30問の合計90問
- 抽選券900件
- SVG石板盤面、5問チャレンジ、練習、遊び方
- 端末内の記録検証（操作履歴の再生）
- ファビコン、シェアカード、X用バナー
- 試作の順位表定義（プレビュー用。本番Supabaseではない）

画面記録は [`docs/prototype/screenshots/`](../docs/prototype/screenshots/) です。何を入れて、何を入れなかったかは [`docs/prototype/UPLOAD_INVENTORY.md`](../docs/prototype/UPLOAD_INVENTORY.md) を見てください。

## 含めていないもの

- 本番のSupabase / Edge Function
- GitHub Pagesの公開Workflow
- 実験場への掲載
- プレビュー環境専用の認証・PWAコード

記録は端末の `localStorage` にだけ残します。試作のランキングは公開順位ではありません。

## 動かし方

```bash
cd prototype
npm install
npm test
npm run typecheck
npm run build
npm run dev
```

## 試作時点の検査

- `npm test` — 規則、符号化13,824件、90問の再生、抽選券900件
- `npm run typecheck`
- `npm run build`

iPhone実機での確認は未実施です。
