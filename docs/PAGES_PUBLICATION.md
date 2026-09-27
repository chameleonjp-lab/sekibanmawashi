# GitHub Pages の公開手順（R6）

ユーザーは2026-09-27に本番公開を明示的に許可し、PR #12をmainへマージしました。main `989784641d7cc04b6ae63c878b53e6acd1c39777` のpush CIは成功しました。PR #12のmergeだけではdispatchされず、**本番deploy済みではありません**。この後続PRで正式名「セキバンマワシ」と共有画像を設定しました。今後の本番deployは、画像・名称を含む変更がmainへマージされ、事前ゲートが全て完了するか未達ゲートごとの明示waiverが記録され、mainとCIを再確認した後に行います。Pages Settingsはこの作業では変更しません。

Q05（iPhone 17 Proの物理Safari/VoiceOver等）は未実施です。R6の後続変更で正式名「セキバンマワシ」と実プレイ画面を使った共有画像を設定しました。公開先URLは `https://chameleonjp-lab.github.io/sekibanmawashi/` です。Q05の未実施を自動検査結果で置き換えません。

画像の出所・構成と検査結果は[公開名・共有画像の追補検証](reviews/R6_PUBLICATION_ASSETS.md)に記録します。

## Workflowの安全境界

`.github/workflows/publish-pages.yml` は `workflow_dispatch` だけで起動します。PR、push、scheduleからdeployするtriggerはありません。build/deploy両jobが `refs/heads/main` を条件にし、dispatch元がmain以外ならdeployしません。`source_sha` は小文字16進数40桁のcommit SHAだけを受理します。

build jobは、入力SHAが現在の `origin/main` の祖先であること、`.github/workflows/ci.yml` の `push` runが同じSHA・`main` で完了成功し、`verify` jobも成功していることをGitHub Actions API（`actions:read`）で確認してからcheckout/buildします。タグ、ブランチ名、PR専用run、別SHAのCI結果では代用できません。公開後検査scriptはdispatch workflow revisionから先にrunner tempへ保存し、後からrequested sourceをcheckoutします。これによりR6導入前の受入済みsource SHAも、同じ検査scriptでbuild・rollback可能です。`PAGES_BUILD=1 npm run build` の後、そのscriptがbase付きHTML資産と静的metadataを検査し、`dist/version.json` に次を記録します。

```json
{"sourceSha":"<checkoutした完全SHA>","requestedSha":"<workflow inputの完全SHA>"}
```

buildとdeployは別jobです。buildは `contents:read` / `actions:read`、deployは `pages:write` / `id-token:write` / `actions:read` だけを持ちます。deploy jobは `github-pages` environmentを使い、同時deployは直列化して実行中のdeployをcancelしません。Pages artifactと公開後smoke verifierは別artifactです。公開後検査用のsource checkoutに必要な `contents:read` をdeploy jobへ追加しないため、verifierと設定値だけを短期artifactとして渡します。

使うActionsはimmutable commit SHAにpinしています（括弧内は確認したrelease tag）。GitHub公式の[Pages custom workflow案内](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)に従い、deploy jobの `github-pages` environmentと `pages:write` / `id-token:write` を使います。`deploy-pages@v5` のAPI要件に従い `actions:read` もdeploy jobに限って付与します。

- [`actions/checkout` v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1)
- [`actions/setup-node` v6.4.0](https://github.com/actions/setup-node/releases/tag/v6.4.0)
- [`actions/upload-pages-artifact` v5.0.0](https://github.com/actions/upload-pages-artifact/releases/tag/v5.0.0)
- [`actions/deploy-pages` v5.0.1](https://github.com/actions/deploy-pages/releases/tag/v5.0.1)
- [`actions/upload-artifact` v7.0.1](https://github.com/actions/upload-artifact/releases/tag/v7.0.1)
- [`actions/download-artifact` v8.0.1](https://github.com/actions/download-artifact/releases/tag/v8.0.1)

## CIとartifact検査

既存のCI `verify` jobは通常build・全E2E検査に加え、Pages baseで別buildを行い、`PAGES_REQUESTED_SHA=${{ github.sha }} npm run pages:artifact:check` 相当のartifact検査を実行します。これによりPR CIでPages用のbase・title/lang/description/OG/Twitter設定・共有PNGのURL/MIME/寸法・JavaScript/CSS/faviconの生成・ローカルファイル対応・version SHA記録をdeploy前に検査します。通常のdev/CI buildは引き続き `/` baseを使い、Pages baseはこの専用buildだけです。

## 公開後HTTP smoke

deploy-pagesが完了した後、`scripts/check-pages.mjs published` が `site.config.ts` の `publicUrl` をHTTPSで検査します。各HTTP項目は最大4回（0秒、1秒、2秒、4秒待ち）試し、各requestは12秒でtimeoutします。次を実サイトから取得して確認します。

- トップページがHTTP 200でHTML MIMEを返す。`lang="ja"`、title、description、OG title/description/URLが設定値と一致し、OG imageは設定されていれば一致、`null`なら不在。
- `version.json` がHTTP 200 / JSON MIMEを返し、`sourceSha` と `requestedSha` の両方がdispatch SHAと一致。
- base付きhashed JavaScript、CSS、SVG faviconがそれぞれHTTP 200で、対応するJavaScript/CSS/SVG MIMEを返す。共有画像を設定している場合は共有URLがHTTP 200 / `image/png` を返し、PNGヘッダーの寸法が設定と一致する。
- deploy actionのURL出力が `site.config.ts` の公開URLと一致。

これは配信物のHTTP smokeのみで、ライブサイト上でのhome→challenge開始→入力をPlaywrightで操作する検査ではありません。Playwrightの導入・browser取得を本番deploy後に追加して不安定要因を増やさず、既存CIのChromium/WebKit画面検査は通常のローカルpreviewに対して実行します。HTTP smoke成功をQ05や実機受入へ読み替えません。

## R6での実行と戻し方

PR mergeだけではdispatchしません。dispatch前に、計画8.2の実機受入Q05、正式名・URL・共有画像、必須自動検査と独立レビューを完了します。共有画像と正式名は後続PRで設定します。Q05が未達のままなら、その項目についてユーザーの個別明示waiverが記録されている場合に限りdispatchします。2026-09-27の公開許可と「本番公開作業を実施」の指示は公開操作の許可ですが、Q05の個別waiverとは区別して記録します。

これらの事前ゲートが満たされた後、rootはmainの新headと `CI / verify` を再確認し、Actionsの **Publish Pages → Run workflow** でmainを選び、対象 `source_sha` に受入対象commitの完全SHAを渡します。Workflowはその時点のmain祖先・同一SHAの成功push CIを再確認してからbuild/deployします。deploy直後は自動HTTP smokeを確認し、その後にトップ、挑戦開始、5問結果、再読込、共有、実験場との往復を実URLで確認してR6を完了します。Pagesの `Source: GitHub Actions` 設定が必要なら、権限を持つ人がGitHub Settingsで設定します。この実装作業ではその設定を変更していません。

公開が失敗または問題があれば、同じ手動Workflowへ直前の確認済みSHAを指定して再deployし、HTTP smokeで戻ったcommitを確認します。rollback対象SHAはR6導入前でもよく、検査scriptはdispatch workflow側のrevisionから実行します。強制push、履歴書換え、branch protection変更、ランキング/Supabase/実験場の本番データ更新はこの手順に含みません。
