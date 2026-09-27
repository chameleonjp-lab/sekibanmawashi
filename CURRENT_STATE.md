# 現在の状態

更新日: 2026-09-27 JST / 対象: `chameleonjp-lab/sekibanmawashi`

## 結論

最新の実装基準は[対応実装計画書 文書版2.0](docs/planning/IMPLEMENTATION_PLAN.md)です。**発光紋が常時発光し、回転だけで解く規則です。R1はPR #6、R2はPR #7、R3（1問の盤面と入力）は[PR #8](https://github.com/chameleonjp-lab/sekibanmawashi/pull/8)、R4（5問進行・時計・保存・結果・共有）は[PR #9](https://github.com/chameleonjp-lab/sekibanmawashi/pull/9)でマージ済みです。R5は[PR #10](https://github.com/chameleonjp-lab/sekibanmawashi/pull/10)として2026-09-27 01:49:54 JSTにユーザーによりmainへマージ済みです。検証ソース `1cf19149de75b1f970185ec903b6eed7c5896fad` の[CI 36252821838](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36252821838)は成功し、browser 90件（89 expected + 1 flaky。初回失敗後に再試行成功）、最終失敗0・skip0でした。flakyの原因は未確定です。R6開始基準はPR #11 merge commit `dab3b9133d3b6ef5f4c88c433719192d64e413cd` / tree `6ff4ca684103cd0eb5265b62e89fb071f6b94784` です。ユーザーは2026-09-27に本番公開を許可しましたが、これは計画の未達受入ゲートの包括的免除とは扱いません。R6 PRは準備中でworkflow dispatch・実deployは未実施、Q05実機受入・正式名・共有画像も未完了です。**

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
| 公開 | R6でworkflow_dispatch専用の公開workflowを準備中。公開許可は記録済みだが未達ゲートの包括waiverではない。Q05・正式名・画像等の事前ゲート完了または項目ごとの明示waiverまではdispatchしない |
| 主対象 | iPhone 17 Pro Safari。横画面・PCも同じ規則で検査する |

## 完了・未完了の区別

旧試作のコード・90問・900券・画像資料は存在します。前回レビューでは旧規則の判定と部分描画などを検査しました。詳しい限界は[レビュー基準記録](docs/reviews/REVIEW_BASELINE_2026-09-21.md)を参照してください。

PR #5で計画と仕様を更新しました。R1では、常時発光の到達・遮断判定、回転のみの1,728状態、問題形式の実行時検証、回転履歴の再生と検査基盤を実装しました。検査結果と独立レビューの状況は[進捗表](docs/planning/IMPLEMENTATION_PROGRESS.md)に記録します。

R2で新90問・900組、難度条件、重複排除、再生成、独立計算と抽選の検査を追加しました。[R2検査記録](docs/reviews/R2_VERIFICATION.md)と[HTMLレポート](reports/r2/report.html)で結果を確認できます。R1用の形式例は採用90問とは別です。

R4で5問進行・時計・保存・結果・共有を追加し、[PR #9](https://github.com/chameleonjp-lab/sekibanmawashi/pull/9)へマージしました。通常URLはホーム、`?puzzleId=` はR3の1問確認用として分けます。正式アプリ全体の実機受入は未完了で、自動検査と人による試遊・実機受入を同じ扱いにはしません。

## 次の作業

R3の結果・修正履歴と未確認は[R3検査記録](docs/reviews/R3_VERIFICATION.md)、R4の作業結果は[R4検査記録](docs/reviews/R4_VERIFICATION.md)、R5は[R5検査記録](docs/reviews/R5_VERIFICATION.md)で管理します。R6は[検査記録](docs/reviews/R6_VERIFICATION.md)と[公開手順](docs/PAGES_PUBLICATION.md)を参照してください。ユーザーの公開許可は得ていますが、それ自体は未達ゲートを免除しません。R6変更のPRマージ・rootによるmain/CI再確認も未了で、事前ゲート完了または未達項目ごとの明示waiverが記録されるまではdispatchしません。

旧GitHub PR #1〜#4と計画のR番号を混同しません。旧計画v1.2の「公式PR1〜6」を新計画と並行実行しません。

## 公開前に残る確認

正式な公開名、説明文・共有画像、実験場側の掲載方式、公開先の実在を確認する必要があります。仮表示は「石板回し」であり、プロジェクト呼称「セキバンマワシ」から正式名を自動確定しません。共有画像は未設定（`shareImageUrl: null`）です。ユーザーは本番公開を許可しましたが、予定URL `https://chameleonjp-lab.github.io/sekibanmawashi/` への実公開完了を意味しません。

iPhone 17 Pro物理Safari・VoiceOver・ロック復帰・正式アプリ全体の実機受入（Q05）は未実施です。R1/R5のbuild成功や今後のHTTP smokeだけで実機受入完了とはしません。正式名「石板回し」は仮表示、共有画像は未設定です。ユーザーの公開許可はQ05・正式名・画像のwaiverではありません。サーバー抽選とランキングは延期であり、廃止・完了扱いにはしません。
