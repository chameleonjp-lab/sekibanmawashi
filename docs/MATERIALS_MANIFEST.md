# 保存資料の一覧

SHA-256は、格納したファイルが途中で欠けていないか確認するための値です。現在の案内文書は更新のたびに変わるため、会話中に作成された原資料と最新計画だけを対象にしています。

| ファイル | 容量 | SHA-256 | 扱い |
|---|---:|---|---|
| `archive/v1.0/IMPLEMENTATION_PLAN.md` | 85,906 bytes | `b2812a24862216e83d154760bbf7b808607d153e3bf3a2abd59ff5aebb797c14` | 旧3問計画 |
| `archive/v1.1/IMPLEMENTATION_PLAN.md` | 80,555 bytes | `bf8a8a4ef656408ad3fc810c782b23a285553611557c15bdc5989723b0d7a1bf` | 5問方式へ変更した直前版 |
| `archive/v1.1/CHANGELOG.md` | 555 bytes | `91f7a4c9c72917e78e2d5966902da26cc1b2137ccc07a921e7398393a9ac52aa` | v1.1作成時の変更記録 |
| `archive/v1.1/PACKAGE_README.md` | 1,479 bytes | `e077f5062c15ab749ae14b08ee94d4ce1dd1afa161a8677a8f7b5a1d2805a5ab` | 会話で渡した計画書一式の案内 |
| `planning/IMPLEMENTATION_PLAN.md` | 81,948 bytes | `eb867c574699b3821915d92fec836aa21e6736b8a51e2ab554047d518308c830` | 現在の文書版1.2 |
| `research/original-logic-research.md` | 36,115 bytes | `f3ef868c1a40708f8287fe2ba7ed11af30d096a505684c9bb62f0c9d62ee7cd7` | 元ロジックの調査 |
| `examples/problem-pool.example.json` | 2,999 bytes | `083d7c618a161c74ee4a210e4f7e935a5df5027fda143dfb28fbaf22ccb3f72c` | 問題庫の形式例 |
| `examples/puzzle-definition.example.json` | 1,141 bytes | `4336970566ab7b34e8736544e425f8bb24876a2d0a6375d8fff70db64c05a48e` | 1問の形式例 |
| `design/01-initial-four-concepts.png` | 2,481,151 bytes | `376a0fb809df40bb4e51d35884d23fc743a568ab58c6b6cad37ea9cb2447c0cd` | 最初の4画面案 |
| `design/02-simplified-six-concepts.png` | 2,054,642 bytes | `4dedec8483916bbf6d4bd27f05a30bea845c57922a447b0b2c2bb013bc431ea8` | 簡略化した6案 |
| `design/03-material-four-concepts.png` | 2,682,323 bytes | `899411d9c154fb65a1396070f62680b64f77ec0de6aaa6e0f7f8380ca0f14e93` | 石板・電子回路・オーパーツ・金属の4案 |
| `design/04-latest-stone-tablet-reference.png` | 3,227,706 bytes | `210e612b4ff6537e8f9724438f01519531817518460e0558b0b932287014bc58` | 採用した石板の方向 |

4枚のPNGはすべて実体のある画像です。`04-latest-stone-tablet-reference.png`は1536×1024ピクセルです。画像は方向性の参考であり、本番ゲームへ画像素材として組み込みません。

## 試作で追加した資料（2026-09-21）

パスはリポジトリルートからです。画面記録とシェア画像は確認用で、本番ゲームへ貼り付けません。

| ファイル | 容量 | SHA-256 | 扱い |
|---|---:|---|---|
| `prototype/public/favicon.svg` | 741 bytes | `6f7d4186a692319221332594d65fc2b760bac1487a90ca302082add6434bacb9` | 試作アイコン |
| `prototype/public/og.jpg` | 168,261 bytes | `0cac891a39bc4dd5307380e820bb31bedf7e26d1e8f007bfed6108ad4937a5df` | 試作シェアカード |
| `prototype/public/x-banner.jpg` | 45,178 bytes | `b6eaff6d7e84fc07940afdabf18bfe818482401f97e3cf6d65b8b88ecd28702f` | 試作Xバナー |
| `prototype/public/site.json` | 91 bytes | `51c2d8aa13301c4481c68cd081fa701d1195f5a97b12adf08723bfb7d16c8abb` | カード用メタデータ |
| `prototype/sql/leaderboard.preview.sql` | 953 bytes | `1ad8b889f3852899e463b8ff39622e2a9f3d96993d14476b88d89b65dde04d79` | プレビュー用順位表 |
| `docs/prototype/screenshots/howto.png` | 118,994 bytes | `612c5c1978cc0e7591139f860b175374c5da9e5589a362cfd3481f35a2759ce6` | 遊び方の画面記録 |
| `docs/prototype/screenshots/countdown.png` | 188,152 bytes | `d1b68b892b8665b141da8b4d922acecc86099723b236f30c61242621472c5766` | カウントダウン |
| `docs/prototype/screenshots/play-1.png` | 205,542 bytes | `06a6d43e3a0532ae5da4fa15a4d857cf994e92c645eecc5065da9156d8853575` | 練習プレイ |
| `docs/prototype/screenshots/play-2.png` | 207,057 bytes | `647449105e1231348b6180a91f9874f2e8f9d4f20363bce0d46260278fbb345d` | 練習プレイ（回転後） |
| `docs/prototype/screenshots/challenge-play.png` | 203,068 bytes | `a066bed478c3646a01da8943528b30a22538225cea1ac067a2ddd9766d30096b` | 5問チャレンジ |

