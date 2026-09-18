# 石板回路（仮称） 厳密実装計画書

文書バージョン: **1.0**  
作成日: **2026-09-01**  
対象: ChatGPT Workによる新規ブラウザゲーム開発  
想定対象リポジトリ: **`chameleonjp-lab/sekiban_kairo`（仮）**  
想定公開URL: **`https://chameleonjp-lab.github.io/sekiban_kairo/`（仮）**  
想定game slug: **`sekiban_kairo`（仮）**  
対象端末: iPhone Safariを主対象とし、iPhone SE級の小画面、iPad、パソコンにも対応  
公開先: GitHub Pages  
ランキング基盤: 既存のカメレオンJP Supabaseプロジェクト  
実装PR数: **ゲーム側5本 + 実験場側1本 = 合計6本**  

この文書は、調査済みの「複数の回転環を動かし、光の遮断を避け、必要な受信点をすべて満たす」仕組みを、独自の石板表現と独自問題へ組み直すための実装基準書である。

判断に迷った場合は、見た目や追加機能を増やさず、次の順で判断する。

1. 同じ入力が必ず同じ結果になること
2. 3問の時間を公平に比較できること
3. iPhoneで誤操作なく遊べること
4. 問題を安全に量産できること
5. 外部作品の具体的な表現へ近づけないこと

---

## 0. 実装担当者への最上位指示

1. **この企画は新規ゲームとして作る。既存の`akerun`を改造しない。** `akerun`は別ルールの金庫ゲームとして既に運用されているため、コード、game slug、ランキング、データを共有しない。
2. 本文では仮称を「石板回路」、仮slugを`sekiban_kairo`とする。利用者から別名の指示が来なければ、この値で進める。
3. PR1開始前に名称を変更する場合は、タイトル、リポジトリ、slug、URL、保存キー、関数名、テーブル名、Edge Function名を一括で置換する。部分的な変更は禁止する。
4. 外部作品の名称、固有名、画面、問題配置、解答手順、画像、音、文章、ロゴ、アイコン、変数名を持ち込まない。比較用の固有名も公開リポジトリ、PR本文、コミットへ残さない。
5. 調査レポートに載る外部作品のスクリーンショットや攻略配置を、テストデータとしても使わない。
6. 画像生成で作った石板案は**方向性の参考**であり、画面をそのまま画像として貼らない。盤面、記号、亀裂、光、ボタンはHTML、CSS、SVGで独自に描く。
7. 正式競技は、同じ期間内では全員へ同じ3問を出す。参加者ごとに別問題を出した記録を、同じランキングへ混ぜない。
8. 練習では毎回ランダムに見える問題を出してよい。ただし、端末上で重い解法探索を行わず、事前検査済み問題から選ぶ。
9. 盤面の内部ルールは描画処理から分離する。ブラウザ側とサーバー側は、同じ共有コードで操作記録を再生する。
10. 論理状態は入力時に即時確定する。回転アニメーションの終了を待ってから判定してはいけない。
11. 画面更新回数、端末の表示周波数、処理速度でタイムや判定が変わらないようにする。
12. 正式競技中に一時停止してタイムを止める機能は作らない。画面を離れている間も時間は進む。
13. `main`へ直接pushしない。各段階はDraft PRで作り、検査成功後にレビュー可能へ変える。
14. ChatGPT WorkはPR作成まで進めてよいが、`main`へマージしない。
15. 軽微な修正や検査失敗のために新しいPRを増やさず、その段階のブランチへ追加コミットして直す。
16. PRをまたいで仕様を重複実装しない。共有コード、型、定数の正本を一つにする。
17. 不明な点を推測で埋めない。実装を止めない代替値が必要な場合は、コードとPR本文で「仮値」と明示する。
18. Supabaseの`service_role`またはsecret keyを、ブラウザ、GitHub Actionsログ、公開ファイル、PR本文へ出さない。ブラウザではPublishable keyだけを使う。
19. `public.games.is_active`と競技受付フラグは、公開確認が終わるまで`false`を維持する。
20. 完成条件を満たす前に、見栄えだけを理由として追加演出、収集要素、実績、物語を追加しない。

---

# 1. 仮名称と識別子

名称が未確定でも計画を実行できるよう、次を仮の正本とする。

| 用途 | 仮値 |
|---|---|
| 公開ゲーム名 | 石板回路 |
| 読み | せきばんかいろ |
| リポジトリ | `chameleonjp-lab/sekiban_kairo` |
| game slug | `sekiban_kairo` |
| GitHub Pages | `https://chameleonjp-lab.github.io/sekiban_kairo/` |
| Edge Function | `sekiban-kairo-competition` |
| クライアント版 | `sekiban-kairo-web-v1` |
| 競技契約版 | `sekiban-kairo-run-v1` |
| ルール版 | `stone-path-rule-v1` |
| 生成版 | `stone-path-generator-v1` |
| 操作記録版 | `stone-path-trace-v1` |
| 問題集合版 | `stone-path-set-v1` |

PR1の最初に、GitHub組織とSupabase `public.games`の両方でslugの重複がないことを確認する。重複があった場合だけ、利用者へ名称変更を報告してから代替slugへ一括変更する。

**PR1がレビュー可能状態になった後は、slugだけを気軽に変えない。** 変更する場合は、全保存キー、URL、データベース関数、Edge Function、実験場登録を同時に修正し、旧slugの扱いも文書へ残す。

---

# 2. 完成目標

「石板回路」は、石板に刻まれた複数の環を回し、発信石から出る光を、指定された受信石へすべて届ける短時間パズルとする。

一回の正式競技では、難しさの異なる3問を続けて解く。各問題の解答時間を合計し、短い順に順位を決める。

完成版は、次の流れを中断なく実行できる状態とする。

```text
起動
→ 名前入力
→ 初回のみ操作練習
→ ホーム
→ 正式競技を選ぶ
→ 問題セット取得
→ 3秒カウントダウン
→ 第1問
→ 第2問
→ 第3問
→ 結果を端末へ先に保存
→ サーバー検証
→ ランキング表示
→ 再挑戦 / ホーム / 実験場へ
```

完成版に含めるものは次のとおり。

- 16方向、3環または4環の独自盤面
- 発信石、遮り石、受信石
- 左右1段回転
- 第2問以降の発信オン・オフ
- 3問の合計タイム競技
- 初回操作練習
- 練習モード
- 事前検査済み問題の量産機構
- 同じ問題集合だけを比較する検証済みランキング
- 上位10件
- 名前、設定、練習完了、未送信結果の端末保存
- ホームと結果画面のシェア
- カメレオンJPの実験場へのリンク
- SVGによる石板盤面
- 音、振動、動きを減らす設定
- 自動検査、GitHub Pages公開、公開後確認手順

---

# 3. 初回完成版に含めないもの

故障箇所とPR数を増やさないため、初回完成版には次を入れない。

- ログイン、会員登録、メール認証
- 課金、広告、ガチャ
- 通信対戦、同時対戦、観戦
- チャット、コメント、ユーザー投稿
- 利用者が盤面を編集して公開する機能
- 自動で毎日問題を切り替える定期処理
- 問題ごとの物語、キャラクター、収集品
- 画像素材を大量に読み込む石板テクスチャ
- WebGL、3D、物理エンジン
- 端末の傾き、複数指、長押しを使う必須操作
- 競技中のヒント、自動解答、最適手表示
- 参加者ごとに異なる問題を同じ順位表で比較する仕組み
- 未検証の端末タイムを正式ランキングへ直接送る仕組み
- 外部作品の問題を再現する互換モード

将来の問題集合切替に備えるが、初回公開時は管理者が手動で`active_set_id`を変える方式までとする。

---

# 4. 独自表現と権利上の境界

## 4.1 使用する表現

- 正方形または縦長の石板枠
- 16分割された不均一な刻印
- 3本または4本の石の環
- 発信石: 四角い石片に放射状の刻印
- 遮り石: 濃い石片に交差する溝
- 受信石: 外周にある輪郭付きの石
- 光: 直線レーザーではなく、太さがわずかに揺れる光の筋
- 達成: 色だけでなく、中央の刻印、輪郭、点滅回数を変える
- 完了演出: 石板全体の刻印が短くつながり、中央紋が開く

## 4.2 使用しない表現

- 12時間の時計と同じ配置
- 既存作品で使われた固有名
- 既存作品と同じ色、形、部品配置の組み合わせ
- 既存作品の外周ポート、矢印、円盤、効果音の模写
- 既存作品の固定問題、初期配置、正解配置
- 「再現」「クローン」「〇〇風」といった公開文言
- 既存作品のスクリーンショットを説明画像やOG画像に使うこと

## 4.3 色だけに頼らない

色覚差があっても読めるよう、次を固定する。

| 状態 | 色以外の違い |
|---|---|
| 発信中 | 放射線が開き、中央点が脈動する |
| 発信停止 | 放射線が閉じ、停止記号を重ねる |
| 遮り石 | X形の深い溝と厚い輪郭 |
| 必須受信石・未点灯 | 二重輪郭、中央は空洞 |
| 必須受信石・点灯 | 中央を塗り、短い光条と確認刻印 |
| 任意方向へ届いた光 | 小さな火花だけ。必須受信石の形にはしない |
| 選択中の環 | 色だけでなく、外周に三つの短い選択刻印 |

## 4.4 公開前の確認

PR5で、画面、文言、音、問題データを独立性の観点から再確認する。最終公開名は、PR6前に商標検索を行い、問題が見つかった場合は公開前に変更する。

この確認は法的な保証ではない。公開上の混同を避けるための品質確認として扱う。

---

# 5. 用語の正本

画面、コードコメント、仕様書で用語を混在させない。

| 画面上の用語 | コード上の用語 | 意味 |
|---|---|---|
| 環 | `ring` | 部品が固定された回転層 |
| 発信石 | `emitter` | 発信中のとき光を出す部品 |
| 遮り石 | `blocker` | 光を止める部品 |
| 受信石 | `receiver` | 外周で光を受ける表示部 |
| 必須受信石 | `target` | 点灯が必要な受信石 |
| 発信中 | `powered = true` | 発信石が光を出す状態 |
| 発信停止 | `powered = false` | 光は出さないが石自体は残る状態 |
| 1段 | `step` | 16方向のうち1区画分の回転 |
| 操作回数 | `actionCount` | 回転、発信切替、盤面リセットの合計 |
| 問題集合 | `competitionSet` | 正式競技で使う3問の組 |
| ルール版 | `ruleVersion` | 光路と成功判定の版 |
| 生成版 | `generatorVersion` | シードから問題を作る方式の版 |

画面では「レイヤー」「エミッター」「マスク」などの内部用語を出さない。

---

