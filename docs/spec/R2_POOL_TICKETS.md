# R2 問題庫と抽選券の仕様

この仕様は R2 の採用問題 90 問と抽選券 900 組の保存形式、校正、再現性検査を定める。生成元は `src/puzzles/config.ts` で、数値条件は候補の実測後に変更しない。

## 公開成果物

`content/puzzles-v2.json` は既存の `Puzzle[]` 形式をそのまま使い、初級・中級・上級を各30問含む。問題の解法、候補の却下理由、探索結果は `reports/r2/` に保存する。

`content/pool-v2.json` は問題IDの選択用マニフェストである。版、ルールセット、生成器、問題数、問題コレクションのチェックサム、難度別ID、抽選プロファイル、問題庫チェックサムを含む。抽選プロファイルは次の順序と回数を固定する。

| 項目 | 値 |
| --- | ---: |
| 1組の順序 | `easy, easy, normal, normal, hard` |
| 組数 | 900 |
| 初級の各問題 | 60回 |
| 中級の各問題 | 60回 |
| 上級の各問題 | 30回 |

`content/tickets-v2.json` は上記の問題IDを5個ずつ持つ。1組内のIDはすべて異なり、同難度内の順序を正規化した組も900組で重複してはならない。券には問題本文や解法を含めない。

## チェックサムと版

コレクションとマニフェストのチェックサムは、キーを辞書順に並べた安定JSONを FNV-1a 64bit でハッシュする。問題コレクションは問題配列、問題庫は `poolChecksum` を除く問題庫、券は `ticketChecksum` を除く券マニフェストに対して計算する。個別問題の `contentChecksum` は[v2形式の契約](ROTATION_ONLY_V2_FORMAT.md)に従う。版、ルールセット、生成器、各チェックサムのどれかが一致しない成果物は受け付けない。

問題のID変更、旧版の混在、未知のトップレベルまたは入れ子フィールド、難度別IDの変更を検査で拒否する。検査は壊れたファイルを再生成して成功扱いにせず、現在のファイルを読み取り専用で判定する。

## 校正と券生成

採用90問の `calibrationScore` から、券生成前に以下の4基準を計算し、`reports/r2/ticket-calibration.json` に保存する。

* 初級ペア: 初級平均の2倍
* 中級ペア: 中級平均の2倍
* 上級単体: 上級平均
* 5問合計: 初級平均の2倍 + 中級平均の2倍 + 上級平均

各範囲は保存した基準の ±10% で、券生成後の最小値・最大値から逆算しない。既存の校正ファイルが現在の問題と再計算値に一致しない場合、`tickets:create` と `tickets:validate` は失敗する。

初級・中級は固定範囲に収まる辺から30回の完全マッチングを作り、各問題をペア内で60回登場させる。各回で未使用の有向辺を優先するため、同じ固定ペアだけで回数を合わせない。上級は各IDを30回用いる。組み合わせ後に、券の一意性、5問の難度順、各IDの回数、4つの校正範囲をすべて検査する。

## 乱数と抽選検査

券の生成と抽選は固定seedの32bit XorShift源を使う。乱数整数を添字へ変換する際は、`2^32` が添字数で割り切れない末尾を棄却してから剰余を取る。`selection:simulate` は固定seedで10万回抽選し、900券の選択頻度と問題の期待出現数を二項分布の5標準偏差以内で検査する。結果、seed、基準、実測値、乱数方式は `reports/r2/selection-simulation.json` に保存する。

## コマンド

```text
npm run puzzles:generate
npm run pool:create
npm run tickets:create
npm run puzzles:validate
npm run pool:validate
npm run tickets:validate
npm run selection:simulate
npm run puzzles:test
npm run puzzles:report
```

`puzzles:generate` と `pool:create`、`tickets:create` は生成専用で、検査コマンドは既存成果物を上書きしない。`puzzles:test` は版付き設定、代表解、保存済み解析、独立状態照合、再生成一致、校正、券、固定seed抽選をまとめて検査する。

HTML の検査レポートは `reports/r2/report.html` に出力し、採用90問の正確なSVG盤面、候補の却下理由、旧90問の移行、近似問題の画像付き採否、900組の構成と分布、事前校正値、未試遊状態を表示する。ブラウザや iPhone 実機での表示確認は自動検査とは別に記録する。
