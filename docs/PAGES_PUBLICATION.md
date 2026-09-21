# GitHub Pages の公開手順（R6で実行）

R5では公開物を作るための構成と手順だけを整えます。Pagesを有効化するWorkflowは置かず、mainへのマージやCI成功だけで公開されない状態を維持します。正式名、公開URL、共有画像、実機受入、ユーザーの公開指示がそろった後に、別段階R6として実行します。

## 公開物の作成

Nodeとnpmの版を `.nvmrc` / `package.json` に合わせ、main上の受入済みコミットをチェックアウトします。

```sh
npm ci
PAGES_BUILD=1 npm run build
```

`PAGES_BUILD=1` のときだけViteのbaseを `/sekibanmawashi/` にし、`dist/` をPagesへ渡せる構成にします。ローカル開発と通常CIは `/` のままです。ビルド後に、`dist/index.html` のbase付きJavaScript・favicon参照、`dist/assets/` の存在、問題JSONの同梱を確認します。R6 Workflow例では、checkout後の実SHAを `dist/version.json` に記録してArtifactへ含めます。

## GitHub側の操作

R5ではPages設定もWorkflowファイルも変更しません。R6では、レビュー済みの手動dispatch Workflowを追加して、承認したコミットから成果物を作ってPages Artifactへ渡します。R6で追加するWorkflowの最小構成は次のとおりです（このファイルはR5へ追加しません）。

```yaml
name: Publish Pages
on:
  workflow_dispatch:
    inputs:
      source_ref:
        description: "公開承認済みのコミットSHAまたはタグ"
        required: true
        type: string
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ inputs.source_ref }}
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - name: Use the pinned npm version
        run: npm install --global npm@11.9.0
      - run: npm ci
      - run: PAGES_BUILD=1 npm run build
      - name: Record the checked out source revision
        env:
          SOURCE_REF: ${{ inputs.source_ref }}
        run: |
          SOURCE_SHA="$(git rev-parse HEAD)" node -e 'const fs = require("node:fs"); fs.writeFileSync("dist/version.json", JSON.stringify({ sourceRef: process.env.SOURCE_SHA, requestedRef: process.env.SOURCE_REF }) + "\n");'
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - id: deployment
        uses: actions/deploy-pages@v4
```

R6の公開承認後に **Settings → Pages → Source: GitHub Actions** を設定し、Actions画面の **Run workflow** で `source_ref` に受入済みコミットを指定します。WorkflowのCI、`dist/version.json` の実SHA、Artifactの内容、実URLのトップ、開始、5問結果、再読込、JavaScript・favicon、共有文、実験場との往復を確認し、URL・コミットID・Workflow runをR6記録へ残します。公開操作はこの手動dispatchを実行した時だけ起きます。

公開前に正式名が変わった場合は、`site.config.ts` の共通設定だけを変更元として、Vite HTML変換、画面見出し、共有文、説明文、OGメタデータへ反映されることをCIで確認します。共有画像は承認済みの素材が確定するまで `shareImageUrl: null` のままとし、旧試作のOG画像をコピーしません。

## 戻し方

公開物に不具合があれば、直前に受入確認したコミットSHAを `source_ref` に指定して同じ手動Workflowを再実行します。WorkflowがそのSHAを再ビルドし、実SHAを記録した新しいArtifactをdeployすることで前版へ戻し、実URLで確認します。mainへ強制push、履歴書換え、保護設定の緩和は行いません。ランキング・Supabase・実験場の本番データ変更はこの手順へ含めません。
