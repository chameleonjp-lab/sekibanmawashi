# セキバンマワシ 操作・SE・演出拡張 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** スワイプで大きい石板を回し、追加SE12種類と追加視覚演出50個を安全に体験できるようにする。

**Architecture:** 既存の回転判定と時計を正本とし、安定したboard hostに入力を接続する。純粋な角度判定、共通イベント、音選択、装飾の寿命管理を分離し、1問確認と5問モードの両方へ接続する。Three.js盤面とSVG代替表示は同じ入力面を使う。

**Tech Stack:** Node 24.19.0 / npm 11.9.0 / TypeScript 5.9.2 / Three.js 0.180.0 / Web Audio / Pointer Events / node:test / Playwright 1.63.0。

**Spec:** [追加要件仕様書](../spec/UX_EXPANSION_2026-11-06.md)。本書は文書版1.0（敵対的検証前）。基準main `f03ddfc00287ef54694feba50c040f15c3f82391`。全チェックボックスは将来の実装工程であり、この文書PRで実行済みを表さない。

## Global Constraints

- 12方向・可動輪3本・常時発光・回転のみ、90問・900組、成功判定、問題順序、保存形式を維持する。
- 1段階30度の受理につき1手。選択は0手。成功入力時刻で時計を止め、成功表示は1,500ms。描画・SEの完了を待たない。
- 初回カウントダウン3秒、説明・中断確認・背面時間を計測に含める既存規則を維持する。
- 音設定はホームのみ、初期ON、保存値を尊重する。動きを減らす設定を尊重する。
- Node 24.19.0 / npm 11.9.0、TypeScript 5.9.2、Three.js 0.180.0、既存Playwrightを使い、依存追加なし。
- `src/core/`・`content/`の規則・問題、ランキング、外部接続、本番公開は本追加の変更対象外。

## Review Focus

1. SVGの入力ノードが1手ごとに差し替わっても、指を離すまで同じ輪へ入力できること（SW08/T2）。
2. 長いスワイプの途中で成功したら残りの入力、音、演出が次問へ漏れないこと（SW03/T2、EF05/T6）。
3. VoiceOverと通常clickだけでも矢印撤去後に解けること（SW06/T2、物理実機/T6）。
4. 音のunlock遅延、背面復帰、演出の例外が時計と次問進行を変えないこと（AU02/T4、EF04/T5）。
5. 50件を定義するだけでなく、既存90問と実UIで到達し、競合・軽減表示で資源を残さないこと（EF01〜05/T5/T6）。

---

## 1. 実行範囲とPRの順序

今回=P0（本書・要件仕様書・敵対的レビュー・入口更新）のDraft PR。ゲーム実装は行わない。後続はP1=T1〜T3（操作/拡大）、P2=T4（SE）、P3=T5〜T6（50演出/統合受入）の3段階。各段階は直前PRをユーザーがマージした最新mainから開始し、未マージPRへ積み重ねない。各PRで対象の単体検査と既存全体検査を通し、失敗と未実施を残す。mainへ直接push・マージ・自動公開しない。

## 2. ファイルと責務

