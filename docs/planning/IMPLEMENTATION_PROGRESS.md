# 実装と受入の進捗

更新日: 2026-10-01 JST / 計画: [文書版2.1](IMPLEMENTATION_PLAN.md)

R5開始時の基準main: `0709e7ff2faaaf8b5e28e4038e60ca1872e118a5`（PR #9マージ後）
R6開始時の基準main: PR #11 merge commit `dab3b9133d3b6ef5f4c88c433719192d64e413cd` / tree `6ff4ca684103cd0eb5265b62e89fb071f6b94784`

## 2026-10-01 クリア前後のタップによる誤拡大

基準main `f69ac19cd51035fafeb019fbd70fc2289d58bcc6`（PR #21マージ後）から `fix/clear-tap-zoom` で修正。盤面・入力列の拡大防止設定と、入力停止中のタップを取り消す共通処理を本編・1問確認の両方に追加しました。1タップ1回転、成功後の手数固定、完成盤面と紙吹雪の1.5秒表示、次問の入力再開を維持します。

Luna Maxが実装し、親担当が関連9件のブラウザー検査と基本検査を確認、6.1Sol Extra Highが独立レビューを担当しました。必要修正なし。成功・初回失敗・環境の補正・iPhone実機未確認は[検査記録](../reviews/CLEAR_TAP_ZOOM_2026-10-01.md)を参照します。mainを対象にDraft PRを作成し、最終headのCI結果をそのChecksへ残します。マージ・本番公開は未実施です。

## 2026-09-29 ハーネスに基づく表示レビュー

PR #18マージ後のmain `41e18e2f05ca39b874e874105b76ce0895adb2dc` から `fix/visual-harness-review` で見た目を見直した。石の粒と輪の縁の陰影、未点灯目標の見分けやすさ、PC・横画面の盤面はみ出しを修正。ゲームの判定・問題・時計・保存・音・通信は変更していない。ハーネス参照版とVIS-01〜03、V01〜V05/I01〜I06の関連検査、比較画像、独立レビュー、未確認は[表示レビュー記録](../reviews/VISUAL_HARNESS_REVIEW_2026-09-29.md)を参照する。これはPR #20の公開記録更新とは別の表示修正で、今回の変更の公開は未実施。

## 段階

