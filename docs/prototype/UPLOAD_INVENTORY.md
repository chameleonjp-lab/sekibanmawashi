# 試作実装のアップロード確認

対象: 会話で作った実装と、リポジトリへ入れた内容の対応。
確認日: 2026-09-21

## 入れ済み（PR #3）

| 内容 | 置き場所 |
|---|---|
| 光線判定、回転、再生 | `prototype/src/game/engine.ts` |
| 全解法探索 | `prototype/src/game/solver.ts` |
| 90問 | `prototype/src/game/data/puzzles.json` |
| 抽選券900件 | `prototype/src/game/data/tickets.json` |
| 問題庫定義 | `prototype/src/game/data/pool.json` |
| 問題生成器 | `prototype/tools/generate-puzzles.ts` |
| 石板画面 | `prototype/src/components/StoneBoard.tsx` |
| 5問チャレンジ、練習、遊び方 | `prototype/src/components/GameApp.tsx` |
| 端末内の記録検証 | `prototype/src/game/leaderboard.ts` |
| 効果音（Web Audio） | `prototype/src/game/audio.ts` |
| 規則テスト | `prototype/src/game/engine.test.ts` |

## 今回追加（抜け漏れ）

| 内容 | 置き場所 | 理由 |
|---|---|---|
| ファビコン | `prototype/public/favicon.svg` | 試作時に作った石板アイコン |
| シェアカード | `prototype/public/og.jpg` | 試作時のOGP画像 |
| X用バナー | `prototype/public/x-banner.jpg` | 試作時の横長画像 |
| カードメタデータ | `prototype/public/site.json` | タイトルと色 |
| 遊び方画面 | `docs/prototype/screenshots/howto.png` | 画面確認用 |
| カウントダウン | `docs/prototype/screenshots/countdown.png` | 画面確認用 |
| 練習プレイ | `docs/prototype/screenshots/play-1.png` `play-2.png` | 盤面と操作の記録 |
| 競技プレイ | `docs/prototype/screenshots/challenge-play.png` | やり直しなしのHUD |
| 試作の順位表 | `prototype/sql/leaderboard.preview.sql` | プレビュー用の表定義。本番Supabaseではない |

## 意図的に入れないもの

次はゲーム本体ではなく、プレビュー環境の専用処理です。公式実装にも使いません。

- 認証、アカウント、サインイン画面
- プレビュー専用のPWA・ホスト連携
- プレビュー環境のデータベース接続コード
- プレビュー枠が写った画面記録（Remix表示を含むもの）
- ほぼ同一の重複スクリーンショット

## 公式計画との関係

この資料は試作の確認用です。本番のサムネイル、GitHub Pages、Supabase表は PR5 / PR6 で改めて作ります。