# 6. 盤面ルール契約

この章は、ブラウザ側、問題生成器、解法探索、サーバー検証で共通する正本である。

## 6.1 固定値

```ts
export const SLOT_COUNT = 16 as const;
export const HALF_TURN = 8 as const;
export const MAX_RING_COUNT = 4 as const;
export const INACTIVE_EMITTERS_BLOCK = true as const;
export const CROSSING_BEAMS_BLOCK = false as const;
export const WIN_MODE = "coverage" as const;
```

初回公開版でこれらを設定画面から変えない。変更する場合は`ruleVersion`を上げ、旧記録と混ぜない。

## 6.2 座標

- 位置は`0`から`15`までの整数とする。
- `0`は盤面上端とする。
- 数字は時計回りに増える。
- 右回転は`+1`、左回転は`-1`とする。
- 環番号は外側から`0, 1, 2, 3`とする。
- 反対側の位置は`(slot + 8) % 16`とする。

```ts
function normalizeSlot(value: number): number {
  return ((value % 16) + 16) % 16;
}

function absoluteSlot(localSlot: number, rotation: number): number {
  return normalizeSlot(localSlot + rotation);
}
```

## 6.3 問題定義と現在状態を分ける

問題定義は不変とする。プレイ中に変わる値は別の状態へ置く。

```ts
type RingDefinition = {
  readonly emitters: readonly number[];
  readonly blockers: readonly number[];
  readonly startRotation: number;
  readonly startPowered: boolean;
  readonly canToggle: boolean;
};

type PuzzleDefinition = {
  readonly schemaVersion: 1;
  readonly puzzleId: string;
  readonly puzzleVersion: string;
  readonly ruleVersion: "stone-path-rule-v1";
  readonly generatorVersion: "stone-path-generator-v1";
  readonly difficulty: 1 | 2 | 3;
  readonly slotCount: 16;
  readonly inactiveEmittersBlock: true;
  readonly targetSlots: readonly number[];
  readonly rings: readonly RingDefinition[];
};

type PuzzleState = {
  readonly rotations: readonly number[];
  readonly powered: readonly boolean[];
};
```

禁止事項:

- 問題定義の配列を直接書き換えない。
- 描画用の角度を論理回転値として使わない。
- DOMの位置から盤面状態を逆算しない。
- `Date.now()`や乱数を`applyAction`へ入れない。

## 6.4 部品の重なり

同じ環の同じ位置に、発信石と遮り石を置かない。同種部品も重複させない。

異なる環で同じ方向に部品が並ぶことは許可する。これは遮断関係を作るために必要である。

問題読み込み時に次を検査し、不正ならゲーム開始前に拒否する。

- 位置がすべて整数で`0..15`
- `emitters`内に重複がない
- `blockers`内に重複がない
- `emitters`と`blockers`が交差しない
- 環数が3または4
- 必須受信石が4個以上8個以下
- 必須受信石に重複がない

## 6.5 発信石の物理扱い

- 発信中の発信石は光を出す。
- 発信停止中の発信石は光を出さない。
- 発信状態に関係なく、発信石の石片自体は他の光を遮る。
- 遮り石は常に光を遮る。
- 光は他の光を遮らない。
- 受信石は光を遮らない。

この仕様を画面の遊び方に短く書く。

> 発信を止めても石は残るため、ほかの光を遮ることがあります。

## 6.6 光路計算

外側から`ringIndex = 0`、内側へ向かって番号が増える。

ある発信石が環`r`、絶対位置`a`にある場合、光路を次の順で調べる。

1. 発信石より内側の環`r + 1`から最内周まで、位置`a`を調べる。
2. 発信石または遮り石があれば、中心へ届かず終了する。
3. 中心を通過する。
4. 反対位置`b = (a + 8) % 16`を求める。
5. 最内周から外側へ向かい、全環の位置`b`を調べる。
6. 発信石または遮り石があれば、その位置で終了する。
7. 部品に当たらず外周へ届けば、位置`b`を点灯集合へ加える。

発信元の発信石は、手順1の遮断判定へ含めない。反対側にある同じ環の別部品は、手順5で遮断物として扱う。

```ts
type BeamResult = {
  readonly emitterRing: number;
  readonly emitterSlot: number;
  readonly exitSlot: number;
  readonly reachedOuterEdge: boolean;
  readonly blockedBy?: {
    readonly ringIndex: number;
    readonly slot: number;
    readonly kind: "emitter" | "blocker";
    readonly side: "inbound" | "outbound";
  };
  readonly segments: readonly BeamSegment[];
};
```

描画は`BeamResult`だけを読み、独自に遮断判定をやり直さない。

## 6.7 成功判定

点灯した位置を`litMask`、必須受信石を`targetMask`とする。

```ts
const isSolved = (litMask & targetMask) === targetMask;
```

次は成功とする。

- 必須受信石がすべて点灯している
- 必須ではない方向にも光が届いている
- 同じ受信石へ複数の光が届いている

次は成功としない。

- 必須受信石が一つでも消えている
- 盤面定義が不正
- 発信中の発信石が一つもなく、必須受信石が空ではない

## 6.8 合法操作

正式な盤面操作は次の3種類だけとする。

```ts
type PuzzleAction =
  | { readonly type: "rotate"; readonly ringIndex: number; readonly direction: -1 | 1 }
  | { readonly type: "toggle"; readonly ringIndex: number }
  | { readonly type: "reset" };
```

- `rotate`: 指定環を1段だけ回す。
- `toggle`: `canToggle = true`の環だけ発信状態を反転する。
- `reset`: 現在問題だけを初期状態へ戻す。

環の選択は盤面状態を変えないため、操作記録と操作回数へ含めない。

不正な環番号、発信切替不可の環への`toggle`、解答済み問題への操作は拒否し、記録へ入れない。

## 6.9 操作回数

- 左回転1回 = 1
- 右回転1回 = 1
- 発信切替1回 = 1
- 盤面リセット1回 = 1
- 環の選択 = 0
- 遊び方、設定、確認画面の操作 = 0

リセット前の操作回数を消さない。正式競技の`actionCount`は、その3問で行ったすべての合法操作の合計とする。

## 6.10 リセット

- リセット確認画面を開いている間も正式タイムは進む。
- 「最初に戻す」を確定した時だけ`reset`を記録する。
- すでに初期状態と完全一致する場合は、リセットを実行せず記録しない。
- リセット後に選択する環は外側の環へ戻すが、環選択は操作回数へ含めない。

## 6.11 決定性

次の入力が同じなら、端末、ブラウザ、描画速度に関係なく結果が一致しなければならない。

- 問題定義
- 初期状態
- 操作列

共有コードの公開関数は、副作用のない形を基本とする。

```ts
function evaluatePuzzle(definition: PuzzleDefinition, state: PuzzleState): PuzzleEvaluation;
function applyPuzzleAction(definition: PuzzleDefinition, state: PuzzleState, action: PuzzleAction): PuzzleState;
function replayPuzzle(definition: PuzzleDefinition, actions: readonly PuzzleAction[]): ReplayResult;
```

---

# 7. 問題データ契約

## 7.1 公開問題定義

ブラウザへ渡す問題は、盤面を再現するために必要な値だけを含める。

```json
{
  "schemaVersion": 1,
  "puzzleId": "SK-SET-001-P1",
  "puzzleVersion": "V1",
  "ruleVersion": "stone-path-rule-v1",
  "generatorVersion": "stone-path-generator-v1",
  "difficulty": 1,
  "slotCount": 16,
  "inactiveEmittersBlock": true,
  "targetSlots": [1, 5, 9, 13],
  "rings": [
    {
      "emitters": [0, 6],
      "blockers": [3],
      "startRotation": 2,
      "startPowered": true,
      "canToggle": false
    }
  ]
}
```

正解回転量、最短手順、次の一手は公開定義へ入れない。

## 7.2 内部検査情報

生成器と管理側だけが使う情報を分ける。

```ts
type PuzzleValidation = {
  readonly shortestActionCount: number;
  readonly shortestSolutionCountCapped: number;
  readonly canonicalShortestSolution: readonly PuzzleAction[];
  readonly requiresToggle: boolean;
  readonly noToggleSolvable: boolean;
  readonly ringsUsedByCanonicalSolution: readonly boolean[];
  readonly blockerInteractionCount: number;
  readonly initialTargetLitCount: number;
  readonly solvedExtraExitCount: number;
  readonly stateSearchCount: number;
  readonly contentHash: string;
};
```

`canonicalShortestSolution`はサーバー検証にも不要であり、公開クライアントへ送らない。候補選定とテストだけに使う。

## 7.3 問題集合

正式競技は3問を一つの集合として固定する。ブラウザへ渡す公開値と、管理側だけが持つ生成シードを分ける。

```ts
type CompetitionSetPublicV1 = {
  readonly schemaVersion: 1;
  readonly setId: string;
  readonly setVersion: string;
  readonly ruleVersion: "stone-path-rule-v1";
  readonly generatorVersion: "stone-path-generator-v1";
  readonly puzzles: readonly [PuzzleDefinition, PuzzleDefinition, PuzzleDefinition];
  readonly contentHash: string;
};

type CompetitionSetRecordV1 = {
  readonly setId: string;
  readonly setVersion: string;
  readonly setSeed: string;
  readonly expectedContentHash: string;
};
```

`setSeed`はprivate管理値とし、通常のprepare応答へ含めない。3問の難度は必ず`1, 2, 3`の順とする。正式競技中に順番を変えない。

## 7.4 版管理

- 光路または成功判定を変えたら`ruleVersion`を上げる。
- 乱数、生成手順、候補選別条件を変えたら`generatorVersion`を上げる。
- 同じ`puzzleId`の配置を変えたら`puzzleVersion`を上げる。
- 3問のどれかを変えたら`setVersion`と`contentHash`を変える。
- 異なる`setId`、`setVersion`、`ruleVersion`を同じランキングへ混ぜない。

## 7.5 内容ハッシュ

問題集合は、`contentHash`自身とprivateな`setSeed`を除いた公開ペイロードを、キー順を固定した正規JSONへ変換し、SHA-256で`contentHash`を作る。

- ハッシュ対象に`contentHash`自身を含めない。
- ハッシュ対象に`setSeed`を含めない。
- 配列順は維持する。
- オブジェクトのキーは辞書順に並べる。
- 未定義値を含めない。
- 数値は整数だけを使う。
- 改行や空白はハッシュへ含めない。

ブラウザ、生成スクリプト、Edge Functionで同じ既知テスト値を使い、ハッシュ一致を確認する。

---

# 8. 問題生成と解法探索

## 8.1 基本方針

端末上で部品を完全な乱数配置にしない。次の順で問題を作る。

