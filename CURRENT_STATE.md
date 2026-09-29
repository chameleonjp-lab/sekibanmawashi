# 現在の状態

更新日: 2026-09-29 JST / 対象: `chameleonjp-lab/sekibanmawashi`

## 2026-09-29 の最新状況

[PR #17](https://github.com/chameleonjp-lab/sekibanmawashi/pull/17)はmain `f069923c249c20b1c553296c8af0f96d3035f8f6`へマージ済みです。石板の模様と大きさ、黒い遮断区画、画面の上下揺れ対策、ゲーム画面の音設定削除、短い表示文、左右の紙吹雪と1.5秒の完成盤面表示はコードに入っています。同じtreeのPR head [CI #53](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36484289084)は100件のブラウザー検査を含め成功しました。

本番サイトではまだ旧版の「環」「受光紋」が表示されています。最新main自身のpush [CI #54](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36507252037)では、長いWebKit検査が既定の120秒・個別設定の360秒を使い切り、最終的にjob全体も60分で停止しました。`fix/ci-browser-time-budget` は検査100件を維持してChromium/WebKitを別jobで並行実行し、15問・10画面幅の検査時間を調整します。公開workflowは最新main自身の成功CIを要求するため、この修正PRのマージ後もmain push CI成功を確認してから更新版を公開します。

Q05のiPhone実機確認は未実施ですが、今回の公開に限る個別免除が[公開手順](docs/PAGES_PUBLICATION.md)に記録済みです。以下の2026-09-28時点の記述は経過記録です。

## 結論

最新の実装基準は[対応実装計画書 文書版2.1](docs/planning/IMPLEMENTATION_PLAN.md)です。**発光紋が常時発光し、回転だけで解く規則です。R1はPR #6、R2はPR #7、R3（1問の盤面と入力）は[PR #8](https://github.com/chameleonjp-lab/sekibanmawashi/pull/8)、R4（5問進行・時計・保存・結果・共有）は[PR #9](https://github.com/chameleonjp-lab/sekibanmawashi/pull/9)でマージ済みです。R5は[PR #10](https://github.com/chameleonjp-lab/sekibanmawashi/pull/10)として2026-09-27 01:49:54 JSTにユーザーによりmainへマージ済みです。検証ソース `1cf19149de75b1f970185ec903b6eed7c5896fad` の[CI 36252821838](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36252821838)は成功し、browser 90件（89 expected + 1 flaky。初回失敗後に再試行成功）、最終失敗0・skip0でした。flakyの原因は未確定です。R6開始基準はPR #11 merge commit `dab3b9133d3b6ef5f4c88c433719192d64e413cd` / tree `6ff4ca684103cd0eb5265b62e89fb071f6b94784` です。[PR #12](https://github.com/chameleonjp-lab/sekibanmawashi/pull/12) は2026-09-27にmainへマージされ、merge commit `989784641d7cc04b6ae63c878b53e6acd1c39777` のpush [CI 36335601110](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36335601110) が成功しました。ユーザーは本番公開を許可し、正式名を「セキバンマワシ」と指定しました。[PR #13](https://github.com/chameleonjp-lab/sekibanmawashi/pull/13) はmainへマージ済みで、merge commitは `662d0fe79cce888094eb265a71c3f56cc60ff331` です。PR head `bc06184ead790ee80ffea31742589396d29f4693` のCI 36347915124は成功済みです。公開workflowはmain merge SHAそのもののpush `CI / verify` 成功を要求するため、dispatch前に `662d0fe79cce888094eb265a71c3f56cc60ff331` のpush CIを別途確認します。Q05実機受入は未実施のため、workflow dispatch・実deployは未実施です。**

## 画面仕上げ作業（Draft PR #17）

現在の依頼に合わせ、盤面の石らしい模様と大きさ、黒い遮光場所、操作中の上下揺れ防止、ゲーム画面の音設定削除、短い日本語表示、成功時の紙吹雪と完成盤面1.5秒表示を作業中です。作業ブランチ `fix/gameplay-board-clarity` の[Draft PR #17](https://github.com/chameleonjp-lab/sekibanmawashi/pull/17)は、最新main `b717de9a46e06b18b33c6b1af0ab796adb4bb867` を基準にしています。ユニット74件、型検査、lint、buildは成功。Playwrightブラウザは実行環境の権限不足と0 MiBダウンロードで取得できず、PR CI確認は未完了です。iPhone実機も未確認です。

R5開始時の基準mainは `0709e7ff2faaaf8b5e28e4038e60ca1872e118a5`（GitHub PR #9マージ後）です。今回の記録更新PRの基準mainはPR #10マージ後の `69ba9e1f34afa9bd5cbdf6950e77e6750132f648`（tree `451b800a2ab1b536680cc49fb667faa0ca87a1c6`）です。正式版はルート直下の `src/` と `content/` に分け、`prototype/` は旧規則の比較資料として残します。

| 項目 | 決定・状態 |
|---|---|
| 盤面 | 12方向、可動環3本、外周に受光紋 |
| 新操作 | 環選択、左回転、右回転。R3で1問の盤面・入力と説明/中断確認を実装。実機は未確認 |
| 成功 | 必須受光紋が全て点灯。余分な光は許可 |
| 問題庫 | v2で初級30・中級30・上級30を生成。旧90問を再解析し18問再利用・72問差し替え |
| 1回の挑戦 | 初級2・中級2・上級1の順に5問。日替わりなし |
| 今回の実装先 | 正式版の `src/` / `content/` を基本とする。旧試作は比較資料 |
| 今回の接続 | 端末内で完結。ランキング・プレイ回数・Supabaseは対象外 |
| 公開 | R6のworkflow_dispatch専用公開workflowはPR #12でmainへマージ済み。正式名「セキバンマワシ」と実画面ベースの共有画像もPR #13でmainへマージ済み。公開候補SHAは `662d0fe79cce888094eb265a71c3f56cc60ff331`。同SHAのmain push CI確認に加え、Q05実機受入の個別waiverまたは完了まではdispatchしない |
| 主対象 | iPhone 17 Pro Safari。横画面・PCも同じ規則で検査する |

## 完了・未完了の区別

旧試作のコード・90問・900券・画像資料は存在します。前回レビューでは旧規則の判定と部分描画などを検査しました。詳しい限界は[レビュー基準記録](docs/reviews/REVIEW_BASELINE_2026-09-21.md)を参照してください。

PR #5で計画と仕様を更新しました。R1では、常時発光の到達・遮断判定、回転のみの1,728状態、問題形式の実行時検証、回転履歴の再生と検査基盤を実装しました。検査結果と独立レビューの状況は[進捗表](docs/planning/IMPLEMENTATION_PROGRESS.md)に記録します。

R2で新90問・900組、難度条件、重複排除、再生成、独立計算と抽選の検査を追加しました。[R2検査記録](docs/reviews/R2_VERIFICATION.md)と[HTMLレポート](reports/r2/report.html)で結果を確認できます。R1用の形式例は採用90問とは別です。

R4で5問進行・時計・保存・結果・共有を追加し、[PR #9](https://github.com/chameleonjp-lab/sekibanmawashi/pull/9)へマージしました。通常URLはホーム、`?puzzleId=` はR3の1問確認用として分けます。正式アプリ全体の実機受入は未完了で、自動検査と人による試遊・実機受入を同じ扱いにはしません。

## 次の作業

R3の結果・修正履歴と未確認は[R3検査記録](docs/reviews/R3_VERIFICATION.md)、R4の作業結果は[R4検査記録](docs/reviews/R4_VERIFICATION.md)、R5は[R5検査記録](docs/reviews/R5_VERIFICATION.md)で管理します。R6は[検査記録](docs/reviews/R6_VERIFICATION.md)と[公開手順](docs/PAGES_PUBLICATION.md)を参照してください。PR #12とPR #13はmainへマージ済みです。正式名と共有画像はmainへ入っています。先にDraft PR #17の画面仕上げをCIまで確認します。その後、公開候補SHA `662d0fe79cce888094eb265a71c3f56cc60ff331` のmain push CIとQ05実施または個別waiverを確認してからdispatchを検討します。

旧GitHub PR #1〜#4と計画のR番号を混同しません。旧計画v1.2の「公式PR1〜6」を新計画と並行実行しません。

## 公開前に残る確認

正式名はユーザー指定の「セキバンマワシ」、共有画像はmainの成功CIが撮影した実プレイ画面を使った1200×630 PNGとしてPR #13で設定し、mainへマージ済みです。公開先URLは `https://chameleonjp-lab.github.io/sekibanmawashi/` です。実験場側の掲載方式と公開先での実動作は、deploy後に確認します。

iPhone 17 Pro物理Safari・VoiceOver・ロック復帰・正式アプリ全体の実機受入（Q05）は未実施です。CIやHTTP smokeを実機受入完了とはしません。ユーザーの公開許可はQ05の個別waiverではありません。サーバー抽選とランキングは延期であり、廃止・完了扱いにはしません。

## 2026-09-28 ゲーム画面の改善

ユーザー依頼の画面改善を、main `b717de9a46e06b18b33c6b1af0ab796adb4bb867` から分岐した `fix/gameplay-board-clarity` で実装し、[Draft PR #17](https://github.com/chameleonjp-lab/sekibanmawashi/pull/17) を作成しました。石板の質感と大きさ、黒く塗る遮断区画、上下に動かない入力、ゲーム画面からの音設定削除、簡潔な状態表示・言葉、成功時の紙吹雪と1.5秒の完成盤面表示が対象です。問題規則やデータは変更していません。未マージ・未公開です。

Node 24.19.0 / npm 11.9.0 で typecheck、lint（39 files）、licenses:check、unit74件、P01〜P09、build、Playwright 100件のtest discoveryが成功しました。ローカルChromium/WebKitは0 MiBのブラウザー配布物により未実行です。先行CI 36474442114では短画面検査を通過し、ブラウザー検査は90件成功・2件失敗でした。後続CI 36477214131は100件中70件成功・30件失敗し、説明ダイアログの閉じる文言、円環テストが円環の穴をクリックしていたこと、成功表示の文言期待が現行UIと合わないことが主因でした。現在のUI文言「問題へ戻る」「正解！」に合わせ、円環上をタップする検査に直しました。be06d892のCI 36481577892はこの修正前のheadで実行中でした。修正後headのCIで再確認します。iPhone実機・VoiceOverは未実施です。
