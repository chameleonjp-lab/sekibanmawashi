# データ例の扱い

このフォルダーに以前からある [puzzle-definition.example.json](puzzle-definition.example.json) と [problem-pool.example.json](problem-pool.example.json) は、発光切替のある文書版1.2の形式例です。本番問題ではなく、常時発光の正式版にもそのまま使用しません。

今回のPRは文書だけを扱うため、既存JSONを変更しません。R1で `schemaVersion=2`、`rulesetVersion=stone-rings-v2`、回転量だけの状態、左右だけの操作履歴、検査可能なチェックサムを持つ新しい形式例を用意します。

旧形式を新規則へ黙って読み替える処理は作りません。最新条件は[対応実装計画書](../planning/IMPLEMENTATION_PLAN.md)の第1・3・4節を使います。
