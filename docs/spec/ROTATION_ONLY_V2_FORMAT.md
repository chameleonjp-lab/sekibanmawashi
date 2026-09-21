# 回転専用 v2 問題形式

R1の正式版が読み込む公開問題は、`schemaVersion=2`、`rulesetVersion=stone-rings-v2`、`generatorVersion=generator-v2` の組合せで識別します。旧版の発光状態、切替操作、最短解の検査値は公開問題へ含めません。探索結果や採用理由は、問題データと別の検査成果物に置きます。

## 問題オブジェクト

```json
{
  "schemaVersion": 2,
  "rulesetVersion": "stone-rings-v2",
  "generatorVersion": "generator-v2",
  "id": "rotation-only-example",
  "difficulty": "easy",
  "slotCount": 12,
  "rings": [
    { "id": "inner", "parts": [{ "kind": "emitter", "slot": 0 }] },
    { "id": "middle", "parts": [{ "kind": "blocker", "slot": 3 }] },
    { "id": "outer", "parts": [] }
  ],
  "targets": [6],
  "initialState": { "rotations": [0, 0, 0] },
  "contentChecksum": "0123456789abcdef"
}
```

実データの `contentChecksum` は例示値ではなく、下記の正規化文字列を入力にした FNV-1a 64の小文字16進数です。チェックサムの対象から `contentChecksum` 自身を除き、キー順と配列順を固定します。

```text
{"schemaVersion":2,"rulesetVersion":"stone-rings-v2","generatorVersion":"generator-v2","id":"...","difficulty":"easy","slotCount":12,"rings":[...],"targets":[...],"initialState":{"rotations":[...]}}
```

`rings` は `inner`、`middle`、`outer` の3要素をこの順で持ちます。各環の部品は最大4個で、同じ環の同じ区画を重ねません。部品の種類は `emitter` または `blocker`、区画は整数0〜11です。盤面に発光紋を1個以上置き、必須受光紋を発光紋数以下で1個以上置きます。受光紋の重複、浮動小数点、`NaN`、範囲外の区画、未知のキーは拒否します。

## 判定と状態

論理状態は `[innerRotation, middleRotation, outerRotation]` の3整数だけです。状態数は `12^3 = 1,728` で、符号化は内環を最上位として `((inner * 12) + middle) * 12 + outer` とします。`decode(encode(state))` は同じ状態を返し、操作は左右回転の6種類です。

各発光紋は常に光を出します。光は発射元の区画から中心へ進み、最初の占有部品で止まります。中心を越えた後は反対側の同じ区画を外へ進み、最初の占有部品で止まるか、外周へ到達します。発射元自身は反対側の区画にはないため、特別な停止除外を行いません。光どうしは互いを停止させません。点灯区画はビット集合で保持するため、同じ受光紋へ複数の光路が到達しても点灯数は一度だけです。

判定結果には各光路の発射元、反対側の区画、中心側・外側の通過環、最初の遮断位置、外周到達を含めます。表示側はこの結果を描画に使い、遮断規則を再計算しません。

## 操作履歴

操作履歴の1要素は次の6項目です。

```json
{
  "puzzleId": "rotation-only-example",
  "rulesetVersion": "stone-rings-v2",
  "n": 1,
  "t": 42,
  "type": "r",
  "ring": 0
}
```

`n` は1から始まる連番、`t` は問題開始からの整数ミリ秒、`type` は `l` または `r`、`ring` は0〜2です。時刻は単調非減少で、同じ時刻の連続入力は許可します。入力を受け付けた処理で状態、手数、履歴、成功を一緒に確定します。最初の成功後の履歴要素は拒否し、完走履歴へ追加しません。履歴が不正でも問題を別の問題へ差し替えたり、時計を開始したりしません。

音の設定はアプリの設定として残りますが、問題形式や判定状態には含めません。
