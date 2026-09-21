# GitHub Pages の公開手順（R6で実行）

R5では公開物を作るための構成と手順だけを整えます。Pagesを有効化するWorkflowは置かず、mainへのマージやCI成功だけで公開されない状態を維持します。正式名、公開URL、共有画像、実機受入、ユーザーの公開指示がそろった後に、別段階R6として実行します。

## 公開物の作成

Nodeとnpmの版を `.nvmrc` / `package.json` に合わせ、main上の受入済みコミットをチェックアウトします。

```sh
npm ci
PAGES_BUILD=1 npm run build
```

`PAGES_BUILD=1` のときだけViteのbaseを `/sekibanmawashi/` にし、`dist/` をPagesへ渡せる構成にします。ローカル開発と通常CIは `/` のままです。ビルド後に、`dist/index.html` のbase付きJavaScript・favicon参照、`dist/assets/` の存在、問題JSONの同梱を確認します。公開対象へコミットIDを記録する方法は、R6で公開先の方式を確認してから決めます。

## GitHub側の操作

1. GitHubで対象リポジトリの **Settings → Pages** を開きます。
2. **Source** を **GitHub Actions** または承認済みの手動公開方式へ設定します。R5では設定を変更しません。
3. 公開承認後のR6で、受入済みコミットの `dist/` だけを選び、同じコミットの二重公開をしないよう記録します。
4. 実URLでトップ、開始、5問結果、再読込、JavaScript・favicon、共有文、実験場との往復を確認し、URL・コミットID・戻し方をR6記録へ残します。

公開前に正式名が変わった場合は、`src/core/constants.ts`、`index.html`、共有文、説明文を同じ変更で更新します。共有画像は承認済みの素材が確定するまで設定せず、旧試作の画像をコピーしません。

## 戻し方

公開物に不具合があれば、Pages側で直前に受入確認したコミットの成果物へ戻し、実URLで再確認します。mainへ強制push、履歴書換え、保護設定の緩和は行いません。ランキング・Supabase・実験場の本番データ変更はこの手順へ含めません。
