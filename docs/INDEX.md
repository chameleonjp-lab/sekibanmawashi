# 資料一覧

最新は**文書版2.0、常時発光・回転のみ**です。R1〜R3に続き、R4の5問進行・時計・保存・結果と共有を実装・検査中です。ゲーム全体の実機受入と公開は未完了です。

## 現在使う資料

| 資料 | 用途 |
|---|---|
| [現在の状態](../CURRENT_STATE.md) | 決定済みと未実装を分ける |
| [現在のゲーム仕様](spec/CURRENT_GAME_SPEC.md) | プレイヤーから見た変更後の仕様 |
| [対応実装計画書](planning/IMPLEMENTATION_PLAN.md) | 指摘対応、固定条件、初期検証案、検査、公開の境界 |
| [PRロードマップ](planning/PR_ROADMAP.md) | R0〜R6と次へ進む条件 |
| [進捗表](planning/IMPLEMENTATION_PROGRESS.md) | 実装・検査・受入の状況 |
| [2026-09-21の決定](history/DECISION_2026-09-21.md) | 発光切替廃止と今回の依頼範囲 |
| [レビュー基準記録](reviews/REVIEW_BASELINE_2026-09-21.md) | 旧版の確認結果と未確認の区別 |
| [R1の検査・レビュー記録](reviews/R1_VERIFICATION.md) | 正式版の判定・形式・履歴の検査結果と残作業 |
| [v2の問題・履歴形式](spec/ROTATION_ONLY_V2_FORMAT.md) | 回転専用のデータとチェックサムの契約 |
| [R1の検査移行記録](history/R1_TEST_MIGRATION.md) | 旧17検査の意図を新規則へ移す理由と範囲 |
| [R2の問題生成](spec/R2_PUZZLE_GENERATION.md) | 数値条件、探索指標、重複除外、旧90問の移行 |
| [R2の問題庫・抽選券](spec/R2_POOL_TICKETS.md) | 90問・900組の形式、事前校正、出現回数、抽選 |
| [R2の検査・レビュー記録](reviews/R2_VERIFICATION.md) | P01〜P09、独立照合、修正結果、未確認 |
| [R2のHTML検査レポート](../reports/r2/report.html) | 90問の盤面、採否、校正範囲と抽選統計 |
| [R3の盤面と入力](spec/R3_BOARD_INPUT.md) | 1問の操作、表示・入力の境界、画面寸法と検査範囲 |
| [R3の検査・レビュー記録](reviews/R3_VERIFICATION.md) | V/I検査の結果、指摘対応、実機などの未確認 |
| [R4の進行・時計・保存](spec/R4_RUN_TIMER_STORAGE.md) | 5問の状態、時間、保存、共有の境界 |
| [R4の検査・レビュー記録](reviews/R4_VERIFICATION.md) | F/T/S/Uの検査、独立レビュー、失敗と再検査、未確認 |

## 試作とデータ例

[prototype/](../prototype/)は旧規則の比較資料です。[差分の案内](../prototype/NOTES.md)を確認し、正式版へ丸ごとコピーしません。[アップロード一覧](prototype/UPLOAD_INVENTORY.md)と[画面記録](prototype/screenshots/)は旧試作の記録で、本番素材ではありません。

[データ例の案内](examples/README.md)で正式版v2と旧形式を区別します。旧JSONを正式版へそのまま読み込みません。R1の形式例は、採用済みの90問とは別の検査用データです。

## 調査・履歴・デザイン

[背景調査](research/original-logic-research.md)、[デザイン判断](design/DESIGN_HISTORY.md)、[以前の会話決定](history/CHAT_DECISIONS.md)、[資料マニフェスト](MATERIALS_MANIFEST.md)は参照資料です。画像や調査内容は現行の固定仕様を上書きしません。旧素材のマニフェスト値を今回検証済みとは扱いません。

| 旧版 | 現在の扱い |
|---|---|
| [v1.0計画](archive/v1.0/IMPLEMENTATION_PLAN.md) | 3問・16方向などの初期案。履歴のみ |
| [v1.1計画](archive/v1.1/IMPLEMENTATION_PLAN.md) | 5問・90問へ改定した旧版。履歴のみ |
| [v1.1変更記録](archive/v1.1/CHANGELOG.md)・[案内](archive/v1.1/PACKAGE_README.md) | 旧資料配布時の記録 |
| [v1.2計画](archive/v1.2/IMPLEMENTATION_PLAN.md)・[保存理由](archive/v1.2/README.md) | 変更前の原文を保存。切替・旧難度・ランキング工程は現行へ混ぜない |

現行仕様の優先順位は対応実装計画書に従います。
