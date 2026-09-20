# 試作と公式計画の差

状態: 試作。公式仕様の正本は `docs/planning/IMPLEMENTATION_PLAN.md` です。

| 項目 | 公式計画 | この試作 |
|---|---|---|
| 置き場所 | リポジトリ直下の `src/` など | `prototype/` に隔離 |
| 競技抽選 | サーバーが抽選券を選ぶ | 端末内の暗号乱数 |
| ランキング | Supabaseで検証して上位10件 | 端末内のみ。表定義は `sql/leaderboard.preview.sql` |
| 未完了挑戦 | サーバーが同じ5問を返す | 端末内の `localStorage` |
| パッケージ | PR1で固定 | Vite 6 + React 19 + Tailwind 4 |
| UI部品 | 使わない | lucide は使わず、インラインSVG |
| 外部Webフォント | 使わない | 端末の明朝・ゴシック |
| サムネイル | PR6で正式版 | `public/og.jpg` と `public/x-banner.jpg` は試作 |

規則（12方向、3環、遮断、余分な光の許可、5問構成）は計画書に合わせています。