1. 難度別の部品数を選ぶ。
2. 各環の発信石と遮り石を配置する。
3. 隠れた正解状態を作る。
4. 正解状態で外周へ届く光を計算する。
5. 点灯方向から必須受信石を選ぶ。
6. 正解状態から合法操作で離し、開始状態を作る。
7. 幅優先探索で最短解を求める。
8. 難度条件、見やすさ、解答の偏りを検査する。
9. 条件を外れた候補を破棄する。
10. 合格した問題だけをカタログへ入れる。

## 8.2 乱数

文字列シードをUTF-8へ変換し、固定した32ビットハッシュと固定した疑似乱数生成器を使う。

初回版は次を採用する。

- 文字列ハッシュ: FNV-1a 32-bitの固定実装
- 疑似乱数: Mulberry32の固定実装
- 浮動小数の比較結果に依存する並べ替えを避ける
- ランダムな配列並べ替えはFisher-Yatesを自前実装する

実装時に既知ベクトルをテストへ入れる。乱数方式を後から変える場合は`generatorVersion`を上げる。

## 8.3 難度別条件

### 第1問

| 項目 | 条件 |
|---|---|
| 環数 | 3 |
| 発信切替 | なし |
| 発信石合計 | 4〜6 |
| 遮り石合計 | 2〜3 |
| 必須受信石 | 4〜6 |
| 最短操作数 | 4〜7 |
| 最短解数 | 1〜12 |
| 初期点灯 | 必須数の50%以下 |
| 正解時の余分な到達 | 0以上 |

### 第2問

| 項目 | 条件 |
|---|---|
| 環数 | 4 |
| 発信切替 | 2環以上で可能 |
| 発信石合計 | 5〜7 |
| 遮り石合計 | 3〜5 |
| 必須受信石 | 5〜7 |
| 最短操作数 | 7〜11 |
| 最短解数 | 1〜8 |
| 発信切替 | 数学的に必須 |
| 初期点灯 | 必須数の40%以下 |
| 正解時の余分な到達 | 1以上 |

### 第3問

| 項目 | 条件 |
|---|---|
| 環数 | 4 |
| 発信切替 | 3環以上で可能 |
| 発信石合計 | 6〜8 |
| 遮り石合計 | 4〜6 |
| 必須受信石 | 6〜8 |
| 最短操作数 | 10〜16 |
| 最短解数 | 1〜4 |
| 発信切替 | 数学的に必須 |
| 遮断関係 | 解答中に2回以上意味を持つ |
| 初期点灯 | 必須数の35%以下 |
| 正解時の余分な到達 | 1以上 |

体感が重すぎる場合は、部品を増やす前に最短操作数を下げる。見た目を複雑にして難しくしない。

## 8.4 発信切替が必須かの検査

第2問と第3問では、切替操作を禁止した状態空間も探索する。回転だけで解ける候補は不採用とする。

## 8.5 環が使われているかの検査

少なくとも正本となる最短解で、全環が一回以上回転または切替されることを要求する。

加えて、各環を固定した簡易探索を行い、簡単な代替解が生まれていないかを確認する。問題量産の速度を優先して、この検査は候補合格後にだけ実行する。

## 8.6 対称性の拒否

次を不採用とする。

- 同じ環の部品配置が2、4、8方向周期で完全に繰り返す
- 二つの環が回転差だけで同一配置になる
- 必須受信石が等間隔だけで並ぶ
- 上下左右のどこから見ても同じで、回転結果が読み取れない
- 直前に採用した問題と、回転で一致する

## 8.7 視認性の拒否

次を不採用とする。

- 一方向に三つ以上の部品が重なり、内外関係が読めない
- 発信石と必須受信石が同じ画面位置で重なるように見える
- 必須受信石が連続して密集し、個数を数えにくい
- 盤面全体の部品数が上限を超える
- 光線が常時12本を超える

## 8.8 幅優先探索

状態は4ビット単位で各環の回転値を持ち、上位ビットへ発信状態を入れる。

最大状態数は次の範囲に収まる。

```text
16^4 × 2^4 = 1,048,576
```

探索実装の条件:

- キューは配列の`shift()`を使わず、読み取り位置を持つ`Uint32Array`または通常配列を使う。
- 訪問済みは最大状態数へ対応する型付き配列を使う。
- 操作展開順を固定する。
- 最初に見つかった深さを最短操作数とする。
- 同じ最短深さの解数を数えるが、1,000件で打ち切る。
- 正本となる最短解は、固定した展開順で最初に得たものとする。
- 探索上限を超えた候補は「難問」として採用せず、生成失敗として捨てる。

## 8.9 端末で探索しない

iPhoneで正式問題を生成・検査しない。

- チュートリアル: 固定データ
- 練習: 事前検査済みカタログから選択
- 正式競技: サーバーが有効問題集合を返す
- 幅優先探索: Nodeスクリプト、テスト、管理処理だけで実行

## 8.10 初回に用意する問題量

初回公開までに最低限、次を用意する。

| 用途 | 数 |
|---|---:|
| チュートリアル | 2問 |
| 練習・第1問相当 | 30問 |
| 練習・第2問相当 | 30問 |
| 練習・第3問相当 | 30問 |
| 正式競技用集合 | 6集合以上、合計18問以上 |

正式競技では一つだけを有効にする。残りは将来の切替候補として非公開の管理データへ置く。

## 8.11 量産スクリプト

次のコマンドを用意する。

```text
npm run puzzles:generate -- --batch-seed <文字列> --count <候補数>
npm run puzzles:audit -- --input <候補JSON>
npm run puzzles:select -- --input <候補JSON> --practice 90 --sets 6
npm run puzzles:verify-catalog
npm run puzzles:render-samples
```

`puzzles:render-samples`は、採用候補をHTMLまたはSVG一覧として出し、画面上の重なりを目視確認できるようにする。外部画像生成サービスへ依存しない。

生成結果には次を残す。

- バッチシード
- 生成版
- ルール版
- 候補数
- 採用数
- 破棄理由ごとの件数
- 各問題の最短操作数
- 最短解数
- 探索状態数
- 内容ハッシュ

## 8.12 CIでの量産検査

GitHub Actionsの利用を増やしすぎない。

- 通常PRでは、固定シードの小規模候補だけを検査する。
- 1,000件以上の大量生成は、開発時または手動ワークフローで実行する。
- 定期実行は作らない。
- 大量生成結果そのものを毎回コミットしない。
- 採用済みカタログと検査要約だけをコミットする。

---

# 9. ゲームモード

## 9.1 初回操作練習

初回だけ、名前入力後に2問の短い練習を行う。タイムとランキングはない。

### 練習1

- 3環
- 発信切替なし
- 外側の環を選ぶ
- 左右ボタンで1段回す
- 必須受信石が点灯すると完了

表示する説明:

> 環を選び、左右のボタンで1段ずつ回します。

### 練習2

- 3環
- 発信切替あり
- 一つの発信を止めると別の光が通る
- 停止中の石も遮断物として残ることを見せる

表示する説明:

> 発信を止めると光は出ません。石は残るため、ほかの光を遮ることがあります。

練習完了はlocalStorageへ保存する。ホームの「遊び方」から再実行できる。

## 9.2 練習モード

- 難度1、2、3を選べる。
- 事前検査済みカタログから一問を選ぶ。
- 直近5問を避ける。
- タイムは表示するが正式ランキングへ送らない。
- 「遮られている光を表示」「次に動かす環を表示」の二段階ヒントを使える。
- ヒントを使っても練習結果だけは端末内へ残せる。
- 練習中は画面を離れた場合に一時停止してよい。

## 9.3 正式競技

- 有効な問題集合をサーバーから取得する。
- 同じ`setId`と`setVersion`の参加者へ同じ3問を同じ順で出す。
- ヒントなし。
- 一時停止なし。
- 3秒カウントダウン。
- 問題間の固定切替時間を除いた3問の合計を記録する。
- 再挑戦は可能。
- ランキングは自己ベストを基本表示し、初回記録も保持する。
- 有効問題集合が変わった記録は別ランキングとして扱う。

## 9.4 問題集合の切替

初回版では自動切替を作らない。

管理者が次を確認した後、Supabaseの`active_set_id`を手動で変更する。

- 新集合の3問がすべて検査済み
- 旧集合のランキングを保持できる
- 実験場が新しい集合名を取得できる
- クライアントとEdge Functionの版が一致する

切替時に`public.game_scores`の古い値へ依存しない。ランキングは必ず`set_id`で絞る専用RPCを使う。

---

# 10. 画面構成

## 10.1 画面状態

画面状態を一つの列挙へまとめる。

```ts
type ScreenId =
  | "boot"
  | "home"
  | "tutorial"
  | "practice-select"
  | "preparing"
  | "countdown"
  | "playing"
  | "stage-clear"
  | "result"
  | "ranking"
  | "how-to-play"
  | "settings"
  | "fatal-error";
```

複数画面を同時に見せない。モーダルはリセット確認と通信エラーの補助だけに限定する。

## 10.2 ホーム

表示順を固定する。

1. ゲーム名
2. 一文説明
3. 名前入力
4. 「3問競技」
5. 「練習」
6. 「遊び方」
7. 現在の上位10件への導線
8. 「ゲームをシェア」
9. 「カメレオンJPの実験場へ」
10. 音、振動、動きを減らす設定
11. BUILD情報

一文説明:

> 石板の環を回し、必要な受信石へ光を届けます。3問の合計タイムを競います。

名前の初期表示は「名前を入力してください」とし、個人名の例を入れない。

名前未入力、空白だけ、上限超過では「3問競技」と「練習」を開始できない。

## 10.2.1 名前の契約

名前はクライアントとEdge Functionで同じ処理を行う。

1. Unicode NFKCで正規化する。
2. 改行とタブを半角空白へ変える。
3. 連続空白を一つにする。
4. 前後空白を除く。
5. 1〜10文字に制限する。
6. 制御文字だけの名前を拒否する。

サーバーが確定した名前とクライアント送信値が一致しないrunは開始しない。名前は公開ランキングへ表示されることを入力欄の近くへ短く書く。

## 10.3 正式競技の準備画面

- 「問題を準備しています」
- 通信失敗時の再試行
- 競技受付停止中の説明
- 旧版クライアント時の再読み込み案内
- 未送信結果がある場合の再送処理
- 破棄待ちrunがある場合のabandon再送

準備中に3問すべてのSVG要素とテキストを先に作るが、盤面はカウントダウン開始まで表示しない。競技開始後にネットワーク取得を行わない。

## 10.4 カウントダウン

