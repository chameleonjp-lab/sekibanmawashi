# 権利・ライセンス記録

盤面の主表示は `src/three-board.ts` の独自形状とthree.jsです。`src/board.ts` のSVGを操作・読み上げと描画不可時の代替に使います。2026-10-12のユーザー指定に基づき、ChatGPTで新しく生成した石の写真風テクスチャ `public/textures/stone-slate-v1.webp` を採用します。既存作品や旧試作の画像を石素材へ流用しません。素材の生成条件と出典は [石テクスチャ記録](assets/STONE_TEXTURE_MANIFEST.md) に残します。音は `src/sound.ts` のWeb Audio合成です。`public/favicon.svg` は旧試作に含まれていた単純な図形だけのSVGを内容確認のうえ同一ファイルとして採用したものです（元ファイルのblob `5f1d6422a683e86ac4f55ffffc362158eb7a5602`）。旧試作のOG画像は正式版へコピーしていません。

実行時のthree.jsはnpmから版を固定してローカルビルドへ含め、CDNから読み込みません。MITの著作権・許諾全文を `public/third-party/three-LICENSE.txt` に置き、Viteの公開成果物へ同梱します。依存のライセンスは次のとおりです（バージョンは `package.json` / `package-lock.json` と一致させます）。

| パッケージ | 版 | SPDX | 用途 | 権利情報 |
|---|---:|---|---|---|
| `three` | 0.180.0 | MIT | 実行時のWebGL盤面 | [r180 license](https://github.com/mrdoob/three.js/blob/r180/LICENSE) / [配布する全文](../public/third-party/three-LICENSE.txt) |
| `@types/three` | 0.180.0 | MIT | 開発用three.js型定義 | [DefinitelyTyped license](https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/LICENSE) |
| `vite` | 7.3.6 | MIT | 開発サーバー・ビルド | [Vite license](https://github.com/vitejs/vite/blob/main/LICENSE.md) |
| `source-map-js` | 1.2.2 | BSD-3-Clause | 開発用Vite→PostCSS経由のソースマップ処理。ゲームからimportしない | [v1.2.2 license](https://github.com/7rulnik/source-map-js/blob/v1.2.2/LICENSE) |
| `typescript` | 5.9.2 | Apache-2.0 | 型検査 | [TypeScript license](https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt) |
| `@playwright/test` | 1.63.0 | Apache-2.0 | Chromium/WebKit検査 | [Playwright license](https://github.com/microsoft/playwright/blob/main/LICENSE) |
| `@types/node` | 24.8.0 | MIT | Node型定義 | [DefinitelyTyped license](https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/LICENSE) |

`@types/three` が参照する開発用依存は、`@dimforge/rapier3d-compat` 0.12.0（Apache-2.0）、`@tweenjs/tween.js` 23.1.3、`@types/stats.js` 0.17.4、`@types/webxr` 0.5.24、`fflate` 0.8.3、`meshoptimizer` 0.22.0（以上MIT）、`@webgpu/types` 0.1.74（BSD-3-Clause）です。これらの型参照先の実行コードはゲームからimportしません。

2026-10-13、既存の開発用推移依存`source-map-js`だけを1.2.1→1.2.2へ更新しました。PostCSSの既存`^1.2.1`範囲内で、ライセンスはBSD-3-Clauseのままです。導入済みLICENSE全文と権利表示は更新前後で同一、SHA-256は`6cb0631f71c7749763fd3dd1d5bee52dd1070ec17f2edc1710079ad070bd2fbd`です。実行時threeの版と配布するMIT全文は変更していません。

実行時の依存と石素材は同じサイトの成果物として配信し、利用者の端末へ個別の外部サービスを接続しません。依存を追加または更新するときは、版、SPDX識別子、用途、上流の権利情報をこの表へ追記し、配信コードに必要な権利表示が成果物へ含まれることを確認します。
