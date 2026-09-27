# R6 公開名・共有画像の追補検証

対象基準: PR #12マージ後のmain `989784641d7cc04b6ae63c878b53e6acd1c39777` / tree `7e8196204e5e67e2d71234e9f353e3f6da7c4b64`。同一SHAのpush [CI 36335601110](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36335601110) は成功。

ユーザー指定の正式名「セキバンマワシ」をUI・共有文・ページmetadataへ設定しました。公開URLは `https://chameleonjp-lab.github.io/sekibanmawashi/` です。

## 共有画像

| 項目 | 設定 |
|---|---|
| ファイル | `public/share-card.png` |
| 公開URL | `https://chameleonjp-lab.github.io/sekibanmawashi/share-card.png` |
| 形式・寸法 | PNG / 1200×630 px |
| metadata | Open GraphとTwitter/Xに画像・alt・MIME・寸法を設定 |
| 実画面の根拠 | CI 36335601110の `browser-evidence-36335601110` artifact内、WebKit 390×844通常表示のプレイ中画面 `r4-run-R4-run-timer-and-st-273eb-t-every-prescribed-viewport-webkit/r4-w390-h844-game-normal.png`（780×1688、2x） |

画像にはCIの実プレイ画面から、旧仮タイトルのあるヘッダーを除いたプレイ状態・盤面・操作UIを切り出して配置しました。ゲーム画面部分は描き直しておらず、切り出しと縮小のみです。周囲の石目背景と「セキバンマワシ」のタイトル装飾を別レイヤーにしています。盤面や受光紋、状態表示、操作部品を生成・改変していません。

## 検査結果

Node `24.19.0` / npm `11.9.0` のローカル作業ツリーで次を実行しました。

| 検査 | 結果 |
|---|---|
| `npm run typecheck` | 成功 |
| `npm run lint` | 成功（39 files） |
| `npm test` | 成功（72/72） |
| `npm run licenses:check` | 成功 |
| `PAGES_BUILD=1 npm run build` | 成功 |
| `npm run pages:artifact:check` | 成功。HTML metadata、Pages base、共有PNGの存在・MIME・1200×630寸法・version SHAを確認 |
| PR #13 CI・独立レビュー | 最新状態とレビュー結果は[GitHub PR #13](https://github.com/chameleonjp-lab/sekibanmawashi/pull/13)に記録 |
| iPhone 17 Pro物理受入Q05 | 未実施 |
| Pages dispatch・本番deploy | 未実施 |

ローカルWebKitは `libgstreamer-1.0.so.0` 不足で起動せず、コンテナの権限制約により依存ライブラリのapt導入もできませんでした。画面画像の根拠には、同じmain SHAの成功push CIが記録したWebKit画面を使用しました。これはQ05のiPhone Safari/VoiceOver/ロック復帰/実機音の受入ではありません。

Q05は未達のままです。本番公開は、PR変更のmerge・同一SHA CI・独立レビューの確認後、Q05の受入またはQ05に対するユーザーの個別明示waiverを記録してから行います。