- `3`、`2`、`1`、`開始`を中央へ表示する。
- サーバーが返した`goAt`を基準にする。
- 入力は`goAt`まで無効。
- カウントダウン中にブラウザが隠れた場合も、`goAt`は変えない。
- 読み上げでは数字を一回ずつ通知する。

## 10.5 ゲーム画面

スマートフォン縦画面では、次の順に一画面へ置く。

```text
問題 1/3        合計 00.000
この問題 00.000   点灯 4/6

        石板盤面

環の選択: 外側 / 中外 / 中内 / 内側

[左へ] [発信中・停止] [右へ]

操作 12回       [最初に戻す]
```

第1問の3環では、環名を「外側 / 中央 / 内側」とする。

画面内へ常時置かないもの:

- 長いルール説明
- 部品一覧
- 問題生成情報
- 最短手数
- 正解率
- ランキング
- シェアボタン

これらをゲーム画面へ並べ、盤面を小さくしてはいけない。

## 10.6 盤面の大きさ

- 幅は`min(92vw, 52dvh, 520px)`を基準にする。
- 320×568でも直径260px以上を目標にする。
- ボタンと安全領域を確保したうえで、盤面を可能な限り大きくする。
- 盤面内部の最小タップ環幅は36px以上を目標とする。
- 環選択は下部のボタンでも必ず行えるため、盤面タップだけへ依存しない。

## 10.7 環の選択

- 盤面上の環をタップして選べる。
- 下部の環ボタンでも選べる。
- 選択環は輪郭、短い刻印、環ボタンの押下状態で示す。
- 環選択時に回転は起こさない。
- 盤面上の半径判定はSVG座標へ変換して行う。

## 10.8 回転操作

- 正式操作は大きな左右ボタンの1回タップとする。
- 1回で必ず1段だけ回る。
- 長押し連続回転は初回版で実装しない。
- スワイプ回転は初回版で実装しない。
- 連打は受け付けるが、35ms未満の重複入力は無視する。
- 入力のたびに論理状態を即時更新する。
- 見た目の回転は120msから160msの短い補間とする。
- `prefers-reduced-motion`または「動きを減らす」設定では補間しない。

## 10.9 回転表示の巻き戻り防止

論理回転は`0..15`で持つが、描画用回転は累積手数で持つ。

```ts
type RingVisualState = {
  logicalRotation: number;
  cumulativeVisualSteps: number;
};
```

`15 → 0`のときに逆方向へ大回りして見えないようにする。リセット時だけ、遷移を一時停止して開始角度へ戻す。

## 10.10 発信切替

- `canToggle = false`では「発信固定」と表示し、無効状態にする。
- 発信中は「発信中・止める」。
- 発信停止中は「停止中・発信する」。
- 色だけでなく、アイコンと文言を変える。
- 連打で二重反転しない。

## 10.11 光の表示

- 発信中の全光路を表示する。
- 遮られた光は遮断物まで表示する。
- 外周へ届いた光は受信位置まで表示する。
- 中心で交差する光を消さない。
- 光の描画順は、石板背景より前、部品より後ろとする。
- 発光フィルターを常時重ねすぎない。
- 静止中は`requestAnimationFrame`を動かさない。

## 10.12 問題完了演出

- 成功判定は操作直後に確定する。
- 500msだけ入力を止める。
- 必須受信石を一度だけ順番に強調する。
- 中央紋が開く。
- 「第1問 12.345秒」のように区間タイムを表示する。
- 500ms後に次の問題を開始する。
- 問題間に通信処理を入れない。

## 10.13 リセット確認

表示文:

> この問題を最初の配置へ戻します。タイムは進み続けます。

ボタン:

- 戻さない
- 最初に戻す

確認画面を開いただけでは操作記録へ入れない。

## 10.14 結果画面

優先順位を固定する。

1. 「3問完了」
2. 合計タイム
3. 各問題のタイム
4. 操作回数
5. 自己ベストまたは初回記録
6. ランキング送信状態
7. 現在の問題集合名
8. 上位10件
9. 同じ3問へ再挑戦
10. 練習する
11. 結果をシェア
12. ホームへ
13. 実験場へ

通信失敗時は「再送する」を表示する。新しい競技を開始する前にも未送信結果を再送する。

## 10.15 パソコン操作

補助操作として次を用意する。

- 左右キー: 選択環を回す
- 上下キー: 環を選ぶ
- Space: 発信切替
- `R`: リセット確認を開く
- Escape: リセット確認や設定を閉じる

キーボードだけで正式競技を完了できることを自動検査する。ただし、スマートフォン操作を主設計とする。

---

# 11. 石板デザインの実装基準

## 11.1 基本色

具体的な色番号は実装時に微調整してよいが、役割を変えない。

| 用途 | 方針 |
|---|---|
| 背景 | 暗い土色、黒褐色 |
| 石板 | 明るい砂岩色、灰褐色 |
| 選択環 | 青緑の輪郭 + 三つの刻印 |
| 発信石 | 琥珀または朱色 + 放射刻印 |
| 遮り石 | 黒灰色 + X溝 |
| 必須受信石 | 白い二重輪郭 |
| 点灯済み | 青緑または黄緑 + 中央塗り + 確認刻印 |
| 光 | 琥珀色を基準にし、必須到達時だけ青緑を重ねる |

赤と緑だけで成功・失敗を区別しない。

## 11.2 石の質感

- CSSの複数グラデーションと、少数のSVG亀裂線で表現する。
- 毎フレームノイズを生成しない。
- 重い`feTurbulence`を全画面へ常時適用しない。
- 亀裂は決定的な固定シードで作り、再描画ごとに変えない。
- 苔は四隅または外枠へ限定し、操作部品へ重ねない。
- 文字の背後へ強い模様を置かない。

## 11.3 文字

- 外部フォントを読み込まない。
- `system-ui`、`-apple-system`、日本語システムフォントを使う。
- ゲーム中の主要文字は14px未満にしない。
- タイムは等幅数字が使えるフォント設定にする。
- 背景とのコントラストを自動検査する。

## 11.4 情報量

生成画像にあった左側・右側の説明パネルを、そのままスマートフォンへ再現しない。

ゲーム中は次だけを見せる。

- 問題数
- タイム
- 点灯数
- 盤面
- 環選択
- 左、切替、右
- 操作回数
- リセット

石板の雰囲気は、情報量ではなく、枠、刻印、部品形状、短い完了演出で出す。

---

# 12. 計測契約

## 12.1 サーバー基準の開始時刻

正式競技では、`begin`応答に次を含める。

```ts
type BeginResponse = {
  accepted: true;
  runToken: string;
  serverNowMs: number;
  goAtMs: number;
  setId: string;
  setVersion: string;
  contentHash: string;
};
```

サーバーは`goAtMs`を処理時点から4秒後に設定する。ブラウザは応答受信後、残り3秒になるまでは「準備中」と表示し、その後に`3`、`2`、`1`を表示する。サーバー時刻との差を推定し、`goAtMs`で入力を解放する。

## 12.2 表示時計

- 通常更新は`performance.now()`を使う。
- サーバーとの差を、`begin`または`resume`応答で補正する。
- 1フレームごとに論理状態を進めない。
- 表示は小数3桁とする。
- 記録は整数ミリ秒とする。

## 12.3 問題間の固定時間

```ts
export const STAGE_TRANSITION_MS = 500 as const;
```

第1問と第2問、第2問と第3問の間で、各500msを合計タイムから除く。

サーバーが操作記録を再生して得た解答時刻を`solveAt[0..2]`とすると、次で計算する。

```text
stage1 = solveAt[0]
stage2 = solveAt[1] - (solveAt[0] + 500)
stage3 = solveAt[2] - (solveAt[1] + 500)
total  = stage1 + stage2 + stage3
```

各区間が0未満になる記録は拒否する。

## 12.4 正式競技中の画面離脱

- ページが非表示になっても`goAt`と競技時計を止めない。
- 復帰時にサーバー時刻を再取得できる場合は補正する。
- 取得できなくても、既存の基準で表示を続ける。
- 結果検証はサーバー時刻と操作記録を使う。
- 画面を離れた時間を減算しない。

## 12.5 練習中の画面離脱

練習だけは一時停止してよい。正式競技と同じ関数へ条件を混ぜず、モードで明確に分ける。

---

# 13. 操作記録契約

## 13.1 形式

```ts
type TraceAction =
  | { readonly t: number; readonly p: 0 | 1 | 2; readonly type: "rotate"; readonly ring: number; readonly direction: -1 | 1 }
  | { readonly t: number; readonly p: 0 | 1 | 2; readonly type: "toggle"; readonly ring: number }
  | { readonly t: number; readonly p: 0 | 1 | 2; readonly type: "reset" };

type RunTraceV1 = {
  readonly version: 1;
  readonly setId: string;
  readonly setVersion: string;
  readonly contentHash: string;
  readonly events: readonly TraceAction[];
  readonly truncated: boolean;
};
```

`t`は`goAt`からの経過ミリ秒で、整数とする。

## 13.2 制限

```ts
export const MAX_TRACE_EVENTS = 512;
export const MAX_RUN_TIME_MS = 1_800_000;
export const MIN_ACTION_INTERVAL_MS = 35;
export const MAX_REQUEST_BYTES = 128_000;
```

- `t`は0以上、最大30分。
- 時刻は厳密に増加する。
- 連続操作の間隔は35ms以上。
- 問題番号は後戻りしない。
- 解答済み問題への操作を含めない。
- 第2問の最初の操作は、第1問解答時刻+500ms以降。
- 第3問も同様。
- `truncated = true`の記録はランキングへ送らない。

## 13.3 記録の順序

1. 操作が合法か調べる。
2. 時刻を確定する。
3. 操作記録へ追加する。
4. 共有エンジンへ操作を適用する。
5. 成功判定を行う。
6. 必要なら問題完了へ移る。

クライアントとサーバーでこの順を揃える。

## 13.4 サーバー再生

サーバーは送信された合計タイムを信用しない。

- 有効問題集合を再生成する。
- `contentHash`を照合する。
- 初期状態から全操作を順に適用する。
- 3問が順番どおり解けたか確認する。
- 区間タイムを再計算する。
- 操作回数、リセット回数を再計算する。
- クライアント送信値と一致しなければ拒否する。

## 13.5 限界の明記

操作記録の再生は、送信値の書き換えや不可能な盤面結果を拒否するためのものとする。操作が実際に人の指から発生したことまでは証明しない。

公開文言で「完全な不正防止」と断定しない。

---

# 14. 保存と再開

## 14.1 localStorageキー

仮slugを使い、他ゲームと衝突させない。

