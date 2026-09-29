# GitHub Pages の公開手順（R6）

R6の本番公開は2026-09-27にユーザーから許可されています。以下に記す過去の公開準備・失敗記録より、冒頭の最新結果を優先してください。

## 2026-09-29 公開完了

PR #18のmerge commit `41e18e2f05ca39b874e874105b76ce0895adb2dc` を、同じSHAのmain push CI [36534850625](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36534850625)成功後に公開しました。[Publish Pages run 36541668581](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36541668581)のbuild、deploy、公開後HTTP検査はすべて成功しました。

公開URL: https://chameleonjp-lab.github.io/sekibanmawashi/

実際に公開URLを開き、セキバンマワシのホーム画面と練習用盤面を確認しました。今回確認したのはホームと練習画面までです。実URL上で5問を完了する手動確認は行っていません。CIのChromium/WebKit検査とworkflowの配信資産・metadata・SHA検査は成功しています。

Q05（iPhone 17 Pro物理Safari、VoiceOver、ロック復帰、実機音）は未実施で、今回のR6公開に限る免除が[PR #14の記録](https://github.com/chameleonjp-lab/sekibanmawashi/pull/14#issuecomment-5861153503)にあります。実機受入済みとは扱いません。Pages Settings、ランキング、Supabase、実験場の本番データは変更していません。

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

## 公開後の確認と戻し方

通常公開としてPages run [36541668581](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36541668581)を実行し、PR #18 merge commit `41e18e2f05ca39b874e874105b76ce0895adb2dc` を公開しました。CI run [36534850625](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36534850625)は同じmain SHAで成功しています。公開workflowはbuildとdeployの両方に成功し、HTTP smokeがページ、`version.json`、hashed JavaScript/CSS、SVG favicon、1200×630の共有PNGとSHAを検査しました。

公開後に問題が見つかった場合は、同じ手動workflowをmainから実行し、直前の確認済みmain SHAを `source_sha` に指定します。そのSHAがmainの祖先であり、同じSHAの成功push CIがあることをworkflowが改めて確認してからdeployします。強制push、履歴書換え、保護設定の緩和、ランキング/Supabase/実験場の本番データ更新はこの手順に含みません。

## 2026-09-28 初回dispatch失敗と対策

Publish Pages run `36363555233` は `source_sha` に `662d0fe79cce888094eb265a71c3f56cc60ff33`（39文字）が渡され、完全40桁SHA検査で意図どおり停止しました。正しいcommitは末尾に `1` を含む `662d0fe79cce888094eb265a71c3f56cc60ff331` です。build・deploy処理自体の失敗ではありません。

手入力事故を通常公開から除くため、通常公開ではSHA入力を不要にし、空欄ならworkflowがcurrent mainを採用するよう変更しました。明示SHAの厳密検査、main祖先検査、同一SHAのmain push CI成功検査は維持しています。


## 2026-09-28 Publish Pages #2 の404とPages有効化前検査

Publish Pages run `36392473240` では、source SHA確定、main祖先検査、同一SHAのCI成功確認、依存導入、Pages build、artifact静的検査、`github-pages` artifact uploadまで成功しました。deploy jobの `actions/deploy-pages` がPages deployment作成APIでHTTP 404となり、公開後smokeへ進めませんでした。

同時点のGitHub repository APIは `has_pages: false` を返しており、Pagesサイト自体が未有効です。したがって、artifactやゲームbuildの破損ではなく、リポジトリのPages初期設定が未完了であることが直接原因です。

再発防止として、build jobに `pages: read` だけを追加し、重いbuildの前に `GET /repos/{owner}/{repo}/pages` を実行します。Pages未有効ならSettings > PagesでBuild and deploymentのSourceをGitHub Actionsにするよう明示して即停止します。さらに公式 `actions/configure-pages` v6.0.0をimmutable SHAで実行し、Pages metadataを二重確認します。`configure-pages` の `enablement: true` は使いません。公式actionの仕様上、Pagesを自動有効化するには通常の `GITHUB_TOKEN` 以外の、追加の管理権限を持つtokenが必要なためです。不要なPATや長期secretを追加せず、一度だけGitHub SettingsでPagesを有効化する方針を維持します。

Pagesを有効化した後は、同じPublish Pagesをmain・`source_sha`空欄で実行します。workflowはPages設定、main SHA、同一SHAの成功CI、artifact、deploy、公開後HTTP smokeの順に検査します。
