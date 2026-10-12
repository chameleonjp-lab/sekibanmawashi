# 石板と光をthree.jsで改善した記録

日付: 2026-10-12 JST。基準main: `2deac6db6bfe3a33f18012eef64cabd4e9e4a096`（PR #22マージ後）。作業branch: `feat/three-stone-light-20261012`。提出はDraft PR、マージ・本番公開はユーザーが別に判断します。

最新の後続修正は、所有者がPR #23をマージしたmain `7b067b2898e6e98fec9f775ad384fe93988fe975` を基準とする`fix/three-webkit-lifecycle-20261012`です。元PRとmainの正式CI失敗、同contextの再使用、検査条件を保った観測/待機の修正、新Draft PRについては末尾に記録します。以下の初回提出時の検査と方針は、その時点の履歴として保持します。

## 指定と変更範囲

ユーザー指定は、three.jsとChatGPTで生成した画像の素材を組み合わせ、石板と光をリアルにすることです。従来のSVG固定・生成画像不使用という実装方法は今回の表示に限って更新しました。3輪/12方向、常時発光、最初の遮断、回転操作、90問/900組、時計、保存、音、成功後1500msというゲームの規則は変えません。ランキング・通信・外部サービス・本番公開も変更しません。

`src/three-board.ts` が三次元表示の所有者です。石の厚みと丸い縁、生成画像の色・小さな凹凸・粗さ、白金色の光の芯と柔らかい広がり、同じ光路に沿う石への照り返しを追加しました。石の凹凸は画像の明るさからの近似で、測定した物性ではありません。光と照り返しは既存の判定から渡す同じstart/endを使い、遮断点を越えて伸ばしません。

SVGは透明な選択・読み上げ層と代替表示として残しました。WebGL・画像が使えない場合、context lost、描画例外ではSVGへ戻り、回転と手数を保ちます。表示中は1つのrendererと固定geometry/materialを再利用し、毎フレーム判定をやり直しません。状態変更とサイズ変更でだけ描画を予約します。中断・画面変更・非表示で資源を解放し、戻った時は現在の状態で作り直します。遅い画像の応答が終了済みの画面へ描画を戻すことはありません。成功した石画像はCPU側で1枚だけ共有し、GPU側のtextureは各表示の終了時に解放します。

素材と完全な生成指示は[素材記録](../assets/STONE_TEXTURE_MANIFEST.md)、固定依存と配布するMIT全文は[権利記録](../LEGAL.md)を参照してください。共有カードの実プレイ部分も今回の画面から撮り直しました。

共有カードは1200×630で、通常の名前入力→練習開始→操作可能になった実画面を撮り、タイトルとURLを組み合わせて更新しました。盤面や目標数を画像用に合成していません。

## 画像で確認した内容

[旧盤面](three-stone-20261012/before-board.png)と[新盤面](three-stone-20261012/after-board.png)、[402×874の新画面](three-stone-20261012/after-402.png)、[844×390の新画面](three-stone-20261012/after-844-landscape.png)、[実際の練習画面](three-stone-20261012/actual-play-402.png)を保存しています。新しい生成石素材が盤面に貼られ、黒い区画、未点灯の×/点灯の+、光の芯、輪の縁と表面の陰影を実見しました。

撮影と以下の補助ブラウザー検査はLinux/Node 24.19.0/npm 11.9.0、補助Chromium153.0.8010.0＋SwiftShaderで行いました。日本語フォントのない環境だったため、比較画像はGoogle FontsのNoto Sans JPを確認用のページへ一時注入しています。ゲームへの新しいフォント依存は追加していません。正式なPlaywright pin版・物理iPhoneの代わりにはしません。

## 自動検査と失敗からの確認

型検査、lint（41 files）、依存ライセンス、単体74件、問題庫P01–P09（10万回抽選）、Pages baseのbuild、Pages artifactの検査は成功しました。`three`/`@types/three` は0.180.0へ完全固定しています。配布するthreeのMIT全文はインストール済みLICENSEと完全一致しました。