```text
chameleonjp_sekiban_kairo_player_name_v1
chameleonjp_sekiban_kairo_tutorial_v1
chameleonjp_sekiban_kairo_settings_v1
chameleonjp_sekiban_kairo_practice_history_v1
chameleonjp_sekiban_kairo_active_run_v1
chameleonjp_sekiban_kairo_pending_results_v1
chameleonjp_sekiban_kairo_pending_abandons_v1
chameleonjp_sekiban_kairo_client_instance_v1
```

## 14.2 正式競技のチェックポイント

各合法操作後に、次を保存する。

- run token
- 問題集合の公開定義
- setId、setVersion、contentHash
- 現在問題番号
- 3問の状態
- 操作記録
- 選択環
- beginで受け取ったgoAt
- 最後に同期したserverNow
- クライアント版、契約版

保存値から状態を直接信用せず、問題初期状態から操作記録を再生して復元する。

## 14.3 再読み込み

起動時に有効な進行中runがあれば、`resume`を呼ぶ。

- サーバー側が`active`なら操作記録を再生して復元する。
- 版、集合、ハッシュが違う場合は再開しない。
- サーバー側が`completed`なら保存済み結果を表示する。
- `abandoned`または`expired`なら端末保存を消す。
- 壊れた保存値は削除し、白画面にしない。

## 14.4 解答直後の保存順

第3問を解いたら、次の順にする。

1. 合計タイムと操作記録を計算する。
2. 未送信結果をlocalStorageへ保存する。
3. 進行中runを「解答済み・送信待ち」へ変える。
4. 結果画面を表示する。
5. サーバーへ送信する。
6. 成功後に未送信結果を削除する。

Safariが結果画面表示前に終了しても、同じrun tokenで再送できるようにする。

## 14.5 保存期限

- prepared run: 10分
- active runと未送信結果: 24時間
- pending abandon: 成功または24時間経過まで
- 練習履歴: 直近30件

期限切れは安全に破棄し、新しい正式競技を開始できるようにする。

---

# 15. ランキング仕様

## 15.1 順位

同じ問題集合の中で、次の順に比較する。

1. 合計タイムが短い
2. 合計操作回数が少ない
3. 有効記録の送信時刻が早い

リセット回数は操作回数へ含まれるため、独立した順位条件にはしない。ただし結果詳細には表示してよい。

## 15.2 一人の記録

同じ正規化名について、次を保持する。

- 初回有効記録
- 自己ベスト
- 有効プレイ回数
- ベスト時の操作回数
- ベスト時の各問題タイム
- 最終更新時刻

自己ベストの比較も、タイム、操作回数、送信時刻の順とする。

## 15.3 表示

ゲーム内と実験場の両方で上位10件を表示する。

表示項目:

- 順位
- 名前
- 合計タイム
- 操作回数
- 必要に応じて各問題タイム

公開画面でrun token、端末識別子、IP由来の値、操作記録を表示しない。

## 15.4 問題集合の分離

専用ランキングRPCは、設定テーブルの`active_set_id`で絞る。過去集合の記録を現在集合へ混ぜない。

初回版のゲーム画面では過去集合ランキングを表示しない。データは保持する。

## 15.5 Supabase `games`登録値

仮値を次とする。

| 列 | 値 |
|---|---|
| `game_slug` | `sekiban_kairo` |
| `title` | `石板回路` |
| `game_url` | `https://chameleonjp-lab.github.io/sekiban_kairo/` |
| `description` | `石板の環を回し、必要な受信石へ光を届ける3問タイムパズルです。` |
| `share_text` | `石板回路で3問の石板に挑戦しました` |
| `score_order` | `asc` |
| `score_unit` | `秒` |
| `score_scale` | `1000` |
| `score_decimals` | `3` |
| `score_label` | `3問合計` |
| `first_score_label` | `初回タイム` |
| `best_score_label` | `ベストタイム` |
| `top_ranking_type` | `best` |
| `submission_mode` | `verified` |
| `score_min` | `1` |
| `score_max` | `1800000` |
| `is_active` | 公開確認完了まで`false` |
| `display_order` | PR6時点の末尾へ追加。固定値を推測しない |

---

# 16. シェア仕様

## 16.1 ホーム

```text
石板回路
石板の環を回し、3問の合計タイムに挑戦します。
https://chameleonjp-lab.github.io/sekiban_kairo/
```

## 16.2 結果

```text
石板回路
3問を 34.567秒 で完了しました。
操作回数: 24回
https://chameleonjp-lab.github.io/sekiban_kairo/
```

## 16.3 実装

1. `navigator.share`が使える場合は共有シートを開く。
2. 失敗または未対応ならClipboard APIを使う。
3. Clipboard APIも失敗したら、選択可能なテキスト欄を表示する。
4. ゲーム操作領域の選択禁止を、共有文欄へ適用しない。

ホームと結果で文言を分ける。

---

# 17. 技術構成

## 17.1 採用構成

- TypeScript
- Vite
- SVG
- Vitest
- Playwright
- npm
- GitHub Pages
- Supabase Edge Functions
- PostgreSQLのprivateスキーマ
- ランタイム依存ライブラリは原則ゼロ

Reactは必須にしない。画面数が限定され、盤面はSVGを直接制御するため、TypeScriptの画面管理で実装する。

このゲームは、共有エンジン、生成器、解法探索、サーバー再生を分ける必要があるため、共通テンプレートの1ファイル構成は採用しない。例外理由をREADMEへ明記する。

## 17.2 推奨ファイル構成

```text
/
  index.html
  package.json
  package-lock.json
  vite.config.ts
  tsconfig.json
  playwright.config.ts
  README.md
  CLAUDE.md
  docs/
    IMPLEMENTATION_PLAN.md
    GAME_SPEC.md
    RULE_CONTRACT.md
    RIGHTS_BOUNDARY.md
    PUZZLE_GENERATION.md
    SUPABASE_CONTRACT.md
    RELEASE_CHECKLIST.md
  src/
    main.ts
    app/
      AppController.ts
      ScreenState.ts
      GameFlow.ts
      CompetitionFlow.ts
      PracticeFlow.ts
    ui/
      StoneBoardRenderer.ts
      ScreenRenderer.ts
      input.ts
      accessibility.ts
      styles.css
      screens/
        home.ts
        tutorial.ts
        practiceSelect.ts
        game.ts
        result.ts
        ranking.ts
        settings.ts
    services/
      competitionApi.ts
      rankingApi.ts
      storage.ts
      share.ts
      sound.ts
      haptics.ts
      clock.ts
    content/
      tutorialPuzzles.ts
      practiceCatalog.json
  shared/
    sekiban-kairo/
      constants.ts
      types.ts
      validation.ts
      engine.ts
      beamTrace.ts
      actions.ts
      replay.ts
      trace.ts
      timing.ts
      canonicalJson.ts
      hash.ts
      generator/
        prng.ts
        generatePuzzle.ts
        generateSet.ts
        solver.ts
        metrics.ts
        rejection.ts
  scripts/
    generate-puzzles.ts
    audit-puzzles.ts
    select-puzzles.ts
    render-puzzle-samples.ts
    verify-puzzle-catalog.ts
  supabase/
    functions/
      sekiban-kairo-competition/
        index.ts
        shared.ts
    migrations/
      <Supabase CLIで作成した実ファイル>
  tests/
    unit/
    generator/
    integration/
    e2e/
  .github/
    workflows/
      ci.yml
      deploy-pages.yml
```

## 17.3 共有コード

`shared/sekiban-kairo`はブラウザとEdge Functionの両方から読み込む。

禁止事項:

- Edge Functionに別の光路実装を複製する
- ブラウザだけの特殊判定を入れる
- テスト用の簡略エンジンでサーバー検証する
- Node専用APIを共有コードへ入れる

## 17.4 ネットワーク

ブラウザからは`fetch`を使う。Supabase JavaScriptライブラリを必須にせず、実行時の依存と配布量を減らす。

- Edge Function: `POST`
- ランキングRPC: Supabase REST RPCへ`POST`
- APIキー: Publishable key
- `Authorization`へsecret keyを入れない
- タイムアウト: prepare/begin 10秒、finish 15秒、ranking 10秒
- 再試行: prepareは手動、finishは自動1回+手動再送

---

# 18. Supabase設計

## 18.1 既存基盤との関係

既存の次を利用する。

- `public.games`
- `public.score_runs`
- `public.players`
- ランキング状態の既存運用

`public.game_scores`だけでは問題集合を分けられないため、このゲームの順位正本には使わない。検証済みrunの完了時には、既存の参加回数とランキング停止状態を維持するために同表も更新するが、正式な順位は必ず`score_runs`をactive setで絞る専用RPCから作る。実験場側で汎用の`get_best_score_ranking`をこのslugへ使ってはいけない。

## 18.2 privateテーブル

### `private.sekiban_kairo_competition_config`

| 列 | 型 | 役割 |
|---|---|---|
| `singleton` | boolean PK | 常にtrue |
| `generation` | text | 問題集合世代 |
| `client_version` | text | 受付クライアント版 |
| `contract_version` | text | 通信契約版 |
| `active_set_id` | text | 現在の正式問題集合 |
| `accepting_runs` | boolean | 受付停止スイッチ |
| `updated_at` | timestamptz | 更新時刻 |

### `private.sekiban_kairo_sets_v1`

| 列 | 型 | 役割 |
|---|---|---|
| `set_id` | text PK | 集合ID |
| `set_version` | text | 集合版 |
| `set_seed` | text | 生成用シード |
| `rule_version` | text | ルール版 |
| `generator_version` | text | 生成版 |
| `content_hash` | text UNIQUE | 生成結果のハッシュ |
| `validation_summary` | jsonb | 最短手数などの検査値 |
| `status` | text | draft/approved/active/retired |
| `created_at` | timestamptz | 作成時刻 |
| `activated_at` | timestamptz | 有効化時刻 |

問題定義は`set_seed`からEdge Function内で再生成し、`content_hash`と一致することを確認する。大量の正解手順をDBへ保存しない。

### `private.sekiban_kairo_runs_v1`

| 列 | 型 | 役割 |
|---|---|---|
| `run_token` | uuid PK | 使い捨てrun識別子 |
| `game_slug` | text | `sekiban_kairo`固定 |
| `generation` | text | 世代 |
| `client_version` | text | クライアント版 |
| `contract_version` | text | 契約版 |
| `display_name` | text | 表示名 |
| `normalized_name` | text | 正規化名 |
| `client_instance_key` | text | 端末識別子をsecretと共にハッシュ化した値 |
| `set_id` | text | 問題集合 |
| `set_version` | text | 集合版 |
| `content_hash` | text | 集合ハッシュ |
| `status` | text | prepared/active/completed/abandoned/expired/rejected |
| `prepared_at` | timestamptz | 準備時刻 |
| `go_at` | timestamptz | 競技開始時刻 |
| `completed_at` | timestamptz | 完了時刻 |
| `expires_at` | timestamptz | 期限 |
| `total_time_ms` | integer | サーバー再計算値 |
| `stage_times_ms` | integer[] | 3区間 |
| `action_count` | integer | 操作数 |
| `reset_count` | integer | リセット数 |
| `server_elapsed_time_ms` | integer | goAtからfinishまで |
| `operation_trace` | jsonb | 操作記録 |
| `trace_event_count` | integer | 件数 |
| `trace_hash` | text | 記録ハッシュ |
| `score_run_id` | bigint | `public.score_runs.id` |
| `result_payload` | jsonb | 重複送信時に返す結果 |

