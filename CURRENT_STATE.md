# 現在の状態

更新日: 2026-09-29 JST / 対象: `chameleonjp-lab/sekibanmawashi`

## 最新公開状況（2026-09-29）

[PR #18](https://github.com/chameleonjp-lab/sekibanmawashi/pull/18)はmainへマージ済みです。merge commitは `41e18e2f05ca39b874e874105b76ce0895adb2dc` です。同じcommitのmain push [CI run 36534850625](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36534850625)で、静的検査、Chromium、WebKit、必須 `verify` がすべて成功しました。

[Publish Pages run 36541668581](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36541668581)も成功し、build、deploy、公開後HTTP検査が通りました。公開中のURLは https://chameleonjp-lab.github.io/sekibanmawashi/ です。Pagesの `version.json` と共有PNG・画面資産は公開workflowの検査で確認済みです。

実URLを開き、ホーム画面と練習用の盤面を確認しました。石板、黒い遮光区画、更新後の日本語表示、ゲーム画面に音設定が出ないことを目視確認しています。実機iPhoneでのQ05は未実施で、今回のR6公開に限る免除は[PR #14の記録](https://github.com/chameleonjp-lab/sekibanmawashi/pull/14#issuecomment-5861153503)に基づきます。実機受入済みとは扱いません。

## 結論

最新の実装基準は[対応実装計画書 文書版2.1](docs/planning/IMPLEMENTATION_PLAN.md)です。PR #17の画面改善とPR #18の共有画像更新はmainへ入り、R6最新版を `41e18e2f05ca39b874e874105b76ce0895adb2dc` で公開しました。main CI run 36534850625とPages run 36541668581が成功し、公開URLでホームと練習画面を確認しました。

Q05（iPhone 17 Proの物理Safari、VoiceOver、ロック復帰、実機音）は未実施です。今回のR6公開に限る免除が記録されていますが、実機確認済みとはしません。ランキングやSupabaseの接続は今回の変更に含みません。

| 項目 | 決定・状態 |
|---|---|
| 盤面 | 12方向、可動輪3本、外周の目標へ光を届ける |
| 操作 | 輪を選び、左か右へ回す |
| 成功 | 必須の目標がすべて光れば成功。余分な光は許可 |
| 問題庫 | 初級30・中級30・上級30。1回の挑戦は初級2・中級2・上級1の5問 |
| 接続 | 端末内で完結。ランキング・プレイ回数・Supabaseは対象外 |
| 正式名・URL | 「セキバンマワシ」 / https://chameleonjp-lab.github.io/sekibanmawashi/ |
| 公開 | PR #18 merge commit `41e18e2f05ca39b874e874105b76ce0895adb2dc` をPages run [36541668581](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36541668581)で公開済み。CI [36534850625](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36534850625)、公開後HTTP検査とも成功 |
| 主対象 | iPhone Safari。横画面・PCも同じ規則で検査 |

## 完了・未完了の区別

旧試作のコード・90問・900券・画像資料は存在します。前回レビューでは旧規則の判定と部分描画などを検査しました。詳しい限界は[レビュー基準記録](docs/reviews/REVIEW_BASELINE_2026-09-21.md)を参照してください。

PR #5で計画と仕様を更新しました。R1では、常時発光の到達・遮断判定、回転のみの1,728状態、問題形式の実行時検証、回転履歴の再生と検査基盤を実装しました。検査結果と独立レビューの状況は[進捗表](docs/planning/IMPLEMENTATION_PROGRESS.md)に記録します。

R2で新90問・900組、難度条件、重複排除、再生成、独立計算と抽選の検査を追加しました。[R2検査記録](docs/reviews/R2_VERIFICATION.md)と[HTMLレポート](reports/r2/report.html)で結果を確認できます。R1用の形式例は採用90問とは別です。

R4で5問進行・時計・保存・結果・共有を追加し、[PR #9](https://github.com/chameleonjp-lab/sekibanmawashi/pull/9)へマージしました。通常URLはホーム、`?puzzleId=` はR3の1問確認用として分けます。正式アプリ全体の実機受入は未完了で、自動検査と人による試遊・実機受入を同じ扱いにはしません。

## 次に残る確認

R6の公開操作は完了しています。今後Q05を実施する場合は、iPhone 17 Proの物理Safari、VoiceOver、画面ロック復帰、実機音を個別に確認し、今回の限定免除とは分けて記録します。ランキング・Supabase・実験場のサーバー側変更は対象外のままです。

## 公開後の確認範囲

Q05は未実施ですが、今回のR6公開に限る個別免除が[PR #14](https://github.com/chameleonjp-lab/sekibanmawashi/pull/14#issuecomment-5861153503)にあります。公開workflowのHTTP検査とChromium/WebKitのCIは成功しました。実URLではホーム画面と練習用のゲーム画面までを確認し、5問を最後まで完了する実URLの手動確認はしていません。

ランキング、プレイ回数、Supabase、実験場の本番データは変更していません。

## PR #17マージ後の公開準備記録（履歴）

以下はPR #18のマージ前に記録した経過です。現在の公開状態はこの文書の冒頭を参照してください。

PR #17はmainへマージ済みです。PR headのCI 36484289084は成功し、main merge commitは f069923c249c20b1c553296c8af0f96d3035f8f6 です。main push CI 36507252037は60分上限でbrowser検査中にキャンセルされました。iPhone実機・VoiceOverは未確認です。

共有画像と運用記録は[PR #18](https://github.com/chameleonjp-lab/sekibanmawashi/pull/18)で更新中です。run 36510123886 と run 36510468751 の attempt 1 は、`Run browser tests` 中に60分のjob上限へ達してキャンセルされました。そこまでの型検査、lint、単体検査、問題庫検査、build、Pages artifact検査、性能検査、短いbrowser検査は成功しています。run 36510468751 の attempt 2 は古いheadでの実行で、更新後のworkflowは検証しません。main push CI 36507252037 も同じ60分上限でbrowser検査中にキャンセルされ、成功していません。最新版CIは文書・workflow・共有画像のみならbrowser検査をskipし、ゲームやテストの変更では実行する方針です。最新headのCI成功まではマージ・公開へ進みません。
