# 対応PRの順序

現行基準は[実装計画書 v2.0](IMPLEMENTATION_PLAN.md)。R番号は計画の段階であり、GitHubのPR番号ではありません。旧v1.2の6段階と並行実行しません。

| 段階 | ブランチ例 | 対応範囲 | 次へ進む条件 |
|---|---|---|---|
| R0 | `docs/rotation-only-remediation-plan-v2` | 今回。計画と最新仕様への案内のみ | 文書検査成功、ユーザーがマージ |
| R1 | `feat/01-rotation-only-core` | 常時発光の判定・型・履歴・形式・最小構成・軽い自動検査 | K01〜K07、型検査・lint・test・build成功 |
| R2 | `feat/02-rotation-only-puzzles` | 難度検証、候補・90問・900券、再現可能な検査レポート | P01〜P09成功、確定した数値と採用理由を保存 |
| R3 | `feat/03-board-input-repair` | 受光紋と光路、入力、1問の画面、小画面・補助操作 | V/I検査の自動部分成功、未実機項目を明記 |
| R4 | `feat/04-run-timer-storage` | 5問進行、中断、時間、保存、結果、共有 | F/T/S/Uの実装範囲を正式アプリ全体で検査 |
| R5 | `chore/05-release-readiness` | 全体自動検査、共有・音、性能、独立レビュー、実機、公開準備 | 全必須検査と受入がそろう。未確認なら公開保留 |
| R6 | `chore/06-publication` | 公開指示後だけ。Pagesと実験場導線の実URL確認 | 公開先で一連の動作を確認。ランキングは別 |

各段階は、前のPRをユーザーがマージした最新mainから開始します。失敗した検査は同じ段階のPRで直します。mainへの直接push、マージ、自動マージ、保護設定の緩和はしません。

旧公式PR1〜4はR1〜R4に対応します。旧PR5の公開品質はR5へ、旧PR6の公開・掲載は条件付きR6へ分けました。サーバー・ランキングは延期で、R1〜R5の完了条件に含めません。

進捗の正本は[IMPLEMENTATION_PROGRESS.md](IMPLEMENTATION_PROGRESS.md)です。文書PRのマージをゲームの実装完了・公開完了にしません。