### `private.sekiban_kairo_request_buckets_v1`

送信元、端末識別子、正規化名を、secret keyを混ぜたSHA-256でハッシュ化して保持する。生のIPアドレスを保存しない。

## 18.3 RLSと権限

- privateテーブルでもRLSを有効にする。
- `public`、`anon`、`authenticated`から全権限を剥奪する。
- `service_role`だけに必要権限を付ける。
- 内部RPCは`SECURITY DEFINER`、`SET search_path = ''`とする。
- 内部RPCの`EXECUTE`を`PUBLIC`から剥奪し、`service_role`だけへ付ける。
- 公開ランキングRPCだけ`anon`と`authenticated`へ実行権限を付ける。
- 既存の検証済み書込ガードを上書きで壊さず、このgame slug用の分岐だけを追加する。

## 18.4 内部RPC

次を作る。

```text
sekiban_kairo_prepare_run_internal
sekiban_kairo_begin_run_internal
sekiban_kairo_resume_run_internal
sekiban_kairo_abandon_run_internal
sekiban_kairo_finalize_run_internal
sekiban_kairo_request_gate_internal
get_sekiban_kairo_ranking_v1
get_sekiban_kairo_stats_v1
```

## 18.5 prepare

入力:

- playerName
- clientVersion
- contractVersion
- clientInstanceId

処理:

1. 版を検査する。
2. 名前を検査する。
3. 受付フラグと`public.games.is_active`を確認する。
4. 期限切れrunを更新する。
5. 同名・同端末の未完了run数を確認する。
6. active setを取得する。
7. 共有生成器で3問を再生成する。
8. contentHashを照合する。
9. prepared runを作る。
10. run tokenと公開問題定義を返す。

## 18.6 begin

- prepared runだけをactiveへ変える。
- `go_at = clock_timestamp() + interval '4 seconds'`を設定する。
- 同じrunへの重複beginは、同じ`go_at`を返す。
- 別版または期限切れは拒否する。
- `serverNowMs`と`goAtMs`を返す。

## 18.7 resume

- run token、版を検査する。
- activeまたはcompletedだけを返す。
- activeなら、集合、goAt、serverNowを返す。
- completedなら保存済み`result_payload`を返す。
- 操作記録はクライアント保存を正本とし、サーバーが途中記録を受け取る設計にはしない。

## 18.8 abandon

- preparedまたはactiveをabandonedへ変える。
- completedは完成済み状態として返す。
- 同じabandonを再送しても成功扱いにする。
- 新しい競技開始前に、端末のpending abandonを先に送る。

## 18.9 finish

Edge Functionで共有エンジンによる再生を行い、その結果を内部finalize RPCへ渡す。

finalize RPCは次を再確認する。

- run tokenと名前が一致
- setId、setVersion、contentHashが一致
- クライアント版、契約版が一致
- active状態
- 期限内
- `public.games.is_active = true`
- `accepting_runs = true`
- server elapsedが不自然に短くない
- 各値が上限内
- 同じrunの重複送信か

## 18.10 `public.score_runs`への保存

検証済み結果だけ、次のmetadataで保存する。

```json
{
  "source": "sekiban_kairo_verified_v1",
  "verification": "server-replay-v1",
  "set_id": "SK-SET-001",
  "set_version": "V1",
  "content_hash": "...",
  "rule_version": "stone-path-rule-v1",
  "generator_version": "stone-path-generator-v1",
  "total_time_ms": 34567,
  "stage_times_ms": [8234, 10422, 15911],
  "action_count": 24,
  "reset_count": 0,
  "display_name": "...",
  "run_token": "...",
  "trace_version": 1,
  "trace_event_count": 24,
  "trace_hash": "..."
}
```

`score`列には`total_time_ms`をそのまま入れる。`public.players`を更新し、`public.game_scores`は初回値、全集合を通した最小値、参加回数、ランキング停止状態を維持するための補助集計として更新する。ただし、この`best_score`を現在集合の正式順位へ使わない。

insert直前にtransaction-localな検証済みrun設定を入れ、既存のscore write guardがこのrun tokenとprivate台帳を照合できるようにする。

## 18.11 専用ランキングRPC

`get_sekiban_kairo_ranking_v1(p_limit integer default 10)`は、現在のactive setだけを対象にする。

1. `score_runs`から`source = sekiban_kairo_verified_v1`を選ぶ。
2. `set_id`と`set_version`を現在設定で絞る。
3. `ranking_status = normal`の名前だけを使う。
4. 一人ごとに最良runを選ぶ。
5. タイム、操作回数、送信時刻で順位を付ける。
6. 1〜100件の範囲で返す。

返却列:

```text
rank_no
display_name
first_time_ms
best_time_ms
play_count
best_action_count
best_stage_times_ms
set_id
set_version
updated_at
```

正規化名、run token、操作記録は公開RPCの返却列へ含めない。

## 18.12 レート制限

初期値:

| action | 1分あたり |
|---|---:|
| prepare | 10 |
| begin | 20 |
| resume | 30 |
| abandon | 30 |
| finish | 20 |

送信元、端末、名前のいずれかが上限に達した場合、`429`と`Retry-After`を返す。

同じ正規化名または同じ`client_instance_key`で保持できる未完了runは最大3件とする。期限切れとabandonedは数えない。

## 18.13 Edge Function

- 許可originはGitHub Pages本番とローカル開発だけ。
- `OPTIONS`へ204を返す。
- `POST`以外を拒否する。
- Content-Typeを検査する。
- リクエスト本文は128KBまで。
- Publishable keyを検査する。
- secret keyは環境変数から読む。
- エラー本文へ内部SQL、鍵、IPを出さない。
- ログへplayerNameとrun token全体を出さない。
- `Cache-Control: no-store`を付ける。
- version mismatchは409、入力不正は400、受付停止は503、改ざんは422、制限は429とする。

## 18.14 有効化

PR5のSupabase適用時は次を維持する。

```text
public.games.is_active = false
private.sekiban_kairo_competition_config.accepting_runs = false
```

PR6の公開確認後に、次の順で有効化する。

1. `public.games.is_active = true`
2. 実験場、ランキング0件、ゲームURLを確認
3. `accepting_runs = true`
4. 実際の3問を一回完了
5. 結果、順位、再送、二重送信を確認

問題があれば、最初に`accepting_runs = false`へ戻す。

---

# 19. エラーと復旧

## 19.1 起動失敗

- 必須DOMがない
- 問題カタログが壊れている
- 保存値が壊れている

白画面にせず、「読み込みに失敗しました」「保存データを初期化して再試行」を表示する。

## 19.2 prepare失敗

- 練習は遊べる。
- 正式競技だけを開始不可にする。
- 全画面再読み込みを強制せず、再試行ボタンを出す。
- 連打中は再試行ボタンを無効にする。

## 19.3 begin失敗

- カウントダウンを開始しない。
- prepared runをabandonする。
- abandon失敗時はpending queueへ保存する。

## 19.4 finish失敗

- 結果画面は消さない。
- 未送信結果を保存する。
- 自動再試行は一回だけ。
- 以降は手動再送。
- version mismatchまたは期限切れでは、再送不能理由を明示する。

## 19.5 ランキング取得失敗

- 結果自体は表示する。
- 「ランキングを読み込めませんでした」と再試行を表示する。
- 送信成功とランキング取得失敗を混同しない。

## 19.6 保存容量不足

- 古い練習履歴を削除して再試行する。
- 正式未送信結果を練習履歴より優先する。
- 保存できなかった場合は、結果画面で明確に警告する。

---

# 20. 音、振動、動き

## 20.1 音

外部音源を使わず、Web Audio APIで短い独自音を合成する。

- 環選択: 低い石の接触音
- 回転: 短い擦過音
- 発信切替: 二音の上昇または下降
- 必須受信石点灯: 柔らかい単音
- 問題完了: 三音以内
- 3問完了: 短い和音

初回のユーザー操作前にAudioContextを開始しない。

## 20.2 振動

- 回転成功: 10ms以下
- 切替: 15ms以下
- 問題完了: 短い二回
- 非対応端末でも同じ情報を画面で示す

振動の有無でタイムや入力受付を変えない。

## 20.3 動きを減らす

次のどちらかで動きを減らす。

- OSの`prefers-reduced-motion`
- ゲーム設定

減らす内容:

- 環回転の補間
- 受信石の脈動
- 亀裂の光走査
- 完了時の拡大

状態変化そのものは消さない。

---

# 21. 性能基準

- ランタイムの外部依存ライブラリを原則ゼロにする。
- 初期JavaScriptはgzip後250KB以下を目標とする。
- 練習問題JSONはgzip後100KB以下を目標とする。
- 静止中に常時`requestAnimationFrame`を回さない。
- SVG要素数は通常250以下、最大350以下を目標とする。
- 光線は最大12本。
- 1操作のエンジン計算は通常1ms未満を目標とする。
- 盤面評価でDOMを読まない。
- 競技中に幅優先探索をしない。
- 画像、フォント、音声ファイルのネットワーク取得をしない。
- 画面非表示中は装飾更新を止めるが、正式時計は止めない。
- iPhone Safariで15分連続操作して、入力遅延や発熱が増え続けないことを確認する。

---

# 22. アクセシビリティ

- 主要ボタンは最低44×44px、推奨48×48px。
- ボタンには動作を表す`aria-label`を付ける。
- 選択環は`aria-pressed`または同等の状態を示す。
- 発信状態をテキストで表示する。
- 点灯数を`aria-live="polite"`で更新する。
- 問題完了は一度だけ読み上げる。
- タイマーを毎フレーム読み上げない。
- SVGには盤面全体の説明を付け、各装飾線を読み上げ対象にしない。
- キーボードフォーカスを見えるようにする。
- 色、発光、振動、音のどれか一つだけへ情報を依存させない。
- ホームと説明画面ではブラウザの拡大を妨げない。
- ゲーム領域だけ`touch-action: none`を使い、入力欄やリンクへ適用しない。

---

# 23. 自動検査

## 23.1 ルール単体検査

