# R5 公開品質検査記録

更新日: 2026-09-21 / 対象ブランチ: `chore/05-release-readiness` / 提出先: [Draft PR #10](https://github.com/chameleonjp-lab/sekibanmawashi/pull/10)

R5は、R4を取り込んだ基準main `0709e7ff2faaaf8b5e28e4038e60ca1872e118a5` から、共有・音・例外復旧・性能計測・権利記録・Pages手順・全体検査の準備を行う段階です。正式名と共有カード画像は未確定なので、表示名「石板回し」は仮表示として扱い、共有画像は設定していません。R6の公開指示、Pagesの設定変更、ランキング・Supabase・実験場本番データ変更はこの段階で行いません。

## 実装した範囲

- `src/sound.ts` に、回転・選択・点灯・成功・開始・エラーの6種をWeb Audioで合成する制御を追加しました。初期設定はONで、最初の利用者操作からAudioContextを作り、resume失敗・無音・連打・画面/問題境界・終了後の遅いresumeを安全に無視します。音のON/OFFは既存のv2端末保存を共有します。
- 成功時は成功音だけを鳴らし、回転音・点灯音との同時発音を避けました。結果画面への遷移後も成功音が途中で切れないよう、確定済み結果の画面側で短く再生します。
- ホーム、結果、問題庫確認、エラー画面の戻り先を共通URL設定から作り、起動・読込・予期しない例外に再試行、ホーム、実験場、利用可能な確定結果の導線を用意しました。例外境界は起動後のJS例外と未処理Promise拒否を対象にし、静的module import以前の配信失敗でもindexの初期フォールバックに日本語の再読込・ホーム・実験場リンクを残します。実URLの404検査ではこのフォールバックを含む配信物を確認します。
- `site.config.ts`、ViteのHTML変換、`index.html` を共通化し、言語・仮タイトル・説明・予定公開URL・faviconを一致させました。`public/favicon.svg` は旧試作の単純なSVGを内容確認のうえ採用し、旧OG画像は使っていません。共有カード画像は未確定のため `og:image` は未設定です。
- `PAGES_BUILD=1 npm run build` で `/sekibanmawashi/` baseの成果物を作れるようにし、手動のR6手順を [PAGES_PUBLICATION.md](../PAGES_PUBLICATION.md) に記録しました。Pages公開Workflowは追加していません。
- `scripts/r5-performance.mjs` と `scripts/check-licenses.mjs`、権利記録 [LEGAL.md](../LEGAL.md) を追加しました。CIではライセンスメタデータと性能測定を実行します。

## 標準自動検査

Node `24.19.0` / npm `11.9.0` / Linuxで次を実行しました。

| コマンド | 結果 | 証跡・補足 |
|---|---|---|
| `npm ci` | 未実施 | 既存の指定環境と `node_modules` を使用。クリーンCIで再実施する |
| `npm run typecheck` | 成功 | srcと追加readiness e2eを含む全体を検査 |
| `npm run lint` | 成功 | 39 source files |
| `npm run licenses:check` | 成功 | Apache-2.0:4、BSD-3-Clause:1、ISC:1、MIT:64 |
| `npm test` | 成功 | 72 tests, 0 failures |
| `npm run puzzles:test` | 成功 | P01-P09、fixed-seed 100,000 draws |
| `npm run build` | 成功 | Vite production build、JavaScript gzip 43,516 bytes |
| `npm run performance:r5` | 成功 | 90問×1,728状態、155,520 samples |
| `npm run test:e2e` | CI/ブラウザ担当で実行 | ローカルのpin版ブラウザは未取得。実行結果を下表へ追記する |

性能測定の観測値（通常 `npm run build` 後の `dist`、Node 24.19.0 / Linux、2026-09-21）は、JavaScript gzip 43,516 bytes、dist全体297,488 bytes、問題JSONの原文109,681 bytes・単独gzip診断値5,691 bytes、最大部品数11、判定時間p50 0.0327ms / p95 0.0573ms / max 3.6411msでした。問題JSONはViteによりJavaScriptへ内包されるため、5,691 bytesは別ネットワーク転送量ではありません。JavaScript圧縮後250KB、初回総転送700KB、判定5ms未満、最大12部品の目標はこの測定条件で満たしました。問題JSON 10KB以下の旧目標は、90問を一括で保持する原文には適用できず未達です。`performance:r5` は閾値で失敗させるゲートではなく測定出力であり、目標判定はこの記録の測定条件と分けて扱います。

## R5必須検査の状態

| ID | 状態 | 確認内容 |
|---|---|---|
| U01 | R4自動検査済み | 名前の空白・長さ・制御文字と有効名を確認 |
| U02 | R4自動検査済み | 結果から再挑戦・練習・ホーム、共通実験場リンク |
| U03 | R4自動検査済み / R5音境界追加 | 共有取消し・コピー失敗・選択可能文面、予定URL |
| U04 | 部分確認 | 仮タイトル・説明・言語・予定URL・faviconは共通化。正式名と共有画像は未確定 |
| U05 | 自動単体済み / e2e追記待ち | 6種音、初期ON、gesture unlock、OFF、resume失敗、境界失効 |
| Q01 | 標準自動検査済み | typecheck、lint、72単体、P01-P09、build、license、性能測定 |
| Q02 | ブラウザ担当/CI追記待ち | Chromium/WebKit全体、例外・Promise拒否・404 |
| Q03 | ブラウザ担当/CI追記待ち | 5問チャレンジ20回連続の状態・資源観測 |
| Q04 | 部分確認 | 正式版参照に旧切替・外部素材・秘密値なし、依存ライセンス記録 |
| Q05 | 未実施 | iPhone 17 Pro Safari、VoiceOver、ロック復帰、実機音 |

## main保護の提案（R5では設定しない）

GitHub APIで確認した今回の基準mainは保護されていません。R5では設定を変更せず、公開承認を得た別作業で次を提案します。mainへの直接pushと強制pushを禁止し、PR経由だけを許可し、承認1件以上・会話解決・ブランチ更新を必須にします。必須ステータスチェックのAPI contextは **`verify`**（GitHub Actions、`.github/workflows/ci.yml` の `CI` Workflow、`verify` job）で、GitHub画面では **`CI / verify`** と表示されます。このjobにtypecheck、lint、ライセンス、72単体、P01〜P09、build、性能出力、Chromium/WebKit readinessを含め、設定後はAPIのcontextとPR Checksの表示名が一致することを確認します。保護設定の変更と有効性確認はR6公開承認の前に別記録へ残します。

## 未実施・公開境界

ブラウザpin版のChromium/WebKit全体検査、iPhone実機、VoiceOver、iPhoneロック復帰、実機文字拡大・音、正式な共有画像と正式名の確定は未実施です。独立観点レビューは別担当の指摘と再検査を受けてから状態を更新します。これらが未完了の間は一般公開可とせず、公開はR6のユーザー指示後に行います。

ランキング、プレイ回数、Supabase、サーバー抽選、実験場本番データは変更していません。
