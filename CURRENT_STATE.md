# 現在の状態

更新日: 2026-09-29 JST / 対象: `chameleonjp-lab/sekibanmawashi`

## 2026-09-29 の最新状況

[PR #17](https://github.com/chameleonjp-lab/sekibanmawashi/pull/17)はmain `f069923c249c20b1c553296c8af0f96d3035f8f6`へマージ済みです。石板の模様と大きさ、黒い遮断区画、画面の上下揺れ対策、ゲーム画面の音設定削除、短い表示文、左右の紙吹雪と1.5秒の完成盤面表示はコードに入っています。同じtreeのPR head [CI #53](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36484289084)は100件のブラウザー検査を含め成功しました。

本番サイトではまだ旧版の「環」「受光紋」が表示されています。最新main自身のpush [CI #54](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36507252037)では、長いWebKit検査が既定の120秒・個別設定の360秒を使い切り、最終的にjob全体も60分で停止しました。`fix/ci-browser-time-budget` は検査100件を維持してChromium/WebKitを別jobで並行実行し、15問・10画面幅の検査時間を調整します。公開workflowは最新main自身の成功CIを要求するため、この修正PRのマージ後もmain push CI成功を確認してから更新版を公開します。

Q05のiPhone実機確認は未実施ですが、今回の公開に限る個別免除が[公開手順](docs/PAGES_PUBLICATION.md)に記録済みです。以下の2026-09-28時点の記述は経過記録です。

## 結論

最新の実装基準は[対応実装計画書 文書版2.1](docs/planning/IMPLEMENTATION_PLAN.md)です。発光紋は常に光り、輪を回して解く規則です。R1〜R5とR6公開workflow・正式名の設定は完了しています。

ユーザー依頼の画面仕上げは[PR #17](https://github.com/chameleonjp-lab/sekibanmawashi/pull/17)で実装され、2026-09-29にmainへマージ済みです。merge commitは f069923c249c20b1c553296c8af0f96d3035f8f6。PR headの[CI 36484289084](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36484289084)は成功しました。run 36510123886 と run 36510468751 の attempt 1 は、`Run browser tests` 中に60分のjob上限へ達してキャンセルされました。そこまでの型検査、lint、単体検査、問題庫検査、build、Pages artifact検査、性能検査、短いbrowser検査は成功しています。run 36510468751 の attempt 2 は古いheadでの実行で、更新後のworkflowは検証しません。main push CI 36507252037 も同じ60分上限でbrowser検査中にキャンセルされ、成功していません。変更は石板の質感・大きさ、黒い遮光区画、画面揺れ防止、ゲーム画面の音設定削除、分かりやすい表示、成功時の紙吹雪と完成盤面1.5秒表示です。ゲーム規則・問題データは変更していません。

R6の本番公開はまだ完了していません。最後に成功したPages公開run [36450381814](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36450381814)は旧main b717de9a46e06b18b33c6b1af0ab796adb4bb867の内容です。PR #18は共有画像と公開記録を更新していますが、現行headのCI成功はまだ確認できていません。ユーザーのマージ後はmain headと同一SHAのpush CI成功を確認し、その後にPagesを公開してHTTP検査と実URLのゲームフローを確認します。こちらではマージしません。

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

R3〜R5の履歴は各検査記録、R6は[検査記録](docs/reviews/R6_VERIFICATION.md)と[公開手順](docs/PAGES_PUBLICATION.md)を参照します。PR #18の過去runはブラウザー検査中に60分上限でキャンセルされ、現行headを対象にしたCI成功はまだありません。CI workflowを更新し、文書・workflow・共有画像だけの変更ではbrowser検査をskipし、ゲーム・問題・テスト・その他の実素材や設定を変えた場合は実行するようにしました。必要な場合は手動で全検査を指定でき、job上限は90分です。現行headのCIが成功した後、ユーザーのマージとmain SHA自身のCI成功を確認してからPublish Pagesへ進みます。

旧GitHub PR #1〜#4と計画のR番号を混同しません。旧計画v1.2の「公式PR1〜6」を新計画と並行実行しません。

## 公開前に残る確認

正式名「セキバンマワシ」と公開URLは設定済みです。現行の公開ページは b717de9a46e06b18b33c6b1af0ab796adb4bb867 のビルドで、PR #17の画面はまだ配信されていません。PR #13由来の共有画像もPR #17以前の画面を示すため、PR #18で更新します。

Q05は未実施ですが、ユーザーは今回のR6本番公開に限った免除をPR #14のコメントに明示しています。Pages公開後はHTTP smokeに加え、ホームから挑戦開始、5問結果、再読込、共有、実験場との往復を実URLで確認します。ランキング等のサーバー連携は延期のままで、実装・公開したとは扱いません。

## 2026-09-29 PR #17マージ後

PR #17はmainへマージ済みです。PR headのCI 36484289084は成功し、main merge commitは f069923c249c20b1c553296c8af0f96d3035f8f6 です。main push CI 36507252037は60分上限でbrowser検査中にキャンセルされました。iPhone実機・VoiceOverは未確認です。

共有画像と運用記録は[PR #18](https://github.com/chameleonjp-lab/sekibanmawashi/pull/18)で更新中です。run 36510123886 と run 36510468751 の attempt 1 は、`Run browser tests` 中に60分のjob上限へ達してキャンセルされました。そこまでの型検査、lint、単体検査、問題庫検査、build、Pages artifact検査、性能検査、短いbrowser検査は成功しています。run 36510468751 の attempt 2 は古いheadでの実行で、更新後のworkflowは検証しません。main push CI 36507252037 も同じ60分上限でbrowser検査中にキャンセルされ、成功していません。最新版CIは文書・workflow・共有画像のみならbrowser検査をskipし、ゲームやテストの変更では実行する方針です。最新headのCI成功まではマージ・公開へ進みません。
