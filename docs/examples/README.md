# データ例の扱い

このフォルダーに以前からある [puzzle-definition.example.json](puzzle-definition.example.json) と [problem-pool.example.json](problem-pool.example.json) は、発光切替のある文書版1.2の形式例です。本番問題ではなく、常時発光の正式版にもそのまま使用しません。

R1の新しい形式例は [rotation-only-v2.json](../../content/examples/rotation-only-v2.json) です。`schemaVersion=2`、`rulesetVersion=stone-rings-v2`、回転量だけの状態、検証可能なチェックサムを持ちます。旧JSONは比較用に残します。

[v2形式文書](../spec/ROTATION_ONLY_V2_FORMAT.md)に公開問題と左右だけの操作履歴の契約を記載しています。この形式例は判定・読込を確認するためのもので、R2で採用する90問や難度の合格実績ではありません。[旧検査からの移行記録](../history/R1_TEST_MIGRATION.md)も参照してください。

旧形式を新規則へ黙って読み替える処理は作りません。最新条件は[対応実装計画書](../planning/IMPLEMENTATION_PLAN.md)の第1・3・4節を使います。