| ファイル | 変更 | 責務 |
|---|---|---|
| `src/swipe.ts` / `src/swipe.test.ts` | 新規 | DOMから独立した角度/閾値/残角度/キャンセル判定 |
| `src/board-gesture.ts` | 新規 | host上のPointer Events、座標変換、capture、世代、click抑止、後始末 |
| `src/input.ts` / `src/input.test.ts` | 変更 | 既存入力受付を使う明示的な輪付き回転 |
| `src/app.ts` / `src/run-ui.ts` | 変更 | 両画面のスワイプ、補助操作、意味イベントを受理後に送出 |
| `src/board.ts` / `src/three-board.ts` | 必要最小限 | 座標の共用・SVGクリック選択との競合防止。描画規則/キャッシュ上限維持 |
| `src/app.css` | 変更 | 盤面拡大、補助操作、装飾の配置、軽減表示 |
| `src/feedback-events.ts` / `src/feedback-events.test.ts` | 新規 | 受理した事実だけを表す音/視覚演出の共通イベント |
| `src/sound.ts` / `src/sound.test.ts` | 変更 | 18音、優先度、間引き、期限、同時発音、既存互換API |
| `src/effects/catalog.ts` / `src/effects/catalog.test.ts` | 新規 | 50定義、発火条件、寿命、優先度、検査用ID |
| `src/effects/controller.ts` / `src/effects/controller.test.ts` | 新規 | DOM装飾生成と解放、重複抑止、予算、軽減/非表示 |
| `e2e/ux-swipe.spec.ts` / `e2e/ux-layout.spec.ts` / `e2e/ux-feedback.spec.ts` | 新規 | 実入力・実画面で追加契約を検査 |
| `e2e/r3-board-input.spec.ts` / `e2e/r4-run.spec.ts` / `e2e/r5-readiness.spec.ts` / `e2e/three-board.spec.ts` | 変更 | 撤去する常設矢印のテストを移行、既存検査の意図を維持 |
| `docs/spec/CURRENT_GAME_SPEC.md` / `docs/spec/R3_BOARD_INPUT.md` / `docs/planning/IMPLEMENTATION_PROGRESS.md` | 各段階で変更 | 実装到達点・実測・未実施を反映 |

先に読み直す箇所: `InputController`、両画面の `rotate/selectRing/refreshBoard`、`ThreeBoardView.update` の入力層差替、`SoundController.invalidate/play`、`completeQuestion/showConfetti`、既存Q03とTHREE12/13。巨大なapp/run-ui全体の作り直しはしない。

## 3. T1: 純粋なスワイプ判定と共通入力

**Files:** Create `src/swipe.ts`, `src/swipe.test.ts`; Modify/Test `src/input.ts`, `src/input.test.ts`。

**Interfaces:**

```ts
type SwipeSample = { x: number; y: number; clientX: number; clientY: number; time: number };
type SwipeState = { ring: number; lastAngle: number; residual: number; startClientX: number; startClientY: number; travelled: boolean; moves: number };
function beginSwipe(sample: SwipeSample): SwipeState | null;
function advanceSwipe(state: SwipeState, sample: SwipeSample): { state: SwipeState | null; moves: MoveType[] };
// DOM adapter supplies ordered samples; state=null means cancelled.
InputController.rotateRing(ring: number, type: MoveType): boolean;
```

`rotateRing` は同じ `canAcceptInput` を再確認し、必要なら輪を選択して既存rotateへ渡す。戻り値は入力経路の受付結果であり、coreの成功判定と混同しない。成功/世代変更はadapterが各段階前後に再確認する。

- [ ] **Step 1:** SW01（各輪の内外境界・隙間・中心・DPR座標）、SW02（8px/30度/±180度/+65度→2手/逆転）、SW04（90度超・非有限・中心侵入で未確定分破棄）の失敗テストを書く。例: `assert.deepEqual(advanceSwipe(s, atAngle(65)).moves, ['r', 'r'])`、29.9度は0手、30度は1手、既受理2手をcancelで取り消さない。補助fixtureはSVG中心とCSS距離を明示。
- [ ] **Step 2:** `node --experimental-strip-types --test src/swipe.test.ts src/input.test.ts` → 新しいAPI未実装によるFAILを確認。
- [ ] **Step 3:** 上記APIと仕様§3の閾値を実装。回転受理後の状態更新を純粋判定へ戻して処理を継続する。複数段階の事前一括受理はしない。
- [ ] **Step 4:** 同コマンド→全PASS。受付禁止状態・不正輪・modifier/IME/repeatを含む既存input検査もPASS。
- [ ] **Step 5:** 該当4ファイルをcommit。レビューで角度符号と履歴を確認してT2へ。

## 4. T2: 盤面接続・矢印撤去・代替操作

**Files:** Create `src/board-gesture.ts`, `e2e/ux-swipe.spec.ts`; Modify `src/app.ts`, `src/run-ui.ts`, `src/board.ts`, `src/three-board.ts`, `src/app.css`, `e2e/r3-board-input.spec.ts`, `e2e/r4-run.spec.ts`, `e2e/three-board.spec.ts`。

