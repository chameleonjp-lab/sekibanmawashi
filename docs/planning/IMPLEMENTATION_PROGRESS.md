# 実装と受入の進捗

更新日: 2026-09-28 JST / 計画: [文書版2.1](IMPLEMENTATION_PLAN.md)

R5開始時の基準main: `0709e7ff2faaaf8b5e28e4038e60ca1872e118a5`（PR #9マージ後）
R6開始時の基準main: PR #11 merge commit `dab3b9133d3b6ef5f4c88c433719192d64e413cd` / tree `6ff4ca684103cd0eb5265b62e89fb071f6b94784`

## 段階

| 段階 | 状態 | 完了と扱わない事項 |
|---|---|---|
| R0 計画 | GitHub PR #5でマージ済み | 文書段階。ゲーム完成・公開の許可とは扱わない |
| R1 判定と基盤 | 実装・自動検査・独立レビュー済み、[PR #6](https://github.com/chameleonjp-lab/sekibanmawashi/pull/6)マージ済み | R2以降と一般公開の受入は未完了 |
| R2 問題庫 | 実装・P01〜P09・独立レビュー済み、[PR #7](https://github.com/chameleonjp-lab/sekibanmawashi/pull/7)マージ済み | 人による試遊・iPhone実機・ゲーム全体の受入は未完了 |
| R3 盤面と入力 | 実装・V/I自動範囲・独立レビュー済み、[PR #8](https://github.com/chameleonjp-lab/sekibanmawashi/pull/8)マージ済み | iPhone・VoiceOver・実機2本指・人の試遊は未実施。公開の受入は未完了 |
| R4 5問・時計・保存 | [PR #9](https://github.com/chameleonjp-lab/sekibanmawashi/pull/9)マージ済み、実装・自動検査・独立レビュー済み | 実機ロック復帰の受入は未完了 |
| R5 公開品質 | [PR #10](https://github.com/chameleonjp-lab/sekibanmawashi/pull/10) 2026-09-27 01:49:54 JSTにユーザーがmainへマージ | 検証source `1cf19149de75b1f970185ec903b6eed7c5896fad` のCI成功。unit72、browser90件（89 expected + 1 flaky、retry成功）、最終失敗0・skip0。Sol HighがQ03資源集計と代表画像を独立確認。実機受入・公開指示は未完了 |
| R6 公開 | workflow実装・標準非browser検査・Pages artifact静的検査・独立レビュー済み。PR #12と[PR #13](https://github.com/chameleonjp-lab/sekibanmawashi/pull/13)はmainへマージ済み。公開候補SHAは `662d0fe79cce888094eb265a71c3f56cc60ff331` | PR #13 headのCI 36347915124は成功済み。公開workflowはmain merge SHA自身のpush CI成功を要求するため、`662d0fe...` のpush `CI / verify`をdispatch前に確認する。Q05・dispatch・実deployは未実施。Q05の受入または個別明示waiverまでdispatchしない |
| ランキング関連 | 今回の対象外 | 延期。接続済み・廃止済みとはしない |

R1は `feat/01-rotation-only-core` で実装しました。GitHub PR番号は6、実装コミットは `4174e3019516f67c110b787455bdae886061a505` です。実装担当はLuna Max、独立レビュー担当はSol Highです。検査と指摘対応の詳細は[R1検査記録](../reviews/R1_VERIFICATION.md)を参照してください。

`npm ci`・型検査・lint・10テスト・ビルドが成功しました。K04は1,728状態の符号化と6操作の逆操作を確認し、独立した光路照合では40盤面×1,728状態が一致しました。正式90問の全状態検査や実機受入の代わりにはしません。

## R2の結果

`feat/02-rotation-only-puzzles` に90問・900組と検査を実装しました。実装・複雑な検査はLuna Max、独立レビューはSol Highが担当し、未解消の実装blockerはありません。詳細は[R2検査記録](../reviews/R2_VERIFICATION.md)と[HTMLレポート](../../reports/r2/report.html)を参照してください。

GitHub PRは[#7](https://github.com/chameleonjp-lab/sekibanmawashi/pull/7)（マージ済み）、実装・ローカル検証対象コミットは `897c3e5c709c9c83e88c169872f330ce07f972a2` です。PR番号の記録はその後の文書コミットで追加しています。最終headのCI結果はPR本文とChecksを参照してください。

難度・部品数・校正許容幅は生成前に保存した `r2-config-v1` を維持しました。初級313・中級330・上級385件を記録し、各300件の合格候補から30問ずつ採用しました。旧90問は全件再解析し、18問を再利用、72問を同難度の新問題へ1対1で差し替えました。

Node `24.19.0` / npm `11.9.0` / Linuxで `npm ci → typecheck → lint → test（32件）→ puzzles:test → build` がすべて成功しました。P02/P03は90問×1,728状態を別計算と照合し、不一致0でした。問題・問題庫・券のバイト単位の再生成一致、全900組の4種類の難度範囲と60/60/30回の出現数、固定seed10万回の抽選も成功しました。

検査へ `tools/` を追加して判明した型エラー8件、近似問題の混入、旧ID対応、内容由来ID、保存解析・校正の再検査、入れ子フィールド、抽選コマンド単独の入力検証、比較図の参照を修正しました。正式ゲームの画面・5問進行・端末保存はR3以降です。検査用HTMLのブラウザ確認はブラウザ取得失敗により未実施で、試遊・iPhone実機確認も未実施です。

## R3の結果

`feat/03-board-input-repair` で1問のSVG盤面・入力・遊び方・中断確認を実装しました。実装と検査はLuna Max、独立レビューはSol Highが担当し、R3の自動検査範囲を合格としました。[検査記録](../reviews/R3_VERIFICATION.md)に初回以降の失敗・原因・修正と最終結果を保存しています。

実装検査対象は `08d9d40e485120bf4470afb13a335217f9cbad32`。[CI 35625649578](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/35625649578)で40単体テスト、P01〜P09、型検査・lint・build、Chromium/WebKitの26画面検査がすべて成功しました。画面検査は失敗・skip・flaky各0。記録追記後の最終headのCIはPR本文とChecksを参照してください。

90問・12方向の描画、指定10画面寸法、文字200%、環の押し分け、主要ボタン48px以上、タップ/クリック/キー、説明・確認中の背景禁止、フォーカス、成功後の固定を検査しました。ローカルのブラウザ取得は失敗したため、画面実行はGitHub CIです。取得した代表画像も確認しました。

盤面の縦横比、遮断印の重複、画面再作成時のキー受付、375×667の配置、文字拡大時の横溢れなどを修正しました。開発用Viteのみ7.3.6へ更新して依存検査0件とし、サーバーは端末内限定、CIのnpmも11.9.0へ固定しました。ゲームの規則や難度・公開データは変更していません。

文字200%はルート文字サイズの模擬、複数指・キャンセルの一部はイベントによる模擬です。iPhone実機、VoiceOver、ロック復帰、人による操作感・難度の確認は未実施。5問の進行・正式時計・保存・結果・共有はR4以降です。R3のマージをゲーム全体の完成・公開許可とは扱いません。

## R4の結果

`feat/04-run-timer-storage` で5問進行、最初だけ3秒・問題間1秒、2種類の時計、30分割当保持、端末内保存、結果・共有を実装しました。実装・検査はLuna Max、独立レビューはSol Highが担当しました。[R4検査記録](../reviews/R4_VERIFICATION.md)に指摘と修正・再検査を記録しています。

ローカルでは68単体テスト、型検査・lint・P01〜P09・buildが成功。停止後の復帰通知、時計逆行、保存例外、共有取消しと古い応答、上限後の参考結果などを修正・検査しました。実装検査対象 `8fd3fb627611d1789f35e9d96e280ed59d1fa6a3` の[CI 35636775163](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/35636775163)で、Chromium/WebKitの54画面検査もすべて成功しました。失敗・skip・flaky各0。初回以降の検査初期化、小画面の時間欄、保存例外注入などを修正し、Sol Highが集計JSONと代表画像を確認してR4の自動検査範囲を承認しました。未解消のコードblockerはありません。実行時間枠だけを調整した `c7fea6709dd12d5776699a6525935560e23e622c` の[CI 35637796323](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/35637796323)でも68単体・54画面検査と全基本検査が成功しました。記録追記後のCIはPRのChecksを参照してください。

iPhone実機・VoiceOver・端末ロック復帰は未実施です。公開名・画像、音の実装、公開品質と公開手順はR5以降に残していましたが、R5で公開準備と音を実装しました。本番公開・ランキング関連・実験場側の変更は行っていません。R4のPR #9をマージした当時のmainからR5へ進みました。

## 各PRで記入する内容

段階、GitHub PR番号、基準main/作業コミット、対応ID、実装内容、検査コマンドと成功/失敗件数、環境、証跡、独立した観点からの指摘と再検査、未実施項目、実機有無、次の段階を追記します。自動検査・部分検査・実機確認を同じ欄で合算しません。

## 未確定・未検証

R2の難度・校正範囲は初期案の数値を維持して成立を確認しました。人による難しさの確認と実験場掲載方式は後続段階です。正式な公開名・共有画像はR6後続のPR #13で対応し、mainへマージ済みです。旧版のテスト成功をv2へ持ち越しません。

R4のPR #9をユーザーがマージしたmain `0709e7ff2faaaf8b5e28e4038e60ca1872e118a5` をR5開始時の基準にしました。PR #10はその後ユーザーがmainへマージしました（上記）。本番公開は行っていません。

## R5の実装状況

`chore/05-release-readiness` で、仮タイトル・予定URL・説明・faviconの設定元を共通化し、音6種の安全なWeb Audio制御、音設定の初期ON・保存・gesture解除、共有/結果/実験場の共通導線、起動・読込・予期しない例外の復旧画面、性能測定、依存ライセンス記録、手動Pages公開手順を追加しています。旧試作OG画像は採用せず、正式な共有画像は未確定のため設定していません。詳細は[R5検査記録](../reviews/R5_VERIFICATION.md)です。

単体72件、P01〜P09、lint、ライセンスメタデータ、ViteのPages baseビルドと性能測定は成功しました。検証source head `1cf19149de75b1f970185ec903b6eed7c5896fad` / tree `451b800a2ab1b536680cc49fb667faa0ca87a1c6` の[CI 36252821838](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36252821838)は成功し、6 smoke・72単体・browser90件（89 expected + 1 flaky、retry成功）・最終失敗0・skip0でした。1件のflakyはWebKit 402×874の開始ボタン操作後にゲーム画面が出ず、再試行では通過したものです。traceではfatal・validation・console errorを確認できず、原因は未確定です。PR #10は2026-09-27 01:49:54 JSTにユーザーによりmain `69ba9e1f34afa9bd5cbdf6950e77e6750132f648`（同tree）へマージされました。詳細は[R5検査記録](../reviews/R5_VERIFICATION.md)と[CI集計](../../reports/r5/ci-36252821838.json)を参照してください。iPhone実機、VoiceOver、ロック復帰、正式名・共有画像の確定は未実施です。R5のCI成功・マージは、実機受入・公開許可とは扱いません。

2026-09-26にPR #10の失敗対応を再開しました。head `3ad17c5226ab1026b7878678d1ae466f98c6722d` の[CI 35650672638](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/35650672638)はsmoke 4件成功、全体70件中67件成功・3件失敗でした。残りは連続20回検査のlistener計数（両エンジン）と横画面844×390・文字200%の時間欄（WebKit）です。診断head `10b4890902e2ddfeed97af100485825ba5038285` では上限を変えず対象・呼出元・矩形を記録します。新規cloneからの `npm ci`、型検査、lint、72単体、P01〜P09、ライセンス、buildは成功。実装/診断はLuna Max、独立レビューはSol Highが担当しています。詳細と失敗履歴は[R5検査記録](../reviews/R5_VERIFICATION.md)に追記しています。一般公開は引き続き保留です。

診断では増えた13 listenerが全てPlaywright検査ツールの初回注入と判明しました。注入を基準取得前に済ませ、増加許容なしのQ03を両ブラウザで20回ずつ通過しました。375/390pxでの時間欄はカード余白を調整し、900.00は200%文字で一行に、1800.00は小画面でも要素・カード内に収まることを検査します。例外境界と5問進行側の後始末を接続し、確定結果を通常描画で復元して4操作を再び使えることも検査しました。規則・90問・900組のデータは変更していません。最新のCI・flaky・資源集計は[R5検査記録](../reviews/R5_VERIFICATION.md)と[CI集計](../../reports/r5/ci-36252821838.json)を参照してください。

## R6の公開Workflow実装

R6開始基準はPR #11 merge commit `dab3b9133d3b6ef5f4c88c433719192d64e413cd` / tree `6ff4ca684103cd0eb5265b62e89fb071f6b94784`、作業branchは `chore/06-publication` でした。R6の[PR #12](https://github.com/chameleonjp-lab/sekibanmawashi/pull/12)は2026-09-27にmainへマージ済み、merge commitは `989784641d7cc04b6ae63c878b53e6acd1c39777` です。同SHAのpush [CI 36335601110](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36335601110)は成功しました。ユーザーは本番公開を許可し、正式名を「セキバンマワシ」と指定しました。この後続PRで名称・共有画像を設定しています。workflow dispatch、実deploy、Pages Settings操作は未実施です。

`.github/workflows/publish-pages.yml` は `workflow_dispatch` のみです。`source_sha` の完全な40桁形式、現在の `origin/main` の祖先であること、同一SHAのmain pushでCI `verify` jobが成功済みであることをActions APIで照合してからbuildします。buildとdeployは分離し、Pages用artifactをdeployします。deploy完了後は公開URLのHTML、SHA、JS/CSS/faviconをHTTPで有限回再試行して検査します。Playwrightのライブサイト操作は追加せず、公開後確認は配信応答のHTTP smokeまでです。

Node `24.19.0` / npm `11.9.0` で `npm ci`、typecheck、lint、licenses、unit72、P01-P09、regular build、Pages build・artifact静的検査が成功しました。performance:r5は155,520 samplesを測定しp50 `0.032238 ms` / p95 `0.064076 ms` / max `5.104793 ms`; 測定コマンドは閾値gateではなく、観測したmaxは従来の5ms目標よりわずかに高い値です。ローカルのPlaywright installはapt権限エラー、aptなし再取得は0 MiB / truncated archiveで失敗しましたが、Draft [PR #12](https://github.com/chameleonjp-lab/sekibanmawashi/pull/12) の[CI 36313174213](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36313174213)は成功しました。browser90件中89 pass、WebKit 390×844・文字200%で1件flakyが再試行成功、最終失敗0・skip0。flakyの根因は未確定で、詳細は[R6検査記録](../reviews/R6_VERIFICATION.md)。

R6後続PR #13で、正式名「セキバンマワシ」をUI・共有文・HTML metadataに反映してmainへマージし、main SHA `989784641d7cc04b6ae63c878b53e6acd1c39777` の成功CI artifact内WebKit実プレイ画面を基に1200×630 PNG共有カードを作成しました。盤面、状態、操作UIは画像内で再描画していません。ローカルWebKitは実行環境の `libgstreamer-1.0.so.0` 不足とapt権限制約で起動できず、同じmain push CIから画面証跡を取得しました。Q05のiPhone 17 Pro物理Safari/VoiceOver/ロック復帰・実機音は未実施です。ユーザーの公開許可はQ05の個別waiverではなく、HTTP smokeやCI結果を実機受入とはしません。規則、90問、900券は変更していません。deploy後はHTTP smokeに加え、計画8.2の実URL画面/共有/実験場フローも確認するまでR6公開完了としません。

公開名・画像の構成、検査結果、未実施項目は[追補検証記録](../reviews/R6_PUBLICATION_ASSETS.md)を参照してください。


### 2026-09-28 PR #13マージ後

PR #13はmainへマージ済みで、現在確認できる最新main commitは `662d0fe79cce888094eb265a71c3f56cc60ff331` です。PR head `bc06184ead790ee80ffea31742589396d29f4693` のCI 36347915124は成功済みですが、公開workflowは公開候補SHA自身のmain push成功を要求するため、dispatch前に `662d0fe79cce888094eb265a71c3f56cc60ff331` の `CI / verify` を確認します。Q05は未実施で、個別waiverもまだ記録していません。したがって、本PRは公開ゲートを弱めず、状態記録のみを更新します。


## R6後の画面仕上げ（2026-09-28）

Node `24.19.0` / npm `11.9.0` で typecheck、lint（39 files）、licenses:check、unit74件、P01〜P09、build、Playwrightのtest discovery（100件）が成功しました。ローカルのChromium/WebKit E2Eは、apt権限制約と配布元からの0 MiB zipでブラウザーを取得できず未実施です。先行headの[CI 36474442114](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36474442114)は短画面検査を通過し、ブラウザー検査は90件成功・2件失敗でした。後続[CI 36477214131](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36477214131)は100件中70件成功・30件失敗し、主な原因は説明ダイアログの旧ボタン名、I03円環テストの穴へのクリック、成功表示「正解！」と検査期待語の不一致でした。テストを現行文言「問題へ戻る」「正解！」と実際の円環位置へ合わせました。修正後headのCIで再確認します。iPhone実機・VoiceOverは未確認です。詳細は[画面仕上げ検査記録](../reviews/POST_R6_UI_REFINEMENT_2026-09-28.md)を参照してください。

## PR #17マージ後の公開検査（2026-09-29）

PR #17はmain `f069923c249c20b1c553296c8af0f96d3035f8f6`へマージ済みです。同じtreeのPR head `68696d6199b8a07e881388877c1da9c3e7bdb387` の[CI #53](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36484289084)はブラウザー100件を51.6分で成功しました。一方、最新main自身の[push CI #54](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36507252037)では、WebKitの15問連続操作が120秒、10画面幅の連続操作が360秒の検査時間を使い切り、それぞれ再試行でも失敗しました。job全体も60分の上限でcancelledとなり、最終集計に到達していません。ログから画面規則の失敗は確認できず、時間制限の再設計が先に必要です。

後続ブランチ `fix/ci-browser-time-budget` は、これら2検査の待ち時間上限を240秒・600秒にし、静的検査とChromium/WebKit各50件を並行jobへ分けます。公開条件が参照する正確な名前の `verify` jobは、静的検査と両ブラウザーjobがすべて成功した場合だけ成功します。先に一部を重複実行していた短いブラウザー検査は、同じ項目を全件検査で実行するため一本化しました。検査項目と再試行数、問題規則、UI実装は変えません。

ローカルではNode 24.19.0 / npm 11.9.0で型検査、lint、unit74件、build、Playwrightの両project各50件の検査一覧、YAML構造、`git diff --check`を確認しました。ブラウザー配布物が0 MiBとなりローカル画面検査は未実施です。公開中のページは旧文言のままです。iPhone実機・VoiceOverは確認済みとしません。マージ後に最新main push CIを成功させ、手動公開workflowで新しいSHAを公開し、実URLで画面と5問の流れを確認します。
