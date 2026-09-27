# GitHub Pages の公開手順（R6）

ユーザーは2026-09-27に本番公開を明示的に許可しました。これは公開操作の許可として記録しますが、R5計画の未達受入ゲートを包括的に免除する指示とは解釈しません。また、**本番deploy済みという意味ではありません**。このPRではPages設定を変更せず、公開Workflowのdispatch・実deployも行いません。実deployは、このPRがユーザーによりmainへマージされた後、事前の公開ゲートが全て完了するか、未達ゲートごとのユーザー明示waiverが記録され、rootがmainとCIを再確認した後の次段階です。

Q05（iPhone 17 Proの物理Safari/VoiceOver等）は未実施です。正式名「石板回し」は仮表示のまま、`site.config.ts` の `shareImageUrl` は `null` です。これらを受入済み・確定済みとは記録しません。公開先URLは設定値 `https://chameleonjp-lab.github.io/sekibanmawashi/` です。

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

既存のCI `verify` jobは通常build・全E2E検査に加え、Pages baseで別buildを行い、`PAGES_REQUESTED_SHA=${{ github.sha }} npm run pages:artifact:check` 相当のartifact検査を実行します。これによりPR CIでPages用のbase・title/lang/description/OG設定・JavaScript/CSS/faviconの生成・ローカルファイル対応・version SHA記録をdeploy前に検査します。通常のdev/CI buildは引き続き `/` baseを使い、Pages baseはこの専用buildだけです。

## 公開後HTTP smoke

deploy-pagesが完了した後、`scripts/check-pages.mjs published` が `site.config.ts` の `publicUrl` をHTTPSで検査します。各HTTP項目は最大4回（0秒、1秒、2秒、4秒待ち）試し、各requestは12秒でtimeoutします。次を実サイトから取得して確認します。

- トップページがHTTP 200でHTML MIMEを返す。`lang="ja"`、title、description、OG title/description/URLが設定値と一致し、OG imageは設定されていれば一致、`null`なら不在。
- `version.json` がHTTP 200 / JSON MIMEを返し、`sourceSha` と `requestedSha` の両方がdispatch SHAと一致。
- base付きhashed JavaScript、CSS、SVG faviconがそれぞれHTTP 200で、対応するJavaScript/CSS/SVG MIMEを返す。
- deploy actionのURL出力が `site.config.ts` の公開URLと一致。

これは配信物のHTTP smokeのみで、ライブサイト上でのhome→challenge開始→入力をPlaywrightで操作する検査ではありません。Playwrightの導入・browser取得を本番deploy後に追加して不安定要因を増やさず、既存CIのChromium/WebKit画面検査は通常のローカルpreviewに対して実行します。HTTP smoke成功をQ05や実機受入へ読み替えません。

## R6での実行と戻し方

PR mergeだけではdispatchしません。dispatch前に、計画8.2の実機受入Q05、正式な公開名・URL・共有画像、必須自動検査と独立レビューを完了します。未達項目が残る場合は、ユーザーがその項目を個別に明示waiveした記録がある場合に限り、rootが公開許可の範囲を確認してdispatchします。2026-09-27の公開許可だけでQ05・正式名・画像を受入済みとは扱いません。

これらの事前ゲートが満たされた後、rootはmainの新headと `CI / verify` を再確認し、Actionsの **Publish Pages → Run workflow** でmainを選び、対象 `source_sha` に受入対象commitの完全SHAを渡します。Workflowはその時点のmain祖先・同一SHAの成功push CIを再確認してからbuild/deployします。deploy直後は自動HTTP smokeを確認し、その後にトップ、挑戦開始、5問結果、再読込、共有、実験場との往復を実URLで確認してR6を完了します。Pagesの `Source: GitHub Actions` 設定が必要なら、権限を持つ人がGitHub Settingsで設定します。この実装作業ではその設定を変更していません。

公開が失敗または問題があれば、同じ手動Workflowへ直前の確認済みSHAを指定して再deployし、HTTP smokeで戻ったcommitを確認します。rollback対象SHAはR6導入前でもよく、検査scriptはdispatch workflow側のrevisionから実行します。強制push、履歴書換え、branch protection変更、ランキング/Supabase/実験場の本番データ更新はこの手順に含みません。