**Interfaces:** `attachBoardGesture(host: HTMLElement, options: { getGeneration(): string; canAccept(): boolean; select(ring: number): void; rotate(ring: number, type: MoveType): boolean }): { cancel(): void; dispose(): void }`。T1の関数を使用。generationはrun/question/inputの組を表す。SVGの `getScreenCTM().inverse()` 失敗時はその入力を無視。盤面hostの寿命につき1 adapter。

- [ ] **Step 1:** SW03（60度以上なぞり途中成功→成功段階以降0手）、SW05（多指・capture喪失・中断・別問の古いイベント）、SW06（補助操作clickのみ/キーのみで既知問完了）、SW07（互換click後の二重反映0）、SW08（ノード差替後も同じpointerで3手）を両モード/Three/SVGで失敗させる。タッチ正常系はtrusted browser input、複数指等の注入は合成試験と記録。
- [ ] **Step 2:** `npx playwright test e2e/ux-swipe.spec.ts --project=chromium` → SW各条件が現行で未対応なためFAILを確認。
- [ ] **Step 3:** host capture、generation照合、全指終了待ち、clickの系列限定抑止、全中断経路のcancel/disposeを実装。選択でSVGが置換されても継続できるよう、選択前にhost captureを確立。通常回転列を撤去し、仕様§3.3の補助操作・文言・focus/aria-expandedを両画面へ追加。
- [ ] **Step 4:** 既存I01/I03/I06はスワイプと補助clickを主経路に移行する。長押し/連打/Enter/Space/成功後のタップ防止・元の302実回転と5問検査を削除しない。矢印のlocatorだけを残して成功扱いにしない。
- [ ] **Step 5:** `npx playwright test e2e/ux-swipe.spec.ts e2e/r3-board-input.spec.ts e2e/r4-run.spec.ts e2e/three-board.spec.ts --project=chromium` と `--project=webkit` → PASS、skip/flakyを区別。両画面で盤面外のscroll/zoom、200%文字、補助パネルからのフォーカス復帰を確認。
- [ ] **Step 6:** 対象ファイルをcommit。SW01〜08→実テスト名の対応を進捗表へ記録。

## 5. T3: 盤面拡大とレイアウト

**Files:** Modify `src/app.css`, `src/app.ts`, `src/run-ui.ts`; Create `e2e/ux-layout.spec.ts`; Update `docs/spec/R3_BOARD_INPUT.md`, `docs/planning/IMPLEMENTATION_PROGRESS.md`。

**Interfaces:** 既存 `[data-board]` / `.board-host` の矩形を計測。300×300・輪半径・外周目標位置は変更せず、CSS配置のみでDを拡大する。

- [ ] **Step 1:** 別作業コピーの基準SHAで10画面のD/盤面位置/スクロール/ボタン矩形をJSON＋画像保存。実装版と同じbrowser version、font scale、DPR、safe area条件を記録する。現行CSS値を実測として流用しない。
- [ ] **Step 2:** SZ01: 縦6画面のD下限と基準以上、320/375幅は `after >= before * 1.10`。SZ02: 全10画面・200%文字・補助展開/閉の横overflow0/操作到達。SZ03: 回転/成功前後の盤面矩形差≤1px。SZ04: 目標12方向・輪ヒット領域と描画一致。失敗テストを追加する。
- [ ] **Step 3:** `npx playwright test e2e/ux-layout.spec.ts --project=chromium` → 小画面拡大未達のFAILを確認。
- [ ] **Step 4:** 既存の36svh/42svh制限とcontrol-panel余白を整理。縦は幅を使い、横は2列を維持。safe area、文字200%、展開パネル時は読みやすさを優先し縦スクロールを許す。文字の縮小・目標の切り取り・検査下限の変更で通さない。
- [ ] **Step 5:** 同検査をChromium/WebKit、両画面/描画方式でPASS。before/afterの実測表を記録。P1の全標準検査（§9）とレビューを通してcommit、Draft PR。

## 6. T4: 共通イベントとSE12種類

**Files:** Create `src/feedback-events.ts`, `src/feedback-events.test.ts`, `e2e/ux-feedback.spec.ts`; Modify `src/sound.ts`, `src/sound.test.ts`, `src/app.ts`, `src/run-ui.ts`, `e2e/r5-readiness.spec.ts`。

