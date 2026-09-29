# 現在の状態

更新日: 2026-09-29 JST / 対象: `chameleonjp-lab/sekibanmawashi`

## 結論

最新の実装基準は[対応実装計画書 文書版2.1](docs/planning/IMPLEMENTATION_PLAN.md)です。発光紋は常に光り、輪を回して解く規則です。R1〜R5とR6公開workflow・正式名の設定は完了しています。

ユーザー依頼の画面仕上げは[PR #17](https://github.com/chameleonjp-lab/sekibanmawashi/pull/17)で実装され、2026-09-29にmainへマージ済みです。merge commitは f069923c249c20b1c553296c8af0f96d3035f8f6。PR headの[CI 36484289084](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36484289084)は成功しました。main push [CI 36507252037](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36507252037)はブラウザー検査中に60分の上限へ達し、CI成功ではありません。CI run 36510123886 and run 36510468751 attempt 1 were both cancelled when the verify job reached its 60-minute limit during `Run browser tests`; every preceding step passed. Run 36510468751 attempt 2 is on the older head `7a0a5ba2982104d85f0f4c76d0f71d38a8e91a07` and does not verify the current workflow. Main push CI 36507252037 on `f069923c249c20b1c553296c8af0f96d3035f8f6` also reached the 60-minute limit at the browser suite. The updated CI keeps browser checks for product, puzzle, test, asset, and configuration changes, skips them for documentation/workflow/share-card-only changes, allows a manual browser-suite override, and raises the full-job limit to 90 minutes. Current PR head `24fef9b719b4da96567a67a6ed09a87eb8314d5b` has no CI run yet.変更は石板の質感・大きさ、黒い遮光区画、画面揺れ防止、ゲーム画面の音設定削除、分かりやすい表示、成功時の紙吹雪と完成盤面1.5秒表示です。ゲーム規則・問題データは変更していません。

R6の本番公開はまだ完了していません。最後に成功したPages公開run [36450381814](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36450381814)は旧main b717de9a46e06b18b33c6b1af0ab796adb4bb867 の内容です。最新画面に合わない共有画像と公開記録を更新する[Draft PR #18](https://github.com/chameleonjp-lab/sekibanmawashi/pull/18)を提出済みです。PR #18をユーザーがマージした後、merge後mainそのもののpush CI成功を確認してからPagesを公開し、HTTP検査と計画8.2の実URLフローを確認します。こちらではマージしません。

Q05（iPhone 17 Proの物理Safari、VoiceOver、ロック復帰、実機音）は未実施です。ユーザーの個別waiverが[PR #14の記録](https://github.com/chameleonjp-lab/sekibanmawashi/pull/14#issuecomment-5861153503)にあり、今回のR6本番公開に限って適用します。実機確認済みとは扱いません。

| 項目 | 決定・状態 |
|---|---|
| 盤面 | 12方向、可動輪3本、外周の目標へ光を届ける |
| 操作 | 輪を選び、左か右へ回す |
| 成功 | 必須の目標がすべて光れば成功。余分な光は許可 |
| 問題庫 | 初級30・中級30・上級30。1回の挑戦は初級2・中級2・上級1の5問 |
| 接続 | 端末内で完結。ランキング・プレイ回数・Supabaseは対象外 |
| 正式名・URL | 「セキバンマワシ」 / https://chameleonjp-lab.github.io/sekibanmawashi/ |
| 公開 | PR #17の画面は未公開。共有画像をPR #18で更新後、ユーザーのマージと同一main SHAのpush CI成功を待つ |
| 主対象 | iPhone Safari。横画面・PCも同じ規則で検査 |

## 完了・未完了の区別

旧試作のコード・90問・900券・画像資料は存在します。前回レビューでは旧規則の判定と部分描画などを検査しました。詳しい限界は[レビュー基準記録](docs/reviews/REVIEW_BASELINE_2026-09-21.md)を参照してください。

PR #5で計画と仕様を更新しました。R1では、常時発光の到達・遮断判定、回転のみの1,728状態、問題形式の実行時検証、回転履歴の再生と検査基盤を実装しました。検査結果と独立レビューの状況は[進捗表](docs/planning/IMPLEMENTATION_PROGRESS.md)に記録します。

R2で新90問・900組、難度条件、重複排除、再生成、独立計算と抽選の検査を追加しました。[R2検査記録](docs/reviews/R2_VERIFICATION.md)と[HTMLレポート](reports/r2/report.html)で結果を確認できます。R1用の形式例は採用90問とは別です。

R4で5問進行・時計・保存・結果・共有を追加し、[PR #9](https://github.com/chameleonjp-lab/sekibanmawashi/pull/9)へマージしました。通常URLはホーム、`?puzzleId=` はR3の1問確認用として分けます。正式アプリ全体の実機受入は未完了で、自動検査と人による試遊・実機受入を同じ扱いにはしません。

## 次の作業

R3〜R5の履歴は各検査記録、R6は[検査記録](docs/reviews/R6_VERIFICATION.md)と[公開手順](docs/PAGES_PUBLICATION.md)を参照します。PR #17マージ後の公開準備として[Draft PR #18](https://github.com/chameleonjp-lab/sekibanmawashi/pull/18)を提出済みです。PR #18の現行headは `24fef9b719b4da96567a67a6ed09a87eb8314d5b` です。CI run 36510123886 and run 36510468751 attempt 1 were both cancelled when the verify job reached its 60-minute limit during `Run browser tests`; every preceding step passed. Run 36510468751 attempt 2 is on the older head `7a0a5ba2982104d85f0f4c76d0f71d38a8e91a07` and does not verify the current workflow. Main push CI 36507252037 on `f069923c249c20b1c553296c8af0f96d3035f8f6` also reached the 60-minute limit at the browser suite. The updated CI keeps browser checks for product, puzzle, test, asset, and configuration changes, skips them for documentation/workflow/share-card-only changes, allows a manual browser-suite override, and raises the full-job limit to 90 minutes. Current PR head `24fef9b719b4da96567a67a6ed09a87eb8314d5b` has no CI run yet. ユーザーがPRをマージした後は、merge後のmain headと同一SHAのpush CI / verify成功を確認してからPublish Pagesを実行します。

旧GitHub PR #1〜#4と計画のR番号を混同しません。旧計画v1.2の「公式PR1〜6」を新計画と並行実行しません。

## 公開前に残る確認

正式名「セキバンマワシ」と公開URLは設定済みです。現行の公開ページは b717de9a46e06b18b33c6b1af0ab796adb4bb867 のビルドで、PR #17の画面はまだ配信されていません。PR #13由来の共有画像もPR #17以前の画面を示すため、Draft PR #18で更新します。

Q05は未実施ですが、ユーザーは今回のR6本番公開に限った免除をPR #14のコメントに明示しています。Pages公開後はHTTP smokeに加え、ホームから挑戦開始、5問結果、再読込、共有、実験場との往復を実URLで確認します。ランキング等のサーバー連携は延期のままで、実装・公開したとは扱いません。

## 2026-09-29 PR #17マージ後

PR #17はmainへマージ済みです。PR headのCI 36484289084は成功し、main merge commitは f069923c249c20b1c553296c8af0f96d3035f8f6 です。main push CI 36507252037の最終状態はPublish Pages前に再確認します。iPhone実機・VoiceOverは未確認です。

共有画像と運用記録は独立レビュー後、[Draft PR #18](https://github.com/chameleonjp-lab/sekibanmawashi/pull/18)として提出済みです。CI run 36510123886 and run 36510468751 attempt 1 were both cancelled when the verify job reached its 60-minute limit during `Run browser tests`; every preceding step passed. Run 36510468751 attempt 2 is on the older head `7a0a5ba2982104d85f0f4c76d0f71d38a8e91a07` and does not verify the current workflow. Main push CI 36507252037 on `f069923c249c20b1c553296c8af0f96d3035f8f6` also reached the 60-minute limit at the browser suite. The updated CI keeps browser checks for product, puzzle, test, asset, and configuration changes, skips them for documentation/workflow/share-card-only changes, allows a manual browser-suite override, and raises the full-job limit to 90 minutes. Current PR head `24fef9b719b4da96567a67a6ed09a87eb8314d5b` has no CI run yet. 最新headのCIが成功するまではマージ・公開へ進みません。
