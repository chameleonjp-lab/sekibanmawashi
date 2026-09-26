# 権利・ライセンス記録

正式版の盤面は `src/board.ts` が作るSVG、音は `src/sound.ts` のWeb Audio合成です。画像生成サービス、外部画像、外部音源、旧試作のOG画像などの公開素材は正式版へ取り込みません。`public/favicon.svg` は例外として、旧試作に含まれていた単純な図形だけのSVGを内容確認のうえ同一ファイルとして採用したものです（元ファイルのblob `5f1d6422a683e86ac4f55ffffc362158eb7a5602`）。旧試作のOG画像は装飾と審査マーク風表示があり、正式版へコピーしていません。正式な共有カード画像は未確定のため、`index.html` に `og:image` を設定していません。R6で素材の出所とライセンスを確認してから追加します。

アプリの実行時依存はブラウザ標準APIとViteのビルド成果物です。開発・検査依存のライセンスは次のとおりです（バージョンは `package.json` / `package-lock.json` と一致させます）。

| パッケージ | 版 | SPDX | 用途 | 権利情報 |
|---|---:|---|---|---|
| `vite` | 7.3.6 | MIT | 開発サーバー・ビルド | [Vite license](https://github.com/vitejs/vite/blob/main/LICENSE.md) |
| `typescript` | 5.9.2 | Apache-2.0 | 型検査 | [TypeScript license](https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt) |
| `@playwright/test` | 1.63.0 | Apache-2.0 | Chromium/WebKit検査 | [Playwright license](https://github.com/microsoft/playwright/blob/main/LICENSE) |
| `@types/node` | 24.8.0 | MIT | Node型定義 | [DefinitelyTyped license](https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/LICENSE) |

上記パッケージは開発・検査用で、利用者の端末へ個別の外部サービスを接続しません。依存を追加または更新するときは、版、SPDX識別子、用途、上流の権利情報をこの表へ追記し、ビルド成果物へ第三者素材が混ざらないことを確認します。
