# 2026-09-21レビューの基準と限界

対象コミット: `f5bca3572539c450294a9e7603510fc1bdd50005`
対象: `prototype/` の旧規則と文書版1.2。ランキング連携は対象外。

## 引き継ぐ結果

前回の会話で提示したレビューと検査記録を基準とする。旧規則で既存17検査が成功し、90問は初期完成なしで全問解法再生に成功した。全90問×13,824状態の到達判定を別計算と照合し、不一致はなかった。900組は各組の難度構成と問題の出現回数を満たした。

これらは旧版の結果であり、今回の文書PRで再実行した結果ではない。回転専用の規則へ変更した後は、1,728状態・6操作で別途再検査する。旧成績・旧問題を版だけ付け替えて合格扱いにしない。

## 指摘の証拠範囲

A01（盤面の欠け）、A02（遮断終点の表示）は元の盤面部品を切り出した描画検査。A03（水平・垂直の光）は最小の独立描画例。A04（古い遷移）、A05（キー競合）は処理を切り出した補助検査。いずれもReactアプリ全体やiPhone実機での再現と同一ではない。

A06（旧難度表との差）、A07（組合せ難度）、D01（切替の役割）、D02（完成配置と操作列の件数）、B01〜B06（保存、時計、データ検査、操作、共有、待ち時間）も、[対応表](../planning/IMPLEMENTATION_PLAN.md)で漏れなく扱う。

旧90問の重複防止に不足があるという指摘は、現在の90問に実際の重複を検出したという意味ではない。時計補完の不足も、単なる別タブ移動で必ず時間が停止したという意味ではない。

## 未確認

依存をそろえた本番ビルド・型検査の再実行、正式アプリ全体のChromium/WebKit操作、iPhone 17 Pro Safari実機、VoiceOver、ロック復帰、実端末の音・発熱・消費電力、公開URLの動作は前回レビューの完了項目ではない。今回も文書作成のため、実行したと報告しない。

## 原コードと旧計画

以下は基準コミットに固定した参照。旧実装を参照するためのもので、最新版を意味しない。

- [判定](https://github.com/chameleonjp-lab/sekibanmawashi/blob/f5bca3572539c450294a9e7603510fc1bdd50005/prototype/src/game/engine.ts)と[探索](https://github.com/chameleonjp-lab/sekibanmawashi/blob/f5bca3572539c450294a9e7603510fc1bdd50005/prototype/src/game/solver.ts)
- [盤面](https://github.com/chameleonjp-lab/sekibanmawashi/blob/f5bca3572539c450294a9e7603510fc1bdd50005/prototype/src/components/StoneBoard.tsx)と[画面進行](https://github.com/chameleonjp-lab/sekibanmawashi/blob/f5bca3572539c450294a9e7603510fc1bdd50005/prototype/src/components/GameApp.tsx)
- [問題生成](https://github.com/chameleonjp-lab/sekibanmawashi/blob/f5bca3572539c450294a9e7603510fc1bdd50005/prototype/tools/generate-puzzles.ts)と[保存](https://github.com/chameleonjp-lab/sekibanmawashi/blob/f5bca3572539c450294a9e7603510fc1bdd50005/prototype/src/game/storage.ts)
- [旧計画の保存原文](../archive/v1.2/IMPLEMENTATION_PLAN.md)