**Interfaces:** `FeedbackEvent` はdiscriminated union。共通項は `{ id: number; runGeneration: number; questionGeneration: number; atMs: number }`。kindは `select | gesture-start | gesture-progress | gesture-end | rotation | run-start | countdown | question-start | practice-reset | result | share-success | storage-error | help-open | abort-open | modal-close | assist-open`。rotationは `{ ring; type: MoveType; before: LightResult; after: LightResult; moves; elapsedMs }`、countdownは `{ value: 3 | 2 | 1 }`、resultは `{ mode; bestUpdated: boolean }`。UIは受理/結果確定後だけemitし、描画からemitしない。イベントは保存せずsession内の単調ID。

`selectSound(event: FeedbackEvent): SoundName | null` と `SoundController.play(name)` を接続。既存 `unlockFromGesture/setEnabled/invalidate/dispose` を保持し、時間は注入可能なmonotonic clockを使う。T5は同じイベントを購読する。

- [ ] **Step 1:** SOUND_NAMESが既存6＋表の12で重複なし、全12の合成値/発火条件/18音の無音経路をテスト。AU01: 同時点灯/消灯→lightのみ、成功→successのみ、輪別6音。AU02: unlockを121ms遅延/世代変更/OFF→再生0。AU03: 100連打でもactive≤4・timerが有限、dispose後0。AU04: AudioContextなし・resume拒否・connect/start/stop例外でもゲーム入力と時計が同じ。
- [ ] **Step 2:** `node --experimental-strip-types --test src/feedback-events.test.ts src/sound.test.ts` → 未実装のFAIL。
- [ ] **Step 3:** カタログ、音優先、60ms間引き、120ms期限、4音制限を実装。次問/完走音を進行後の現在世代でemitし、古い世代の予約をinvalidate。単純な `litRequired` 数比較ではなく必須目標集合差で新規点灯/消灯を判定する。
- [ ] **Step 4:** 上記unit→PASS。`npx playwright test e2e/ux-feedback.spec.ts e2e/r5-readiness.spec.ts --project=chromium` とWebKit→音ON/OFFで同じ手数/時間/結果、全新音の実UI発火、両モードのsilent fallbackを確認。音声ノード観測は実機試聴と区別。
- [ ] **Step 5:** P2の全標準検査とレビュー、18種類の試聴記録（実機未実施なら明記）、commit、Draft PR。

## 7. T5: 演出基盤と50件の実装

**Files:** Create `src/effects/catalog.ts`, `src/effects/catalog.test.ts`, `src/effects/controller.ts`, `src/effects/controller.test.ts`; Modify `src/app.css`, `src/app.ts`, `src/run-ui.ts`, `e2e/ux-feedback.spec.ts`。

**Interfaces:** `EffectDefinition = { id: EffectId; durationMs: number; priority: number; matches(event: FeedbackEvent): boolean }`、`EffectId`はFX01〜FX50のリテラル集合。`EffectController(host, { reducedMotion, now })` の `emit(event): void / invalidate(): void / dispose(): void`。`legacy-confetti`は別枠だが資源予算に含める。装飾ノードに `data-effect-id` とevent idを付け、検査は定義件数だけでなく可視DOM/画像も見る。

- [ ] **Step 1:** EF01: `assert.equal(EFFECTS.length, 50)`、ID連番/重複なし、全寿命が仕様表と一致、全matchesにpositive/negative例。EF02: 同一event再emitで増殖0、successと通常rotationの競合、8FX/64粒子/120装飾ノード上限。EF03: reduce ON/途中切替で動画0、全寿命後0。EF04: 生成例外・hidden・dispose・古い世代で進行に影響0/予約0。失敗テストを書く。
- [ ] **Step 2:** `node --experimental-strip-types --test src/effects/*.test.ts` → 未実装のFAILを確認。
- [ ] **Step 3:** controllerとCSS、FX01〜10→11〜20→21〜30→31〜40→41〜50の順に10件ずつ実装し、同一catalogの表を正本にする。各群でnodeの寿命/画像/条件を確認して小さくcommitする。50件の固有シーンやWebGLコンテキストを追加しない。
- [ ] **Step 4:** 仕様表に対応する `reports/ux-expansion/effect-coverage.json` を生成。各行 `{id, test, mode, puzzleId?, steps, screenshot, reducedMotionResult}`。全IDを実UIイベントで到達させ、発火条件を満たす既存パズルと操作を固定する。テスト専用force-effectやID属性だけの空ノードを受入に使わない。50件に視認上の区別があるか画像レビューする。
- [ ] **Step 5:** Unit全PASSとChromium/WebKitの `e2e/ux-feedback.spec.ts` 全PASS。新しいrotation前に古い光路装飾が0、紙吹雪が別枠で存在、無音とreduceで全フロー完了を確認。意味のある通知の二重読み上げを増やさない。