古いbuildの出力が重なった初回の資源集計は採用せず、出力先を新しくして測り直しました。JavaScript gzipは170,692 bytes（250KB目標以内）、CSS gzipは約4.67KB、生成石画像は394,436 bytes。問題90問・155,520状態の判定時間はp95約0.068ms、最大約4.537ms、最大部品数11でした。これらはLinuxでの合成計測で、実機フレーム速度や実URLの初回転送量の実測とは区別します。問題JSONの生サイズ109,681 bytesという従来の未達も、描画改善で達成済みへ置き換えません。

`e2e/three-board.spec.ts` の追加9項目は補助Chromiumで成功しました（8項目と遮断終点1項目を分けて実行）。SVGの属性だけを確認する従来検査に加え、実canvasのスクリーンショットを復号して画素を読みます。

| 検査 | 確認した範囲 |
|---|---|
| THREE01–03 | 実canvasと素材読込、操作層との矩形一致、12方向すべての光の実画素、黒い30度区画の暗さ |
| THREE09 | 内向き/外向きそれぞれで最初の黒い遮断点の前後を読み、先へ光が続かない |
| THREE04–06 | 同canvasで12回転・横回転・説明、実context lost/restore、WebGLなし、画像読込失敗後の操作 |
| THREE07–08 | WebGLのbuffer/texture/program/framebuffer実計器で36回転後の資源数一致、練習中断3回後に生きたcontextと資源0、終了後の遅い画像が古い描画を復活させない |

初回の検査には環境由来の失敗がありました。標準browserのCDNがZIPではない195-byte HTMLを返し、取得できませんでした。公式CfTからpin版153.0.8010.12を取得・検証しても、ローカルの起動で実行権限/不完全なファイルやprocess singletonのsocket拒否が発生しました。この経路の失敗をゲーム合格とせず、起動できる補助ブラウザーで表示を確認し、正式2ブラウザーはGitHub CIへ残します。

検査コードの`this`型・閉じ括弧不足を修正しました。またcontext lost中にextensionを再取得するとnullになるため、復帰の検査では失う前に得た同じextensionを保持して`restoreContext()`を呼ぶ形へ直しました。修正後は実際の石が再描画され、手数とcanvasの同一性を確認しました。描画例外の保護も入力更新・context復帰・画像応答・表示破棄まで広げました。

## 独立担当レビュー

実装は6.1Sol Max、独立レビューは6.1Sol Extra Highが担当しました。最新版のコードと5画像を別担当が読み直し、修正必須の重大・通常の指摘は見つかりませんでした。色画像はSRGB、凹凸/粗さはNoColorSpaceの別texture、24光路の上限、共有光路、描画再利用、資源解放、遅い画像、Pagesの画像パス、MIT全文と生成画像SHA-256を確認しています。

独立実行は補助Chromiumで行いました。10指定寸法×通常/ルート200%の20組で、横溢れ0・操作重なり0・主要ボタン48px以上、canvasと操作領域の一致を確認しました。非表示/ページ離脱→復帰で状態と手数を保持し、描画例外を注入してもSVGで操作でき、pageerrorは0でした。この確認を正式2ブラウザー・5問連続・物理iPhoneの合格には含めません。

## 最終PR検査と未確認

この節は初回Draft PR提出時の方針です。その後の元PRマージ確認と後続Draft PRへの修正提出は末尾を参照してください。

