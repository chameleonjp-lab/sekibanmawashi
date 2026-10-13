# sekibanmawashi

石板の3本の輪を回して、外側の目標すべてに光を届けるブラウザー向けパズルです。カメレオンJPの実験場のゲームです。

**最新の計画は文書版2.1と2026-10-12の追加指定です。石板と光のthree.js描画・生成した石素材はPR #23/#24でmainへマージ済みです。公開中の版とmainは異なります。最新の後続作業・検査・未確認は[後続対応の記録](docs/reviews/FOLLOWUP_2026-10-13.md)と[現在の状態](CURRENT_STATE.md)を確認してください。**

## 現在の状態

`src/`と`content/`が正式版です。通常のURLでは名前入力のホームが開き、チャレンジまたは練習で5問を解けます。記録は端末内で扱い、保存に失敗しても結果と共有を利用できます。光は常時発光し、操作は輪の選択と左右の回転です。

2026-10-13の後続開始時のmainは `2ca735347b3831beb6cc0d2215570d608105ec53` です。[PR #24](https://github.com/chameleonjp-lab/sekibanmawashi/pull/24)の[CI 38321401729](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/38321401729)はChromium/WebKit各68件、計136件すべて初回成功で、静的検査と必須verifyも成功しました。mainの別CIの実結果は後続記録とChecksに分けて残します。

公開URLは https://chameleonjp-lab.github.io/sekibanmawashi/ です。2026-10-13に公開ページの`version.json`を取得し、公開中のSHAが `2deac6db6bfe3a33f18012eef64cabd4e9e4a096`（10月3日の公開）であることを確認しました。three.jsによる改善は未公開です。iPhone実機受入も未完了で、過去のR6公開に限った免除を今回へ拡張しません。

`prototype/`は旧規則の比較用です。ランキング連携は今回の対象外です。過去の各段階の検査結果は進捗表と各検査記録に保持します。本番公開は受入条件とユーザーの公開指示を確認して別に行います。

## 検査

Nodeの版は `.nvmrc` に固定しています。リポジトリ直下で次を実行します。

```sh
npm ci
npm run typecheck
npm run lint
npm run licenses:check
npm test
npm run puzzles:test
npm run build
npm run performance:r5
npm run test:e2e:install
npm run test:e2e
```

`puzzles:test`は保存された90問・900組、独立計算、再生成の一致、10万回の抽選を検査します。生成と検証のコマンドは分け、検証で壊れた公開データを上書きしません。`test:e2e`はR3の盤面検査、R4の5問アプリ検査、R5の公開readiness・音・復旧・20回連続検査をChromium/WebKitで実行します。初回は対応ブラウザと実行に必要なライブラリの導入が必要です。iPhone実機確認とは区別します。GitHubの自動検査から本番公開は行いません。

実装範囲は[R3盤面と入力](docs/spec/R3_BOARD_INPUT.md)、[R4進行・時計・保存](docs/spec/R4_RUN_TIMER_STORAGE.md)、[R5公開品質検査](docs/reviews/R5_VERIFICATION.md)を参照してください。ローカルでは `npm run dev` でホームを開けます。`?puzzleId=採用済みの問題ID` は引き続き1問の盤面確認用です。不明なIDは読込エラーとし、別問題へ差し替えません。この確認用指定はチャレンジ抽選や記録には使いません。

問題・問題庫・券を作り直す手順と形式は[R2問題生成](docs/spec/R2_PUZZLE_GENERATION.md)、[R2問題庫・抽選券](docs/spec/R2_POOL_TICKETS.md)を参照してください。[検査レポート](reports/r2/report.html)に90問の盤面と採否・統計をまとめ、[R2検査記録](docs/reviews/R2_VERIFICATION.md)に実行結果と未確認を記録します。

## 最初に読む資料

- [現在の状態](CURRENT_STATE.md)で決定事項と未実装を確認します。
- [現在のゲーム仕様](docs/spec/CURRENT_GAME_SPEC.md)で何を作るかを確認します。
- [対応実装計画書 文書版2.1](docs/planning/IMPLEMENTATION_PLAN.md)で各指摘の対応と必須検査を確認します。
- [進捗表](docs/planning/IMPLEMENTATION_PROGRESS.md)と[資料一覧](docs/INDEX.md)で次の段階と参考資料を確認します。

## 変更後に固定する内容

12方向・3本の環で、選択と左右の回転だけを操作します。選択は0手、回転は1手です。初級30問・中級30問・上級30問から、初級2問・中級2問・上級1問を出し、5問の実プレイ時間を合計します。日替わりにはしません。

発光紋と遮断石による遮断、光どうしは遮らないこと、余分な光を許可することは維持します。既存90問は新規則で再検査し、条件外の問題だけを調整・差し替えます。

[旧計画v1.2](docs/archive/v1.2/IMPLEMENTATION_PLAN.md)は履歴です。旧6段階や発光切替の条件を現行実装へ混ぜません。正式名と共有画像は設定済みです。実験場への掲載方式や未決定値を推測して変更しません。
