# R5 公開品質検査記録

更新日: 2026-09-26 / 対象ブランチ: `chore/05-release-readiness` / 提出先: [Draft PR #10](https://github.com/chameleonjp-lab/sekibanmawashi/pull/10)

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
| `npm ci` | 成功 | 2026-09-26の新規cloneとGitHub CIの両方で実施 |
| `npm run typecheck` | 成功 | srcと追加readiness e2eを含む全体を検査 |
| `npm run lint` | 成功 | 39 source files |
| `npm run licenses:check` | 成功 | Apache-2.0:4、BSD-3-Clause:1、ISC:1、MIT:64 |
| `npm test` | 成功 | 72 tests, 0 failures |
| `npm run puzzles:test` | 成功 | P01-P09、fixed-seed 100,000 draws |
| `npm run build` | 成功 | Vite production build、JavaScript gzip 43,503 bytes |
| `npm run performance:r5` | 成功 | 90問×1,728状態、155,520 samples |
| `npm run test:e2e` | GitHub CIで再検査中 | 直近の全体実行は67成功・3失敗。下記の失敗・修正履歴とPR Checksを参照 |

性能測定の観測値（通常 `npm run build` 後の `dist`、Node 24.19.0 / Linux、2026-09-26、修正前head `3ad17c5226ab1026b7878678d1ae466f98c6722d`）は、JavaScript gzip 43,503 bytes、dist全体297,528 bytes、問題JSONの原文109,681 bytes・単独gzip診断値5,691 bytes、最大部品数11、判定時間p50 0.0329ms / p95 0.0543ms / max 6.1596msでした。

- JavaScript圧縮後250KBと最大12部品の目標は、この測定条件で満たしました。
- 初回総転送700KBは未実測です。distのファイルサイズをネットワーク総転送量の達成証拠にはしません。
- 問題JSON原文10KB以下は未達です。90問を一括保持する原文は109,681 bytesあり、ViteがJavaScriptへ内包します。単独gzip 5,691 bytesは別ネットワーク転送量ではありません。
- 判定5ms未満はp50/p95では満たしますが、今回の最大値6.1596msでは未達です。Linux/Nodeの経過時間であり、実機Safariの応答性を保証しません。2026-09-21の最大値3.6411msだけで達成を一般化した記載を訂正しました。

`performance:r5` は閾値で失敗させるゲートではなく測定出力です。測定スクリプトの成功と各性能目標の達成を分けて扱います。

## PR #10の失敗と再検査

| 対象head・CI | 結果 | 原因と対応 |
|---|---|---|
| `4771254dd7ddbbde16e22c0e3b4b83a5ceeec28e` / [35646403630](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/35646403630) | 画面52成功・14失敗 | 5問目の成功で盤面が結果画面へ置き換わった後も検査が旧盤面の手数を待っていた。結果行の確定手数を読むよう修正。375pxの通常画面の縦溢れも修正 |
| `3ad17c5226ab1026b7878678d1ae466f98c6722d` / [35650672638](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/35650672638) | smoke 4成功、全体67成功・3失敗 | Chromium/WebKitのQ03は最初の1回後のlistener数24が基準11+12を超えた。WebKitの844×390・文字200%で時間表示が2行と判定された。いずれも再試行でも失敗 |
| `10b4890902e2ddfeed97af100485825ba5038285` / [36250808417](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36250808417) | smoke 4成功、診断1成功・3失敗 | Q03の増分13は全てPlaywrightのInjectedScript由来（windowの監視1件とmouse/touch/pointer関連12件）で、注入前からある11件は不変。WebKitの時間欄は本文86pxに対して約106pxの値が2行に分割されており、画像でも実際の折返しを確認 |

先行レビューでは、音のresume拒否を実際に発生させる検査、音源stop失敗時の即時切断、遅いresumeの境界失効、結果画面が持つ成功音の寿命、例外後の再試行を補強しました。通常320/375pxと文字200%の配置を両立させ、1問確認用の時間説明は「記録なし」としました。規則や問題データは変更していません。

実装・不具合調査はLuna Max、独立レビューはSol Highです。ローカルでpin版ブラウザの取得が0-byte ZIPとなり失敗したため、実ブラウザの検査はGitHub CIで行います。CIのChromium/WebKitとiPhone実機Safariは区別します。失敗時の画像・集計JSONは各runの `browser-evidence` artifactに保存し、listenerの診断JSONも同梱します（14日保持）。

2026-09-26の独立レビューで、例外後の結果復旧がDOM複製だけのためボタンのイベント処理を失うことを発見しました。さらに例外境界と5問進行画面が別々に後始末を管理しており、境界から5問進行側のタイマー・イベント・音を停止できていませんでした。例外境界から進行画面の後始末を明示的に呼び、確定済み結果と保存警告をメモリ内で保持して通常の結果描画から復元するよう修正しました。カウントダウン/成功表示中の例外で古い処理が復旧画面を上書きしないこと、結果復旧後の共有・ホーム・再挑戦・練習を追加検査します。手数や時計を引き継いで古い挑戦を再開する変更ではありません。

診断後の修正では、読み取り専用の `home.evaluateAll` でPlaywrightの初回注入を先に済ませ、Q03のlistenerは基準値・直前値からの増加を許さず、全20回の資源スナップショットを保存します。横画面の時間欄は余白と列幅を調整し、実値と `900.00` の1行表示・内容幅への収まりを検査します。10画面寸法の状態検査は各寸法独立のtestに分割しました。各画面・操作・画像と両ブラウザは維持し、復旧検査も含めて全90件です。長い一括検査の途中失敗で後半の寸法が未実行にならない構成です。修正後の型検査・lint・72単体・buildとコード独立レビューは成功し、実ブラウザの最終結果はCIで確認します。

追加の幅計算で375/390px・文字200%の縦画面も `900.00` の余白が不足すると分かり、文字サイズを変えずにカードの左右余白を調整しました。15分を超えて続く参考記録は自動終了させず、小画面の時間値だけ必要に応じて折り返して全桁を残します。実値と `900.00` の1行検査は維持し、`1800.00` は値・カードとも横溢れしないことも検査します。規則や時間制限の変更ではありません。

## R5必須検査の状態

| ID | 状態 | 確認内容 |
|---|---|---|
| U01 | R4自動検査済み | 名前の空白・長さ・制御文字と有効名を確認 |
| U02 | R4自動検査済み | 結果から再挑戦・練習・ホーム、共通実験場リンク |
| U03 | R4自動検査済み / R5音境界追加 | 共有取消し・コピー失敗・選択可能文面、予定URL |
| U04 | 部分確認 | 仮タイトル・説明・言語・予定URL・faviconは共通化。正式名と共有画像は未確定 |
| U05 | 単体・先行CI成功 / 修正後再検査中 | 6種音、初期ON、gesture unlock、OFF、resume失敗、境界失効 |
| Q01 | 標準自動検査済み | typecheck、lint、72単体、P01-P09、build、license、性能測定 |
| Q02 | 修正後CI検査中 | Chromium/WebKit全体、例外・Promise拒否・404、例外後のタイマー停止・結果操作復旧 |
| Q03 | 修正後CI検査中 | 5問チャレンジ20回連続の状態・資源観測。検査ツールの初回注入を基準値取得前に済ませ、20回のlistener数は初期値・直前値から増えないことを確認する |
| Q04 | 部分確認 | 正式版参照に旧切替・外部素材・秘密値なし、依存ライセンス記録 |
| Q05 | 未実施 | iPhone 17 Pro Safari、VoiceOver、ロック復帰、実機音 |

## main保護の提案（R5では設定しない）

GitHub APIで確認した今回の基準mainは保護されていません。R5では設定を変更せず、公開承認を得た別作業で次を提案します。mainへの直接pushと強制pushを禁止し、PR経由だけを許可し、承認1件以上・会話解決・ブランチ更新を必須にします。必須ステータスチェックのAPI contextは **`verify`**（GitHub Actions、`.github/workflows/ci.yml` の `CI` Workflow、`verify` job）で、GitHub画面では **`CI / verify`** と表示されます。このjobにtypecheck、lint、ライセンス、72単体、P01〜P09、build、性能出力、Chromium/WebKit readinessを含め、設定後はAPIのcontextとPR Checksの表示名が一致することを確認します。保護設定の変更と有効性確認はR6公開承認の前に別記録へ残します。

## 未実施・公開境界

最新版でのChromium/WebKit全体合格は再検査中です。実装・テストはLuna Max、独立したコードレビューはSol Highが担当し、画像・集計JSONと修正後CIを確認して最終状態を更新します。資源検査は計器で観測したDOM・イベント・タイマー・音源・取得資源の範囲であり、JavaScriptヒープ全体の無漏洩を証明するものではありません。

iPhone実機、VoiceOver、iPhoneロック復帰、実機文字拡大・音、正式な共有画像と正式名の確定は未実施です。これらが未完了の間は一般公開可とせず、公開はR6のユーザー指示後に行います。

ランキング、プレイ回数、Supabase、サーバー抽選、実験場本番データは変更していません。