最低限、次を全件テストする。

- 右16回で元へ戻る
- 左16回で元へ戻る
- 左1回と右1回で元へ戻る
- 選んだ環だけが動く
- 発信停止中は光を出さない
- 発信停止中の石は他の光を遮る
- 遮り石で内向き光が止まる
- 遮り石で外向き光が止まる
- 発信石で他の光が止まる
- 光同士の交差では止まらない
- 反対位置計算が全16方向で正しい
- 余分な光があっても必須受信石が全部点灯すれば成功
- 必須受信石が一つ欠ければ失敗
- 同じ受信石へ複数光が届いても一回だけ数える
- resetで初期状態へ完全に戻る
- 不正操作は状態を変えない
- 問題定義を変更しない

## 23.2 既知ベクトル

少なくとも10個の小さな手作り盤面を作り、点灯mask、遮断位置、成功判定を固定値で検査する。

この手作り盤面も独自に作り、外部作品の配置を使わない。

## 23.3 生成検査

- 同じシードで同じJSONとハッシュ
- 違うシードで十分に異なる
- 開始時に未解答
- 幅優先探索で解答可能
- 最短操作数が指定範囲
- 第2、第3問は切替が必須
- 全環が正本解答で使われる
- 対称性拒否が働く
- 重複問題を採用しない
- 3問の難度順が正しい
- 破棄理由が記録される

## 23.4 解法探索検査

- 既知盤面で最短距離が一致
- 最短解数が一致
- 操作展開順が固定
- 探索上限時に安全に失敗
- 状態エンコードとデコードが往復一致
- 4環最大状態で配列外参照しない

## 23.5 計時検査

偽時計を使い、次を検査する。

- goAt前は操作不可
- goAtちょうどで操作可
- 問題間500msは入力不可
- 合計から1,000msだけ除く
- 各区間と合計が一致
- 画面非表示でも正式時計が進む
- 練習だけは一時停止できる
- 再読み込み後にserverNowで補正できる

## 23.6 操作記録検査

- 合法操作だけ記録
- 時刻が厳密に増える
- 35ms未満を拒否
- 512件超過でtruncated
- 問題番号の後戻りを拒否
- 解答後操作を拒否
- 改ざんした合計タイムを拒否
- 改ざんした操作回数を拒否
- 別集合のtraceを拒否
- 不正なresetを拒否

## 23.7 保存検査

- 壊れたJSON
- 旧schemaVersion
- 存在しないsetId
- 一部欠損
- 期限切れrun
- completed runの再表示
- pending result再送
- pending abandon再送
- 保存容量例外

いずれも白画面にしない。

## 23.8 画面検査

次の幅で横スクロールがないことを自動検査する。

```text
320×568
375×667
390×844
402×874
430×932
844×390
```

確認画面:

- ホーム
- 名前入力中
- チュートリアル
- 第1問
- 第2問
- 第3問
- リセット確認
- 結果
- ランキング0件
- ランキング10件
- 通信エラー
- 文字拡大時

## 23.9 操作検査

- 連打しても1タップ1段
- pointercancelで押下状態が残らない
- 二本指で誤回転しない
- 長押しメニューがゲーム領域で出ない
- 入力欄では文字選択と貼り付けができる
- ブラウザの戻る・進むで白画面にならない
- 画面回転で盤面が切れない
- キーボードだけで完了できる

## 23.10 Edge Function検査

- CORS許可origin
- 不許可origin
- 無効API key
- 128KB超過
- 不正JSON
- version mismatch
- prepareの重複
- beginの重複
- abandonの重複
- finishの重複
- 完了済みrunへ別結果を送る
- 期限切れ
- 改ざんtrace
- server elapsed未満
- rate limit
- 受付停止
- ゲーム非公開

## 23.11 セキュリティ検査

- privateテーブルをanonで読めない
- 内部RPCをanonで実行できない
- 公開RPCは必要列だけ返す
- `service_role`がビルド成果物にない
- source map、ログ、HTMLへsecretがない
- generic `submit_score`からverifiedゲームへ書けない
- 既存ゲームの検証済み書込を壊していない
- DB Advisorのsecurity指摘を確認する

---

# 24. GitHub Actionsと公開

## 24.1 CI

`.github/workflows/ci.yml`を一つの品質検査入口にする。

- pull_request
- mainへのpush
- workflow_dispatch
- concurrencyで古い同一ブランチ実行を中止
- matrixを使わず、一つのジョブで順に検査
- `npm ci`
- typecheck
- lintまたは静的検査
- unit
- generator fixture
- build
- WebKit smoke
- Chromium smoke

定期実行は作らない。

## 24.2 重い検査

大量問題生成と全画面検査は`workflow_dispatch`で実行できるようにする。通常の小修正で大量のActions時間を消費しない。

## 24.3 Pages

`.github/workflows/deploy-pages.yml`はmainだけで動く。

- CIと同じビルドコマンドを使う
- GitHub Pagesのbase pathを固定
- HTML、JavaScript、CSS、faviconの参照切れを検査
- 公開後URLへHTTP確認
- `data-build-commit`または画面のBUILD表示へコミット短縮値を入れる
- 同じ役割のworkflowを複数作らない

## 24.4 BUILD表示

ホーム下部へ次を小さく表示する。

```text
BUILD / abcdef123456
RULE / stone-path-rule-v1
SET / SK-SET-001 V1
```

問題集合は正式競技を取得した後に表示する。練習では`PRACTICE`とする。

---

# 25. PR分割

## PR1 — 新規基盤、仕様固定、盤面エンジン

対象リポジトリ: `chameleonjp-lab/sekiban_kairo`  
推奨ブランチ: `work/01-rule-engine-foundation`

### 目的

新規リポジトリを作り、以後の実装で変えてはいけないルール契約と共有盤面エンジンを完成させる。

### 実装

- Vite + TypeScript + Vitestの最小構成
- package-lock固定
- CLAUDE.md
- README
- 本計画書を`docs/IMPLEMENTATION_PLAN.md`へ格納
- `GAME_SPEC.md`
- `RULE_CONTRACT.md`
- `RIGHTS_BOUNDARY.md`
- 共有型
- 問題定義検証
- 状態更新
- 光路計算
- 成功判定
- reset
- 既知ベクトル
- CIのtypecheck、unit、build

### 完了条件

- ルール単体検査がすべて成功
- ブラウザとDenoから読み込める共有コード
- 描画なしでも操作列を再生できる
- 外部作品の固有名、配置、画像がリポジトリにない
- slug重複確認済み
- Actionsは一つのCIだけ

### 含めない

- 問題生成
- 完成UI
- Supabase
- ランキング
- GitHub Pages公開

---

## PR2 — 問題生成器、解法探索、量産カタログ

対象リポジトリ: `chameleonjp-lab/sekiban_kairo`  
推奨ブランチ: `work/02-generator-solver-catalog`

### 目的

解ける問題だけを量産し、難度と見やすさを機械的に検査できる状態にする。

### 実装

- 文字列シードハッシュ
- 固定疑似乱数
- 問題逆生成
- 幅優先探索
- 最短解数
- 切替必須検査
- 対称性拒否
- 視認性拒否
- 破棄理由集計
- 問題集合生成
- 正規JSONと内容ハッシュ
- 量産コマンド
- SVG候補一覧
- チュートリアル2問
- 練習90問以上
- 正式候補6集合以上
- `PUZZLE_GENERATION.md`

### 完了条件

- 同じシードで同じ問題とハッシュ
- 各難度の最短操作数が範囲内
- 第2、第3問は回転だけでは解けない
- 採用問題がすべて自動探索で解ける
- 重複、対称、過密問題が除外される
- 通常CIは固定小規模検査だけ
- 大量生成の要約レポートをPRへ添付

### 含めない

- 正式競技画面
- Supabase
- 本番ランキング

---

## PR3 — 石板UI、操作練習、練習モード

対象リポジトリ: `chameleonjp-lab/sekiban_kairo`  
推奨ブランチ: `work/03-stone-ui-practice`

### 目的

iPhoneで一画面内に収まり、何を動かすか分かる石板パズルを完成させる。

### 実装

- boot、home、tutorial、practice-select、playing、settings
- 名前入力とlocalStorage
- SVG石板盤面
- 発信石、遮り石、受信石
- 光路表示
- 環タップ選択
- 環ボタン選択
- 左右1段回転
- 発信切替
- リセット確認
- 点灯数
- 操作回数
- 初回練習2問
- 練習難度選択
- 二段階ヒント
- 音、振動、動きを減らす設定
- 320〜430px対応
- WebKit/Chromium E2E

### 完了条件

- iPhone SE級でゲーム中の上下左右スクロールなし
- 主要ボタン44px以上
- 連打しても入力欠落と二重入力なし
- 色なしでも部品状態を判別可能
- 静止中に常時アニメーションしない
- 練習開始から完了、再挑戦まで動く
- 外部画像、音、フォントなし

### 含めない

- 正式サーバーrun
- 正式ランキング送信
- 実験場登録

---

## PR4 — 3問競技進行、計時、操作記録、結果と復旧

対象リポジトリ: `chameleonjp-lab/sekiban_kairo`  
推奨ブランチ: `work/04-competition-flow-trace`

### 目的

サーバー接続前でも、同じ契約で3問競技を最後まで再現できるクライアントを完成させる。

### 実装

- `CompetitionTransport`抽象
- mock transport
- preparing、countdown、stage-clear、result、ranking画面
- goAt基準カウントダウン
- 3問進行
- 500ms切替
- 区間タイムと合計
- 操作記録
- trace上限
- 画面非表示時の正式時計
- active run保存
- 操作記録からの復元
- pending result
- pending abandon
- 結果画面
- ホームと結果のシェア
- 上位10件のモック表示
- 同じ問題集合への再挑戦
- 偽時計を使うテスト

### 完了条件

- 3問を解いて合計タイムが正しい
- 500ms×2だけ合計から除外
- 操作記録の再生結果と画面結果が一致
- 再読み込み後に状態を復元
- 第3問直後に結果を先に保存
- 改ざんした保存値を安全に破棄
- 画面を離れても正式タイムが止まらない
- mock serverで二重finishが同じ結果を返す

### 含めない

- 本番DBへの書込
- Edge Function本番受付
- 実験場登録

---

## PR5 — 検証済みSupabase連携、Pages公開、公開候補完成

対象リポジトリ: `chameleonjp-lab/sekiban_kairo`  
推奨ブランチ: `work/05-verified-backend-release-candidate`

### 目的

ブラウザとサーバーで同じ操作を再生し、検証済み記録だけを保存できる公開候補を完成させる。

### 実装