| 段階 | 状態 | 完了と扱わない事項 |
|---|---|---|
| R0 計画 | GitHub PR #5でマージ済み | 文書段階。ゲーム完成・公開の許可とは扱わない |
| R1 判定と基盤 | 実装・自動検査・独立レビュー済み、[PR #6](https://github.com/chameleonjp-lab/sekibanmawashi/pull/6)マージ済み | R2以降と一般公開の受入は未完了 |
| R2 問題庫 | 実装・P01〜P09・独立レビュー済み、[PR #7](https://github.com/chameleonjp-lab/sekibanmawashi/pull/7)マージ済み | 人による試遊・iPhone実機・ゲーム全体の受入は未完了 |
| R3 盤面と入力 | 実装・V/I自動範囲・独立レビュー済み、[PR #8](https://github.com/chameleonjp-lab/sekibanmawashi/pull/8)マージ済み | iPhone・VoiceOver・実機2本指・人の試遊は未実施。公開の受入は未完了 |
| R4 5問・時計・保存 | [PR #9](https://github.com/chameleonjp-lab/sekibanmawashi/pull/9)マージ済み、実装・自動検査・独立レビュー済み | 実機ロック復帰の受入は未完了 |
| R5 公開品質 | [PR #10](https://github.com/chameleonjp-lab/sekibanmawashi/pull/10) 2026-09-27 01:49:54 JSTにユーザーがmainへマージ | 検証source `1cf19149de75b1f970185ec903b6eed7c5896fad` のCI成功。unit72、browser90件（89 expected + 1 flaky、retry成功）、最終失敗0・skip0。Sol HighがQ03資源集計と代表画像を独立確認。実機受入・公開指示は未完了 |
| R6 公開 | PR #18 merge commit `41e18e2f05ca39b874e874105b76ce0895adb2dc` をPagesへ公開済み | 同SHAのmain CI [36534850625](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36534850625)で `checks`、Chromium、WebKit、必須 `verify` が成功。[Publish Pages #4](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36541668581)はbuild・deploy・HTTP smokeが成功。実URLではホームと練習画面を確認。Q05は未実施で、今回のR6公開だけに適用する免除がPR #14に記録済み |
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

## R6の公開Workflow実装（実装履歴）

R6開始基準はPR #11 merge commit `dab3b9133d3b6ef5f4c88c433719192d64e413cd` / tree `6ff4ca684103cd0eb5265b62e89fb071f6b94784`、作業branchは `chore/06-publication` でした。R6の[PR #12](https://github.com/chameleonjp-lab/sekibanmawashi/pull/12)は2026-09-27にmainへマージ済み、merge commitは `989784641d7cc04b6ae63c878b53e6acd1c39777` です。同SHAのpush [CI 36335601110](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36335601110)は成功しました。ユーザーは本番公開を許可し、正式名を「セキバンマワシ」と指定しました。この後続PRで名称・共有画像を設定しています。workflow dispatch、実deploy、Pages Settings操作は未実施です。

`.github/workflows/publish-pages.yml` は `workflow_dispatch` のみです。`source_sha` の完全な40桁形式、現在の `origin/main` の祖先であること、同一SHAのmain pushでCI `verify` jobが成功済みであることをActions APIで照合してからbuildします。buildとdeployは分離し、Pages用artifactをdeployします。deploy完了後は公開URLのHTML、SHA、JS/CSS/faviconをHTTPで有限回再試行して検査します。Playwrightのライブサイト操作は追加せず、公開後確認は配信応答のHTTP smokeまでです。

Node `24.19.0` / npm `11.9.0` で `npm ci`、typecheck、lint、licenses、unit72、P01-P09、regular build、Pages build・artifact静的検査が成功しました。performance:r5は155,520 samplesを測定しp50 `0.032238 ms` / p95 `0.064076 ms` / max `5.104793 ms`; 測定コマンドは閾値gateではなく、観測したmaxは従来の5ms目標よりわずかに高い値です。ローカルのPlaywright installはapt権限エラー、aptなし再取得は0 MiB / truncated archiveで失敗しましたが、Draft [PR #12](https://github.com/chameleonjp-lab/sekibanmawashi/pull/12) の[CI 36313174213](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36313174213)は成功しました。browser90件中89 pass、WebKit 390×844・文字200%で1件flakyが再試行成功、最終失敗0・skip0。flakyの根因は未確定で、詳細は[R6検査記録](../reviews/R6_VERIFICATION.md)。

R6後続PR #13で、正式名「セキバンマワシ」をUI・共有文・HTML metadataに反映してmainへマージし、main SHA `989784641d7cc04b6ae63c878b53e6acd1c39777` の成功CI artifact内WebKit実プレイ画面を基に1200×630 PNG共有カードを作成しました。盤面、状態、操作UIは画像内で再描画していません。ローカルWebKitは実行環境の `libgstreamer-1.0.so.0` 不足とapt権限制約で起動できず、同じmain push CIから画面証跡を取得しました。Q05のiPhone 17 Pro物理Safari/VoiceOver/ロック復帰・実機音は未実施です。ユーザーの公開許可はQ05の個別waiverではなく、HTTP smokeやCI結果を実機受入とはしません。規則、90問、900券は変更していません。deploy後はHTTP smokeに加え、計画8.2の実URL画面/共有/実験場フローも確認するまでR6公開完了としません。

公開名・画像の構成、検査結果、未実施項目は[追補検証記録](../reviews/R6_PUBLICATION_ASSETS.md)を参照してください。


### 2026-09-28 PR #13マージ後

PR #13はmainへマージ済みで、現在確認できる最新main commitは `662d0fe79cce888094eb265a71c3f56cc60ff331` です。PR head `bc06184ead790ee80ffea31742589396d29f4693` のCI 36347915124は成功済みですが、公開workflowは公開候補SHA自身のmain push成功を要求するため、dispatch前に `662d0fe79cce888094eb265a71c3f56cc60ff331` の `CI / verify` を確認します。Q05は未実施で、個別waiverもまだ記録していません。したがって、本PRは公開ゲートを弱めず、状態記録のみを更新します。


## R6後の画面仕上げと公開準備（2026-09-28〜29の履歴）

ユーザー依頼の石板表示・盤面サイズ・黒い遮光区画・画面揺れ防止・音設定の配置・分かりやすい表示・成功演出はPR #17で実装され、2026-09-29にmainへマージ済みです。merge commit f069923c249c20b1c553296c8af0f96d3035f8f6、基準mainはb717de9a46e06b18b33c6b1af0ab796adb4bb867でした。PR head CI 36484289084は成功しました。main push CI 36507252037はbrowser検査中に60分上限でキャンセルされ、成功ではありません。ローカルChromium/WebKitは配布元の0 MiBブラウザー取得とapt権限制約で未実施です。iPhone実機・VoiceOverも未確認です.

最後に成功したPages deployはrun 36450381814で、PR #17以前のmain b717de9a46e06b18b33c6b1af0ab796adb4bb867を公開しています。共有画像 public/share-card.png にあった旧表示はPR #17の成功CI WebKit画面を使ってPR #18で更新しました。run 36510123886 と run 36510468751 の attempt 1 は、`Run browser tests` 中に60分のjob上限へ達してキャンセルされました。そこまでの型検査、lint、単体検査、問題庫検査、build、Pages artifact検査、性能検査、短いbrowser検査は成功しています。run 36510468751 の attempt 2 は古いheadでの実行で、更新後のworkflowは検証しません。main push CI 36507252037 も同じ60分上限でbrowser検査中にキャンセルされ、成功していません。独立画像レビューでは重大な問題なし、SNS縮小時に細かい文字が読みにくい点のみ指摘されました。現行headのCI成功後、ユーザーのマージを待ちます.

Q05は未実施ですが、ユーザーの個別waiverがPR #14に記録され、今回のR6公開に限り適用します。PR #18をユーザーがマージした後、そのmain SHAのpush CI成功を確認してからPages dispatchを行い、HTTP smokeと計画8.2の実URLフローを確認します。PRはマージしません。
Node `24.19.0` / npm `11.9.0` で typecheck、lint（39 files）、licenses:check、unit74件、P01〜P09、build、Playwrightのtest discovery（100件）が成功しました。ローカルのChromium/WebKit E2Eは、apt権限制約と配布元からの0 MiB zipでブラウザーを取得できず未実施です。先行headの[CI 36474442114](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36474442114)は短画面検査を通過し、ブラウザー検査は90件成功・2件失敗でした。後続[CI 36477214131](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36477214131)は100件中70件成功・30件失敗し、主な原因は説明ダイアログの旧ボタン名、I03円環テストの穴へのクリック、成功表示「正解！」と検査期待語の不一致でした。テストを現行文言「問題へ戻る」「正解！」と実際の円環位置へ合わせました。修正後headのCIで再確認します。iPhone実機・VoiceOverは未確認です。詳細は[画面仕上げ検査記録](../reviews/POST_R6_UI_REFINEMENT_2026-09-28.md)を参照してください。

## PR #17マージ後の公開準備検査（履歴）

PR #17はmain `f069923c249c20b1c553296c8af0f96d3035f8f6`へマージ済みです。同じtreeのPR head `68696d6199b8a07e881388877c1da9c3e7bdb387` の[CI #53](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36484289084)はブラウザー100件を51.6分で成功しました。一方、最新main自身の[push CI #54](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36507252037)では、WebKitの15問連続操作が120秒、10画面幅の連続操作が360秒の検査時間を使い切り、それぞれ再試行でも失敗しました。job全体も60分の上限でcancelledとなり、最終集計に到達していません。ログから画面規則の失敗は確認できず、時間制限の再設計が先に必要です。

PR #19で上記の時間上限を240秒・600秒にし、静的検査 `checks` とChromium/WebKitのbrowser matrix（各job 90分）を独立実行する構成をmainへマージしました。公開条件が参照する必須 `verify` は、静的検査と両ブラウザーjobがすべて成功した場合だけ成功します。main run 36521040745で3系統と `verify` が成功しました。これはPR #18の検査結果とは区別し、PR #18の最新head自身のChecksで判定します。

ローカルではNode 24.19.0 / npm 11.9.0で型検査、lint、unit74件、build、Playwrightの両project各50件の検査一覧、YAML構造、`git diff --check`を確認しました。ブラウザー配布物が0 MiBとなりローカル画面検査は未実施です。公開中のページは旧文言のままです。iPhone実機・VoiceOverは確認済みとしません。マージ後に最新main push CIを成功させ、手動公開workflowで新しいSHAを公開し、実URLで画面と5問の流れを確認します。


## 2026-09-29 R6公開結果

PR #18は `41e18e2f05ca39b874e874105b76ce0895adb2dc` でmainへマージされました。同SHAのmain push CI [36534850625](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36534850625)は成功し、静的検査、Chromium、WebKit、必須 `verify` がすべて成功しました。

Pages公開workflow [36541668581](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36541668581)はbuild、deploy、公開後HTTP smokeまで成功しました。公開先は https://chameleonjp-lab.github.io/sekibanmawashi/ です。実URLではホーム画面と練習用盤面を確認しました。実URL上の5問完了までは手動で確認していません。

Q05（iPhone 17 Pro物理Safari、VoiceOver、ロック復帰、実機音）は未実施です。ユーザーが今回のR6公開に限る免除をPR #14に記録していますが、実機受入済みとは扱いません。ランキング、Supabase、実験場の本番データは変更していません。