## 8. T6: 統合敵対的検証と受入記録

**Files:** Update全追加E2E、既存 `e2e/r3-board-input.spec.ts`, `e2e/r4-run.spec.ts`, `e2e/r5-readiness.spec.ts`, `e2e/three-board.spec.ts`、現行仕様/進捗表。Create `docs/reviews/UX_EXPANSION_IMPLEMENTATION_VERIFICATION.md`, `reports/ux-expansion/` の実測結果。

- [ ] **Step 1:** EF05: 長いスワイプで途中成功→演出50種の候補を有効にしても受理履歴は成功手まで。時計境界は既存fake clockで1,499msでは次問なし、1,500msで1回だけ進む。実ブラウザーでは最低1,500msと次問の唯一性を検査しスケジューラーの遅延を計測値と分ける。
- [ ] **Step 2:** 全5成功境界でキャンセル/中断/やり直し/hidden/pagehide/resize/context lossを注入。旧pointer・遅延音・終了animationが新問の状態/手数/時間を変更しない。1問確認・練習・チャレンジを区別。
- [ ] **Step 3:** 全50件の到達証拠とSE全12件の発火表を確認。優先度で常に消されるIDがあればその実装/条件を修正し、単なるカタログ登録を完成としない。旧THREEの実画素比較は装飾と基盤canvasを区別し、基盤の画素一致基準を緩めない。
- [ ] **Step 4:** Q03の5問×20回、T04/F05の302回転＋5問、90問×12方向、全THREE01〜13を両ブラウザーで維持。資源基準は検査ツール初期化後に測定し、20回後と各終了後を比較する。上限/timeout/retryを増やして成功にしない。
- [ ] **Step 5:** 10画面・200%・reduce・音OFF・forced colors・WebGL失敗/画像失敗を検査し、基準との性能差を記録。実機60fps未測定を成功扱いにしない。
- [ ] **Step 6:** iPhone 17 Pro Safariで円周スワイプ、多指、ロック復帰、アドレスバー伸縮、safe area、VoiceOverの補助操作、文字拡大、18音の聴感を記録。機材がなければ未実施のままDraft PRへ進め、公開可としない。
- [ ] **Step 7:** §9全体検査、別担当の敵対的レビュー、指摘修正と対象再検査。実装済み/失敗/未実施/対象外を記録してcommit、P3 Draft PRを提出。

## 9. 必須コマンドと提出条件

P1/P2/P3の各実装PRは固定版Node/npmで次を実行する。途中失敗を成功に合算しない。

```sh
npm ci
npm run typecheck
npm run lint
npm run licenses:check
npm test
npm run puzzles:test
npm run build
PAGES_BUILD=1 npm run build
npm run pages:artifact:check
npm run performance:r5
npx playwright test --project=chromium
npx playwright test --project=webkit
git diff --check
```

Pages build時は既存workflow同様 `PAGES_REQUESTED_SHA` に検査対象の完全SHAを指定する。CIの `checks` と両browser、集約 `verify` の最終head結果を確認する。コード変更を文書のみとしてブラウザー検査から除外しない。

P0文書PRでは依存導入・製品検査は対象外。既存計画§8.1に従い、リンク/版/ID件数/追跡表/差分と敵対的レビューを検査する。CIが自動起動する場合、その結果を別に記録し、文書検査を製品動作の検証に読み替えない。

PR本文に基準SHA、今回の範囲、検査対象と結果、レビュー指摘と反映、未実施、実機有無、次段階を含める。PRのマージはユーザー、本番公開は別の明示指示と既存公開ゲートに従う。