[Draft PR #23](https://github.com/chameleonjp-lab/sekibanmawashi/pull/23)へ提出し、最終headのCIでは従来の全体検査と追加9項目をChromium/WebKitで実行します。失敗時は同じPRで原因を修正し、各headの正式CI結果と最終集計をPR本文・Checksへ残します。従来Q03の20回×5問を省略せず、追加の3回中断/GPU検査だけで代用しません。

iPhoneの物理実機、VoiceOver、実機ロック復帰、実機音は未確認です。今回のマージ・本番公開は未実施で、一般公開可とは判定していません。

## 送信前の追加確認と承認待ちの履歴

追加9項目と従来R3の14項目を併せた補助ブラウザー検査は、初回22成功・通常V02の1失敗でした。全90問の光路、各方向、回転・タップ・キー・成功固定は成功です。通常V02では日本語フォントのない環境でヘッダーのボタン幅が43.59375pxまで縮んだため、狭幅の`min-width: 0`を`3rem`へ最小修正しました。通常/文字200%の10寸法を再実行して2件成功、CSS1行を別担当が独立確認して指摘なしでした。並行したローカル検査の出力先が衝突し、traceファイルの後処理でENOENTも起きたため、出力先を分けて再確認しました。検査条件は弱めていません。

2026-10-12、GitHubへの送信は自動承認審査で2回拒否されました。既存の送信先・PR運用指示・今回の添付資料・秘密情報のない変更内容を照合しても、『今回の特定送信先とコード/生成画像のpayloadを公開するユーザー本人の明示承認がない』と判断されました。別APIや別経路で回避せず、送信を停止しました。この時点ではremoteの作業branchは存在せず、Draft PRとGitHub CIは未作成でした。

承認対象は公開リポジトリ`chameleonjp-lab/sekibanmawashi`の新しい作業branchへ、描画コード・石素材・実プレイ画像・検査・記録の計25ファイルを送信し、main宛てのDraft PRを作る操作です。mainへの直接push、マージ、本番公開は含みません。

追加の5問進行F01/F02と、成功前後の連打・誤拡大防止F02/I03も補助Chromiumで成功しました。Q03の20回×5問は、初回は20個の資源記録と検査本体を終えた後、衝突したtraceファイルの後処理でENOENTとなりました。出力先を独立させ、補助環境ではtraceの収録だけをOFFにして同じQ03を最初から再実行し、20回すべてとrunner終了が成功しました（約6分）。進行・保存・DOM/タイマー/接続listener/audio資源の検査条件は変更していません。正式CIは元のtrace設定と両browserを維持します。このローカル成功も、未実行のGitHub CIや物理iPhoneの確認とは分けて扱います。

## 2026-10-13 後続対応の再開

上記の送信先・25ファイル・Draft PRと検査の成功までの対応を提示した確認に対し、ユーザーが「後続対応開始」と指示しました。同じ送信範囲で作業を再開し、基準mainが引き続き`2deac6db6bfe3a33f18012eef64cabd4e9e4a096`で、重複するopen PRがないことを再確認しました。Git pushは認証情報が設定されておらず失敗したため、連携済みGitHubの通常の接続を使います。過去の承認拒否を別経路で迂回したものではなく、今回の再開指示に基づく対応です。mainへの直接push、マージ、公開、検査条件の緩和は行いません。

25個の送信blobと提出treeがローカルの検査対象に一致することを確認し、`1e7527a35e459be9fdaba3c3b37db68b66dbf607`でDraft PR #23を作成しました。GitHubから同じtreeをfetchし、元のローカル作業branchを保存したままPR追従用のローカルbranchへ切り替えました。正式CIの結果は上記PRに集約し、ローカルの補助ブラウザー結果とは区別します。

## 初回正式CIの失敗と修正

PRリンク記録を追加したhead `b5e5aa46e6e39f4bee8c7d57a03c5dec4daf14a6` の[run 38287922273](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/38287922273)は、静的検査成功、Chromium60件成功（37.7分、flaky/skipなし）、WebKit56件成功/4件失敗（再試行も失敗）、最終`verify`失敗でした。WebKitの初回追加THREE01–09はすべて成功です。最初のrun 38287720172は記録追記で自動キャンセルされており、全体合格には数えません。

失敗ログ、WebKitの集計JSON、DOM記録と画像を独立担当も確認しました。F02最終問の画像は結果画面で、盤面は既に切断されていました。F03と300手超の失敗時は5問画面と有効な操作列があり、時間枠超過を盤面欠損や永久停止と断定しません。Q03は20回/100問の進行と資源記録まで完了後、consoleのWebGL警告で失敗しました。

| 失敗 | 原因と条件を維持した対応 |
|---|---|
| Q03 | runごとに新canvas/contextを作り、WebKitのnative context枠が20回で累積。ページ内で1個のcontext/canvasを貸し出し、終了時GPU dispose/guard付きloss、次の所有者はlostイベント完了後に同contextをrestore。console error0を維持 |
| F02最終問 | 成功後の多数のbrowser往復が1500msの表示時間を消費。実際の最終回転前にbrowser内observerを設置し、同一の接続済み盤面・1px以内・左右14片・1000ms時点を採取。native timer呼出前から結果まで実時間1500ms以上も確認 |
| F03/F04 | 全5境界の成功前後10枝を1テストへ集約して時間枠超過。各境界を個別ケースへ分割し、各300秒は変更せず、全10枝・保留割当・中断・1700ms後のstale callback不在を保持 |
| T04/F05 | 302回の実回転は確認済みで、後続の5問進行中に180秒超過。固定fixtureのoracleを再使用し、実際に選択済みの同じ輪への冗長clickだけ省略。全302回転は実button.click、5問結果/参考扱い、180秒は維持。段階別test.stepも記録 |

修正した`BoardSurface`は単一所有者で、別hostが動いても追加contextを作りません。遅いrestore後に所有者がいない場合は再びlossへ戻し、終了済みのview/画像応答を復活させません。renderer/scene constructor途中の例外では、割り当て済みGPU資源とcanvasのThree listenerを巻き戻します。これは[Khronos WEBGL_lose_context仕様](https://registry.khronos.org/webgl/extensions/WEBGL_lose_context/)の、already-lostへのlose禁止・lostイベント完了後のrestore・extension保持に合わせています。WebKitの[Bug 218305](https://bugs.webkit.org/show_bug.cgi?id=218305)にも16枠超で同じ警告が報告されていますが、今回の原因判定は今回の実ログと20回検査によります。

THREE07は3回中断から20回の中断/再開へ検査範囲を増やしました。毎回three表示・素材ready・同canvas・操作可能、lostを除外しないnative context作成数1、終了後live/GPU0、console error0を検査します。増えた検査範囲に合わせこの追加ケースの枠は120秒から240秒にしました。従来Q03の全20回完走は省略せず、THREE07で代用しません。THREE10はrestore投入直後の中断と遅い復帰、THREE11はrenderer/scene構築途中の2種類の例外とlistener/GPUのrollbackを追加。検査一覧は各browser66件、両browser計132件です。

実装6.1Sol Maxと独立レビュー6.1Sol Extra Highを分離し、partial constructor cleanupとF02の実時間1500ms確認の指摘は修正しました。最終差分に修正必須の指摘なし。独立の型検査・lint41・diff check成功、単体74/74成功。実コードのBoardSurfaceをmock native event/task queueで動かした補助確認でも、所有者排他・未送信restore取消・遅いrestoreのidle化・外部lossの扱い・pending task/event0を確認しました。これを実GPU/両browser/Q03の成功の代用にはしません。

作業中にscratchが失われたため、提出済みのbranchを同じheadからcloneし直し、npm ciで復元しました。正式WebKit26.6 v2359は取得成功しましたが、OS依存導入はsetgroups/uidの権限拒否で停止しました。公式ChromiumはCDNの非ZIP応答で取得失敗、補助browserの展開もchownの環境制約で停止しており、この時点のローカルbrowser runtimeは未確認です。権限制限を迂回しません。当初は同じPRで再実行する予定でしたが、元PRのマージを確認したため、末尾の後続Draft PRへ修正を提出します。

CIのnpm ciには既存の開発用`source-map-js@1.2.1`（Vite→PostCSS）に高severity 1件の監査警告があります。基準mainも同じlockで、今回のthree追加の新規依存ではありません。今回この依存を変更せず、監査が無警告とは報告しません。

## 元PRのマージを確認した後の修正提出

修正tree `f798e26ba42e2ae340e9d28142a385bf2f95ed07` と6個のblobを検査対象と照合し、旧branchへ`b667db80eed83ca0bdccd0382d57e8113c3a3a70`をfast-forwardした時点で、新CIが起動しないことを調べました。PR #23は初回CI進行中の2026-10-12 18:00:33 UTC（翌日03:00:33 JST）、所有者`chameleonjp-lab`がマージ済みでした。Codexはマージしていません。元PRはhead `b5e5aa46e6e39f4bee8c7d57a03c5dec4daf14a6`、merge commitは`7b067b2898e6e98fec9f775ad384fe93988fe975`です。先の『Draft維持・マージ未実施』はCodex自身の操作範囲についての記録で、現在のPR #23の状態ではありません。

最新mainのtree `fb32aa424c03a7114c4bcf08b06ae67db210112e` は元PR headのtreeと同一です。同mainの[run 38288027604](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/38288027604)も、静的成功、Chromium56成功/4失敗、WebKit56成功/3失敗とF02のflaky1件、verify失敗でした。WebKitの3最終失敗はF03/F04・300手超・Q03。ChromiumはF02・F03/F04・300手超に加え、V01全90問の検査がhard26へのnavigation中に180秒の枠を超え、再試行も失敗しています。

V01は全90問をCIの検査用アプリURLから開き、全ての従来の光路/寸法/遮断/12方向の集合集計、10問おきの画像、180秒を保持します。各navigationの固定500ms network-idle待ちをやめ、このケースだけdomcontentloadedと実際のthree表示・素材readyを待つよう変更しました。他のopenGame呼出は従来どおりnetworkidleを使います。正式CIでこのreadinessと操作時間を再確認します。

閉じた元PRを再開・マージ取消し・mainへ直接pushせず、最新mainから`fix/three-webkit-lifecycle-20261012`を作り、7ファイルの修正を後続Draft PRで提出します。送信済み素材/画像を再生成せず、元のゲーム規則を変更しません。後続PRのリンク・head・各正式CIの結果はPR本文とChecks、保存用検査記録へ集約します。Codexによるマージ・本番公開は行いません。

## 後続Draft PRの正式CI第1回と残る長操作ケース

[PR #24](https://github.com/chameleonjp-lab/sekibanmawashi/pull/24)のhead `436912c8e3135f39da8f7eff24fce1d311e324b1` / tree `156be22918d577f0fb47481b060eecb793c5a1c9` に対する[run38300415279](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/38300415279)は、静的検査成功、Chromium66件すべて初回成功（35.1分）、WebKit65件成功/1件失敗（同件retryも失敗、50.3分）、verify失敗でした。flaky/skipは両browserとも0。CI検査用merge commit88ed32bb6fdb7ac952ad7d9717fb81c6a3f42761のtreeは提出headと一致しています。これはmainへのマージではありません。

独立担当はChromiumの全件JSON、描画画像、GPU/DOM/audio資源記録を確認しました。V01全90問137.298秒、302実回転と5問完走146.086秒は従来180秒以内。Q03全20回/100問は599.759秒で、終了時のactive audio/oscillator0、DOM/listener/timer資源は定常範囲です。THREE07ではnative作成数1、全20回終了後live context/GPU0、THREE11でも初期化途中のrollback後にlive/GPU0。THREE10は成功ですがinline GPU JSONの添付はなく、存在しない記録を確認済みとはしません。画像の確認対象は1問の盤面で、5問完了画面や物理iPhoneではありません。

WebKitでもV01全90問/12方向、F02実時間1500ms/1px、全5境界10枝、THREE01–11、Q03全20回/100問（13.5分）は初回成功。native枠の累積警告と成功盤面の観測競合は再発していません。残件はT04/F05だけで、両試行ともMoveCount302まで検査が進んだ後、5問完走の途中で180秒の総予算を超えました。

| T04/F05の実記録 | 初回 | 再試行 |
|---|---:|---:|
| 302回転のstep | 152.856秒 | 161.020秒 |
| 302件click APIの合計 | 137.234秒 | 143.517秒 |
| 1回のclick API平均 | 454.416ms | 475.221ms |
| その後に完了した検査step | 第1–3問step（第4問stepの回転API中に期限） | 第1–3問step（次問のplaying待機中に期限） |

独立trace解析で、初回の302操作にはvisible/enabled/stableのactionability再試行・隠蔽・無効化がありませんでした。入力停止や永久に不安定なボタンではなく、各操作のDOM/描画/traceを伴う処理時間が累積しています。描画固有のGPU負荷だけへ帰属することは推論で、native profileによる断定ではありません。実行環境はLinux Desktop Safari設定、1280×720、DPR2、trace/videoありで、物理iPhoneではありません。

時間上限、302実button click、全5問と参考結果、trace/video、viewport/DPR、形状・素材・光路品質を維持して、6.1Sol Maxが描画・DOM再構築の軽減を実装し、6.1Sol Extra Highが別担当レビューを行います。最終headで従来全66件に新しいTHREE12を加えた各67件・計134件とverifyを再実行し、前headのChromium成功だけを最新headへ流用しません。各headの実行結果はPR本文/Checksと保存用検査記録へ記録し、全体成功まではDraftを維持します。

## 長操作の負荷軽減と別担当レビュー

6.1Sol Maxが`src/three-board.ts`と`e2e/three-board.spec.ts`を対応しました。Basic/Standardの不透明装飾だけを固定容量InstancedMeshにまとめ、同じgeometry/material/行列/描画順（停止線35）を保ちます。石、光の芯、halo、照り返しのcustom shaderは変更せず、輪の192分割・三角形数・素材・照明・DPRも維持。空のbatchも初回からrendererへ登録し、後からの点灯でGPU buffer/programが増えないようにし、破棄時はinstance bufferもdisposeします。

操作/読み上げ/描画不能時のSVGは、問題ごとに回転・選択輪・disabledで識別する最大12状態のLRUで再使用します。問題切替とview破棄でclear。入力hitだけは更新ごとに新しくし、更新時の世代付きoptionsを捕捉して、disposed/disabled・切断済みhit・現在とは別SVG/問題からの遅いイベントを拒否します。現在の問題へ古いcallbackを付け替える方式にはしていません。

実際の新旧StoneSceneとreal threeのgeometry/matrixを使った補助CPU比較を、実装担当・親担当・独立担当がそれぞれ実行しました。rendererはmockで、native GPU測定ではありません。元sourceはhead436912の全文とSHAが一致。90問×3輪×4角度の1080代表状態で頂点/normal/UV/index、材質/描画順、primitive数/三角形数、照り返しの光路uniformが一致し、行列差の最大3.6625e-6はinstanceのfloat32化による範囲です。全90問×1728状態の実画像一致を確認したという意味ではありません。

| CPUコードからの可視draw見積り | 修正前 | 修正後 |
|---|---:|---:|
| 1080状態の平均 | 143.37 | 58.58 |
| 最小–最大 | 104–190 | 43–78 |
| THREE07の初期fixture | 184 | 72 |
| 同fixture三角形数 | 170284 | 170284 |

THREE07の既存GPU検査にnative draw APIの計器を加え、72 draw/170284 triangles/125 instancesの実frameと36回転後の再一致を検査します。GPU資源数の定常・全20中断再開・native作成数1・idle0・console error0もそのまま保持。これは正式CIまでnative実測成功として扱いません。

新THREE12は同SVG再使用、切断された古い入力、同問reset世代、次問からの古い入力の拒否と現在の入力可能を確認します。独立レビューで、先頭random easyの中央輪12回転はeasy-v2-20の6回目で解ける実例を発見しました。最短解の条件を安全輪の根拠にせず、実engineで12状態すべて未完成の輪を選び、実buttonでその輪を選択してから採取する形へ修正済みです。reset時の既定中央輪1/同puzzle/0手は製品どおりです。検査時間の延長や製品規則の変更で直したものではありません。

6.1Sol Extra Highが最終2ファイル、fixture、1080 CPU照合を独立確認し、修正必須の指摘なし。独立の型/lint41/diff check、親担当の型/lint/単体74/P01–P09・10万抽選/ライセンス/通常buildが成功。従来66ケースは全て残し、THREE12だけ追加して検査一覧134件を確認しました。ローカルのnative両browser実行は前述の環境制約で未確認です。修正headの各正式CI最終結果はPR本文とChecks、保存用検査記録を参照し、成功・失敗・未実施を区別します。

## 正式CI第2回の最終結果と再修正

head `0dfa0e6274ac4fdb2278658b0db35920ff9597c3` / tree `de654ff7fcd444f7364008d4c6107b475fc4aaae` の[run38308896954](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/38308896954)は静的成功、Chromium65初回成功/2失敗（46.3分）、WebKit66初回成功/1失敗（49.5分）、同失敗のretryも失敗、flaky/skip0、verify失敗でした。CI検査用commit `0ad057013e377e92d6e33eef57f97d633becb88a` のtreeは提出headと同じです。これはmainへのマージではありません。

両browserで全THREE01–12、F02、全5境界10枝、Q03全20回/100問が成功。別担当が全結果JSONと全GPU/Q03添付をdecodeして再検査し、native実frameの72calls/13instancedCalls/125instances/170284triangles、3×12回転後の同量を確認しました。GPUは100buffers/6textures/8programs/3framebuffersで定常、20回の終了時はlive context/GPU0、native作成数1/listener3です。Q03の全20定常記録はDOM73/timeouts0/interval1/listeners24/activeAudio0/resources29（baseline28、従来許容内）で、Chromium690.340秒/WebKit784.717秒でした。代表画像の盤面・12方向・操作列も確認していますが、物理iPhoneではありません。

| 残った180秒ケース | Chromium | WebKit |
|---|---|---|
| V01全90問 | 初回/再試行とも期限超過、全90問合格ではない | 全90問155.596秒で初回成功 |
| T04/F05の実302回転step | 初回172.124秒 / 再試行141.887秒 | 初回156.077秒 / 再試行161.028秒 |
| T04/F05全体 | その後の5問完走/結果観測で期限超過 | その後の5問完走中に期限超過 |

Chromium再試行の失敗画像には5問の結果、総340手、参考扱いも表示されていますが、期限内に全検査が完了した合格ではありません。draw回数の削減は確認できても、実操作時間の改善を証明したことにはならないため再修正します。時間上限、実302button click、全5問、全90問/12方向、trace/video、viewport/DPR、Q03は緩めません。

## 最終RGBAの固定2状態再使用と観測の一括化

元の3D sceneを変更せず、cold frameは従来どおりdefault framebufferへACES/SRGB/MSAA/透明alphaを含めて描画します。同じturnの完成したencoded RGBAを2枚だけのFramebufferTextureへcopyし、同姿勢のhitはnearest/no mipmap/NoColorSpaceのraw shader・NoBlendingでその画素を戻します。tone mapping/色変換/alpha premultiplicationを二重適用せず、rawのsamplerはhighp、hit再表示時だけDITHERを一時offにして元のstateへ戻します。THREE07/13の固定hard fixtureのcoldは72calls/170284triangles/125instancesを保ち、hitの1call/2trianglesは完成画像のfullscreen quadで、3D形状の削減ではありません。他問題のcold draw数まで72で固定する意味ではありません。

GPUの完成frameとCPUの描画modelをそれぞれ2状態までに固定し、既存のSVG12状態cacheは保持します。初coldでraw program/quadと両textureを準備します。サイズ/DPR変更では同じ2texture objectのstorageをdisposeして再確保し、素材ready・問題・context失効でもcacheを無効化。表示したdesired poseと最後に実構築したgeometryを分け、A(cold)→B(cold)→A(hit)→失効で古いBを描き直す誤りを防ぎます。中断/破棄時は追加GPUもdisposeし、既存の単一context所有/rollbackは維持します。

THREE13は従来120秒の既定枠で追加し、native readPixelsを元のdefault framebufferのrender turnで採取します。copy前後とcold/hitの全RGBA byteを厳密0差で比較し、透明/半透明/不透明画素の存在も確認。素材到着、A/B hit後のresizeと別のcold A、元サイズへ戻る場合、選択輪、native loss/restore後の同canvas/同画素/GPU固定も検査します。Three自身のconstructor phaseの既存3framebuffersと、同rendererのexternal restore後のunused framebuffer0を区別し、新しいoffscreen render targetがないことを数量とdefault framebufferで確認します。

V01では同じ実DOMから全12方向の矩形と盤面属性をまとめて観測し、全90navigation/集合集計/従来assertion/10問おきの画像/180秒を保持します。初問の全12方向は従来のnative boundingBoxも採り、x/y/width/height各0.01px以内の一致とJSON添付を追加しました。SVG読み上げ層のopacity0を『非表示』として拒否せず、切断・display/visibility・寸法は確認します。他ケースの既定network-idle待機は変えません。

修正後のローカルnative browser実行は環境制約のため未確認です。全byte一致・GPU実測・実180秒の改善は正式CIで判定し、CPU比較やdraw削減から成功を推定しません。従来67件を全て保持＋THREE13の各68件・計136件とverifyを、同Draft PRの最新headで再検証します。マージ・本番公開・物理iPhone受入は実施しません。

6.1Sol Extra Highの独立レビューで、raw samplerのprecision、THREE13のconstructor内3framebuffersと同rendererのexternal restore後0framebuffers、意図的loading時の旧shader variantがrestore後に残らないことに関する期待値を修正しました。復帰後はframebuffers0/programsがloading phaseと同数、他の資源はready phaseと完全一致し、後続hitはその復帰baselineと厳密一致を検査します。default framebufferからの全byte比較条件や旧20回のGPU検査を緩めていません。最終source/testとR3観測に修正必須の指摘なし。

source SHA256 `e03bfe20be2a0825e54d4f56e52c90a4bf06eec2f4cec4207b89a7059ded46f1`、THREE test `c276fb3e2890460dbe5b5676f7d61aeefa354c1a56a4c6af998d4d8256ea7907`、R3 test `2982f2004185d4dd35f39dd1980f03a6e158032ac5a5daccfc48689ec003c93b` をfreezeしました。最新の実deferred cold pathを使う1080状態CPU照合を実装/親/独立担当が再実行し、旧436912のsourceとbaselineのSHA一致、geometry/material/order/triangles/光路一致、同じfloat32行列差を確認。rendererとframebuffer copyはmockで、native画素一致の証明ではありません。

親担当・独立担当の型/lint41/diff checkと、親担当の単体74/P01–P09・10万抽選/ライセンス/通常・Pages build/artifactが成功、検査一覧136件です。JavaScript gzip173404 bytes（250KB目標以内）、155520判定のp95約0.051606ms/最大約2.702384msはLinux合成測定です。問題JSON生109681 bytesの既存未達と既存開発依存の監査警告は未解消。正式CI最終結果は最新headのPR/Checksと保存用記録へ追記し、結果記載だけの追pushで進行中の全件検査を取り消しません。
