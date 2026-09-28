# GitHub Pages の公開手順（R6）

ユーザーは2026-09-27に本番公開を明示的に許可し、PR #12をmainへマージしました。main `989784641d7cc04b6ae63c878b53e6acd1c39777` のpush CIは成功しました。PR #12のmergeだけではdispatchされず、**本番deploy済みではありません**。[PR #13](https://github.com/chameleonjp-lab/sekibanmawashi/pull/13) で正式名「セキバンマワシ」と共有画像を設定し、2026-09-28 JST時点でmainへマージ済みです。公開候補SHAは `662d0fe79cce888094eb265a71c3f56cc60ff331` です。今後の本番deployは、このmain SHAのpush `CI / verify` 成功を確認し、事前ゲートが全て完了するか未達ゲートごとの明示waiverが記録された後に行います。Pages Settingsはこの作業では変更しません。

Q05（iPhone 17 Proの物理Safari/VoiceOver等）は未実施ですが、ユーザーが2026-09-28 JSTに「Q05は今回免除して本番公開して良い」と明示し、PR #14のConversationへ今回のR6公開に限る個別waiverとして記録しました。R6の後続変更で正式名「セキバンマワシ」と実プレイ画面を使った共有画像を設定しました。公開先URLは `https://chameleonjp-lab.github.io/sekibanmawashi/` です。Q05を実施済みとは扱いません。

画像の出所・構成と検査結果は[公開名・共有画像の追補検証](reviews/R6_PUBLICATION_ASSETS.md)に記録します。

## Workflowの安全境界

`.github/workflows/publish-pages.yml` は `workflow_dispatch` だけで起動します。PR、push、scheduleからdeployするtriggerはありません。build/deploy両jobが `refs/heads/main` を条件にし、dispatch元がmain以外ならdeployしません。通常公開では `source_sha` を空欄にし、workflowがdispatch時点の `origin/main` 完全SHAを確定します。ロールバックなど過去の受入済みmainを明示する場合だけ `source_sha` を指定し、その場合は小文字16進数40桁のcommit SHAだけを受理します。空白文字は除去します。

build jobは、空欄時に確定したcurrent mainまたは明示入力SHAが現在の `origin/main` の祖先であること、`.github/workflows/ci.yml` の `push` runが同じSHA・`main` で完了成功し、`verify` jobも成功していることをGitHub Actions API（`actions:read`）で確認してからcheckout/buildします。タグ、ブランチ名、PR専用run、別SHAのCI結果では代用できません。公開後検査scriptはdispatch workflow revisionから先にrunner tempへ保存し、後からrequested sourceをcheckoutします。これによりR6導入前の受入済みsource SHAも、同じ検査scriptでbuild・rollback可能です。`PAGES_BUILD=1 npm run build` の後、そのscriptがbase付きHTML資産と静的metadataを検査し、`dist/version.json` に次を記録します。

```json
{"sourceSha":"<checkoutした完全SHA>","requestedSha":"<検証後に確定した完全SHA>"}
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

PR mergeだけではdispatchしません。dispatch前に、計画8.2の実機受入Q05、正式名・URL・共有画像、必須自動検査と独立レビューを完了します。正式名と共有画像はPR #13でmainへ反映済みです。残る事前ゲートは、公開候補SHA `662d0fe79cce888094eb265a71c3f56cc60ff331` のmain push `CI / verify` 成功確認とQ05です。Q05が未達のままなら、その項目についてユーザーの個別明示waiverが記録されている場合に限りdispatchします。2026-09-27の公開許可と「本番公開作業を実施」の指示は公開操作の許可ですが、Q05の個別waiverとは区別して記録します。

これらの事前ゲートが満たされた後、rootはmainの新headと `CI / verify` を再確認し、Actionsの **Publish Pages → Run workflow** でmainを選びます。通常公開は `source_sha` を空欄のまま実行し、workflowがcurrent mainの完全SHAを確定します。ロールバック時だけ受入対象commitの完全40桁SHAを明示します。Workflowは確定したSHAがmain祖先であり、同一SHAの成功push CIがあることを再確認してからbuild/deployします。deploy直後は自動HTTP smokeを確認し、その後にトップ、挑戦開始、5問結果、再読込、共有、実験場との往復を実URLで確認してR6を完了します。Pagesの `Source: GitHub Actions` 設定が必要なら、権限を持つ人がGitHub Settingsで設定します。この実装作業ではその設定を変更していません。

公開が失敗または問題があれば、同じ手動Workflowへ直前の確認済みSHAを指定して再deployし、HTTP smokeで戻ったcommitを確認します。rollback対象SHAはR6導入前でもよく、検査scriptはdispatch workflow側のrevisionから実行します。強制push、履歴書換え、branch protection変更、ランキング/Supabase/実験場の本番データ更新はこの手順に含みません。


## 2026-09-28 初回dispatch失敗と対策

Publish Pages run `36363555233` は `source_sha` に `662d0fe79cce888094eb265a71c3f56cc60ff33`（39文字）が渡され、完全40桁SHA検査で意図どおり停止しました。正しいcommitは末尾に `1` を含む `662d0fe79cce888094eb265a71c3f56cc60ff331` です。build・deploy処理自体の失敗ではありません。

手入力事故を通常公開から除くため、通常公開ではSHA入力を不要にし、空欄ならworkflowがcurrent mainを採用するよう変更しました。明示SHAの厳密検査、main祖先検査、同一SHAのmain push CI成功検査は維持しています。


## 2026-09-28 Publish Pages #2 の404とPages有効化前検査

Publish Pages run `36392473240` では、source SHA確定、main祖先検査、同一SHAのCI成功確認、依存導入、Pages build、artifact静的検査、`github-pages` artifact uploadまで成功しました。deploy jobの `actions/deploy-pages` がPages deployment作成APIでHTTP 404となり、公開後smokeへ進めませんでした。

同時点のGitHub repository APIは `has_pages: false` を返しており、Pagesサイト自体が未有効です。したがって、artifactやゲームbuildの破損ではなく、リポジトリのPages初期設定が未完了であることが直接原因です。

再発防止として、build jobに `pages: read` だけを追加し、重いbuildの前に `GET /repos/{owner}/{repo}/pages` を実行します。Pages未有効ならSettings > PagesでBuild and deploymentのSourceをGitHub Actionsにするよう明示して即停止します。さらに公式 `actions/configure-pages` v6.0.0をimmutable SHAで実行し、Pages metadataを二重確認します。`configure-pages` の `enablement: true` は使いません。公式actionの仕様上、Pagesを自動有効化するには通常の `GITHUB_TOKEN` 以外の、追加の管理権限を持つtokenが必要なためです。不要なPATや長期secretを追加せず、一度だけGitHub SettingsでPagesを有効化する方針を維持します。

Pagesを有効化した後は、同じPublish Pagesをmain・`source_sha`空欄で実行します。workflowはPages設定、main SHA、同一SHAの成功CI、artifact、deploy、公開後HTTP smokeの順に検査します。