- Supabaseの現行仕様と変更履歴を公式資料で再確認
- Supabase CLIの実コマンドを`--help`で確認
- CLIでmigration名を作成
- privateテーブル
- RLS、権限、index、制約
- 内部RPC
- 公開ランキングRPC
- レート制限
- verified write guard拡張
- Edge Function
- CORS、API key、本文上限
- 共有生成器によるactive set再生成
- 共有エンジンによるtrace再生
- サーバー計時検査
- 重複finish
- クライアント実接続
- ランキング再送
- Supabase security/performance advisor確認
- GitHub Pages workflow
- BUILD表示
- `SUPABASE_CONTRACT.md`
- `RELEASE_CHECKLIST.md`

### Supabase適用条件

- schemaとEdge Functionは適用してよい。
- `public.games.is_active = false`を維持する。
- `accepting_runs = false`を維持する。
- 既存ゲームの関数と権限を壊していないことをSQLで確認する。

### 完了条件

- anonからprivateテーブルと内部RPCへアクセス不可
- Publishable keyだけで公開ランキング取得可能
- 正しいtraceだけfinish成功
- 改ざんtrace、時間、集合、版を拒否
- 同じfinish再送は同じ結果
- pending result再送成功
- Pages成果物のHTML、JS、CSS、faviconが200
- 320〜430pxの公開候補確認
- CIとdeployが重複して大量実行しない
- 受付停止状態でPRを提出

### 含めない

- 実験場トップへの表示
- 受付フラグの有効化

---

## PR6 — カメレオンJP実験場統合と公開

対象リポジトリ: `chameleonjp-lab/chameleonjp_lab`  
推奨ブランチ: `work/add-sekiban-kairo`

### 目的

新しいゲームを実験場トップと詳細ランキングへ追加し、公開後の導線を完成させる。

### 実装

- 現在のゲームカタログ構造を確認
- 固定配列がある場合はgame slug、タイトル、URL、説明、スコア設定を追加
- 一覧カード
- 「遊ぶ」リンク
- シェア文
- 詳細ランキング
- `get_sekiban_kairo_ranking_v1`用の専用取得分岐
- 現在の問題集合名の表示
- ランキング0件、1件、10件
- 合計タイムの小数3桁表示
- 操作回数の補助表示
- 未公開時はカードを出さない既存条件を維持
- 利用規約、コピーライト、既存導線を壊さない
- 実験場側の自動検査更新

### 公開手順

1. ゲーム側PR5がmainへマージ済み
2. ゲームPagesが正常
3. PR6をマージ
4. 実験場Pagesが正常
5. `public.games.is_active = true`
6. 一覧と詳細ランキングを確認
7. `accepting_runs = true`
8. iPhone 17 Pro Safariで実プレイ
9. 送信、順位、再送、シェア、実験場往復を確認

### 完了条件

- 実験場トップに一件だけ表示
- 遊ぶボタンが正しいURL
- 詳細ランキングが開く
- 0件でも壊れない
- 小数3桁が正しい
- 別問題集合の記録が混ざらない
- ゲーム側から実験場へ戻れる
- ホームと結果のシェア文が異なる
- iPhone実機確認記録がある

---

# 26. PR間の依存関係

```text
PR1 共有エンジン
 ↓
PR2 生成・探索
 ↓
PR3 UI・練習
 ↓
PR4 3問競技・trace
 ↓
PR5 サーバー検証・Pages
 ↓
PR6 実験場統合・公開
```

後続PRのために、未完成の空実装を大量に先置きしない。必要なインターフェースだけを前段で定義する。

各PRは前PRのmainマージ後に作成する。並行PRで同じファイルを大きく変更しない。

---

# 27. 各PRの報告書式

ChatGPT Workは各PR作成時に、次を必ず報告する。

## 1. このPRの目的

一文で書く。

## 2. 実装した内容

仕様項目とファイルを対応させる。

## 3. 実装していない内容

後続PRへ残したものを明記する。

## 4. 仕様との対応

- どの章を満たしたか
- 仕様変更があれば理由
- 仕様変更がなければ「変更なし」

## 5. 検査

- typecheck
- unit
- generator
- build
- WebKit
- Chromium
- 対象viewport
- Supabase権限
- 公開URL

成功、失敗、未実施を分ける。

## 6. 敵対的検証

意図的に壊した入力と結果を書く。

## 7. 残る危険

未確認点を隠さない。

## 8. iPhoneで利用者が確認する項目

3〜5点へ絞る。

## 9. PR URL

DraftかReadyかも書く。

## 10. マージ

ChatGPT Workはマージしていないことを明記する。

---

# 28. 敵対的検証シナリオ

公開候補で最低限、次を実施する。

## 28.1 盤面

- 100回高速連打
- 選択環を連続変更しながら回転
- 発信切替を連打
- 回転アニメーション途中の追加入力
- reset確認の開閉連打
- 解答とresetが同時刻に近い操作
- 最後の受信石へ複数光が同時到達

## 28.2 ブラウザ

- 競技中にホーム画面へ戻す
- Safariをバックグラウンドへ送る
- 画面をロックする
- 縦横回転
- ページ再読み込み
- 戻る、進む
- 文字サイズ拡大
- 低電力モード

## 28.3 通信

- prepare直後に切断
- begin応答直前に切断
- 第3問解答直後に切断
- finish成功応答だけ失う
- 同じfinishを10回送る
- 古いクライアント版
- active set切替直後の旧run
- 24時間経過後の再送

## 28.4 改ざん

- totalTimeだけ短くする
- stageTimesだけ変える
- actionCountを減らす
- traceから操作を抜く
- trace時刻を逆順にする
- 問題番号を飛ばす
- 別集合のcontentHashを送る
- truncatedをfalseへ書き換え、eventsを欠損させる
- 解答前にfinishする

## 28.5 Supabase

- anonでprivate table select
- anonでinternal RPC
- generic submit_score
- 不正originからEdge呼出
- 大きすぎる本文
- rate limit超過
- 受付停止中のprepare
- `games.is_active=false`のfinish

---

# 29. iPhone実機最終確認

主対象はiPhone 17 Pro Safariとする。加えて自動検査で小画面を補う。

利用者が確認する順序:

1. 新規状態で名前入力から練習2問を完了
2. ホームへ戻り、3問競技を開始
3. 第1〜第3問を操作し、結果へ進む
4. ランキング送信と上位10件を確認
5. 同じ3問へ再挑戦
6. 結果シェア
7. 実験場へ戻る
8. 競技途中でSafariを一度バックグラウンドへ送り、時間が止まらないことを確認
9. 第3問直後に通信を切り、結果を保持して再送できることを確認
10. 縦横回転、文字拡大、音OFF、振動OFF、動きを減らすを確認

確認記録には、公開URL、BUILD、RULE、SET、確認日を残す。

---

# 30. 完成条件

次をすべて満たした時だけ完成とする。

## 30.1 ルール

- 16方向
- 3環、4環
- 発信停止中の石も遮断
- 光同士は交差可能
- 必須受信石の網羅で成功
- 余分な光を許可
- 全判定が共有エンジン由来

## 30.2 問題

- 練習90問以上
- 正式候補6集合以上
- 全問が自動探索で解答可能
- 難度範囲内
- 切替必須条件を検査
- 重複、対称、過密を除外
- 生成版とハッシュを保存

## 30.3 競技

- 全員が同じ3問
- 3秒カウントダウン
- 500ms×2を合計から除外
- 正式中は時間停止なし
- 操作記録をサーバー再生
- 集合が違う記録を分離
- タイム、操作数、送信時刻で順位

## 30.4 画面

- 石板デザイン
- スマートフォンゲーム画面は必要情報だけ
- 320×568から430×932で横スクロールなし
- 主要操作44px以上
- 色以外でも状態が分かる
- 長押し、二本指、ズーム誤操作で破綻しない
- 外部画像、音、フォント不要

## 30.5 保存と通信

- 名前保存
- 練習完了保存
- 進行中run復元
- 第3問直後に結果を先保存
- finish重複安全
- pending result再送
- pending abandon再送
- 壊れた保存値で白画面にならない

## 30.6 サーバー

- private table非公開
- 内部RPC非公開
- Publishable keyのみブラウザ使用
- service key非公開
- 改ざんtrace拒否
- レート制限
- 受付停止スイッチ
- security advisor確認
- 既存ゲームへ回帰なし

## 30.7 公開

- ゲームPages正常
- 実験場トップ正常
- 詳細ランキング正常
- ランキング0件でも正常
- シェアURL正常
- BUILD照合可能
- iPhone 17 Pro Safari確認済み
- `accepting_runs=true`は最終確認後だけ

---

# 31. 仕様変更の扱い

次の変更は軽微修正ではない。計画書と版を先に更新する。

- 方向数を16以外へ変える
- 発信停止中の遮断扱いを変える
- 成功条件を完全一致へ変える
- 回転を連続角度へ変える
- 正式競技を参加者別ランダムへ変える
- 問題間時間の扱いを変える
- 順位条件を変える
- 生成器の乱数を変える
- サーバー再生をやめる
- 既存問題配置を変更する

見た目の色、石板の亀裂、短い音量調整は、ルール版を上げずに変更してよい。ただし視認性検査を再実行する。

---

# 32. 実装開始前の最終確認

ChatGPT WorkはPR1の作業前に、次だけを確認する。

- [ ] 仮称「石板回路」をそのまま使うか
- [ ] `sekiban_kairo`がGitHubとSupabaseで未使用か
- [ ] 新規リポジトリを作る権限があるか
- [ ] GitHub Pagesを使うか
- [ ] SupabaseプロジェクトがカメレオンJP既存プロジェクトか
- [ ] `main`へ直接pushしない設定か

利用者から名称変更の指示がなければ、仮称で進める。名称以外の仕様について、同じ質問を繰り返して作業を止めない。

---

# 33. 設計判断の要約

この計画では、「ランダム出題」と「公平なタイム順位」を両立させるため、正式競技と練習を分けた。

- 練習は、事前に量産・検査した問題から毎回ランダムに選ぶ。
- 正式競技は、管理側で選ばれた同じ3問を全員へ出す。
- 問題集合が変わった記録は混ぜない。

見た目は石板に統一するが、生成画像のように説明欄を大量に並べない。スマートフォンの競技画面では、盤面と操作を優先する。

問題生成は正解状態から逆に作り、幅優先探索で最短解を確認する。これにより、解けない問題、簡単すぎる問題、発信切替が不要な問題を公開前に除外できる。

正式ランキングは、ブラウザが送るタイムだけを信用せず、サーバーが同じ3問と操作記録を再生して計算し直す。これにより、ルール上成立しない記録や単純な値の書き換えを拒否する。

---

以上を、石板回路（仮称）の初回公開版に対する実装正本とする。
