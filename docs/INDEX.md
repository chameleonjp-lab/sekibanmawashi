# 資料一覧

このページは、資料の役割と現在使うべき版を示します。

## 試作プレビュー

| 資料 | 役割 |
|---|---|
| [`prototype/`](../prototype/) | プレイ可能な確認用。公式実装の完了条件は満たさない |
| [`prototype/NOTES.md`](../prototype/NOTES.md) | 公式計画との差 |
| [`prototype/UPLOAD_INVENTORY.md`](prototype/UPLOAD_INVENTORY.md) | 実装のアップロード確認。入れたもの・入れないもの |
| [`prototype/screenshots/`](prototype/screenshots/) | 試作の画面記録。本番素材ではない |

## 現在使う資料

| 資料 | 役割 |
|---|---|
| [`CURRENT_STATE.md`](../CURRENT_STATE.md) | 現在の決定、進み具合、未決定事項 |
| [`spec/CURRENT_GAME_SPEC.md`](spec/CURRENT_GAME_SPEC.md) | プレイヤーから見えるゲーム仕様 |
| [`planning/IMPLEMENTATION_PLAN.md`](planning/IMPLEMENTATION_PLAN.md) | 文書版1.2。6件のPull Request、検査、公開、安全対策の正本 |
| [`planning/PR_ROADMAP.md`](planning/PR_ROADMAP.md) | 6件の順序を短く確認する表 |

仕様が食い違う場合は、実装計画書の固定仕様を優先し、勝手にどちらかへ合わせず差異を報告します。

## データ形式の例

| 資料 | 注意 |
|---|---|
| [`examples/puzzle-definition.example.json`](examples/puzzle-definition.example.json) | 1問の形式例。本番問題ではありません |
| [`examples/problem-pool.example.json`](examples/problem-pool.example.json) | 90問問題庫の形式例。本番問題庫ではありません |

## 調査とデザイン

| 資料 | 状態 |
|---|---|
| [`research/original-logic-research.md`](research/original-logic-research.md) | 背景調査。現在の仕様や実装名の正本ではありません |
| [`design/DESIGN_HISTORY.md`](design/DESIGN_HISTORY.md) | 画面案の採否と注意点 |
| [`history/CHAT_DECISIONS.md`](history/CHAT_DECISIONS.md) | 会話で変更した判断の順序 |
| [`MATERIALS_MANIFEST.md`](MATERIALS_MANIFEST.md) | 保存資料のファイル名、容量、SHA-256 |

## 旧版

| 版 | 内容 | 現在の扱い |
|---|---|---|
| [`archive/v1.0/IMPLEMENTATION_PLAN.md`](archive/v1.0/IMPLEMENTATION_PLAN.md) | 3問、16方向、3〜4環の初期計画 | 不採用。履歴のみ |
| [`archive/v1.1/IMPLEMENTATION_PLAN.md`](archive/v1.1/IMPLEMENTATION_PLAN.md) | 5問、12方向、3環、90問問題庫へ更新した計画 | v1.2の直前版 |
| [`archive/v1.1/CHANGELOG.md`](archive/v1.1/CHANGELOG.md) | v1.1作成時の変更記録 | 履歴のみ |
| [`archive/v1.1/PACKAGE_README.md`](archive/v1.1/PACKAGE_README.md) | 会話で渡した計画書一式の案内 | 履歴のみ |

`docs/archive/`の内容を、最新計画へ自動的に混ぜないでください。
