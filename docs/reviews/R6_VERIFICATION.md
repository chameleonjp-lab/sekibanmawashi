# R6 公開Workflow検査記録

更新日: 2026-09-27 JST / branch: `chore/06-publication` / R6開始基準: PR #11 merge commit `dab3b9133d3b6ef5f4c88c433719192d64e413cd` / tree `6ff4ca684103cd0eb5265b62e89fb071f6b94784`

R6では、ユーザーの明示的な本番公開許可を受け、workflow_dispatchに限ったGitHub Pages公開・検証の手順を実装します。公開許可は計画8.2の未達ゲートの包括的waiverではありません。PRマージ、Actions dispatch、Pages Settings操作、実deployはこの作業では行いません。事前ゲートが完了するか、各未達項目のユーザー明示waiverが記録された後に、rootがmain/CIを再確認してdispatchできる状態になります。deploy後はHTTP smokeだけでなく計画8.2の実URLフロー確認もR6完了条件に残ります。

## 実装範囲

- `.github/workflows/publish-pages.yml`: triggerを `workflow_dispatch` だけに限定。main dispatchと完全40桁SHAを要求し、現在のmain祖先・同一SHA/main pushのCI `verify` 成功を `actions:read` で確認してからPages用build/artifact作成へ進みます。build/deployは別jobで、deployは `github-pages` environmentとPages artifactを使います。rollback時にR6前のSHAを選べるよう、検証scriptをdispatch workflow revisionからrequested source checkout前に `$RUNNER_TEMP/pages-smoke-tools/check-pages.mjs` へ保存し、後でcheckoutした対象sourceの `site.config.ts` を同じtempへコピーします。Pages build自身は対象SHAのVite/package/scriptsを利用し、artifact/smoke verifierだけをdispatch revisionから使います。
- `scripts/check-pages.mjs`: Pages artifactのmetadata・base付きJS/CSS/favicon・ローカル成果物とSHAを確認するモード、および公開後の実HTTPS HTTP smokeモードを追加。
- `.github/workflows/ci.yml`: 通常buildの後に `PAGES_BUILD=1 npm run build` とartifact検査を追加。PR CIでPages用baseの成果物をdeployなしで確認します。
- `package.json`: Pages artifact確認 / 公開後HTTP smokeのscriptを追加。
- `docs/PAGES_PUBLICATION.md`, `CURRENT_STATE.md`, `docs/planning/IMPLEMENTATION_PROGRESS.md`: R6の権限・公開境界・保留項目を更新。

ゲーム規則、UI実装、問題90問、券900組は変更していません。

## 検査結果

| 検査 | 結果 | 証跡・範囲 |
|---|---|---|
| 基準main | 確認済み | `dab3b9133d3b6ef5f4c88c433719192d64e413cd`, tree `6ff4ca684103cd0eb5265b62e89fb071f6b94784` |
| `npm ci` | 成功 | Node `24.19.0` / npm `11.9.0`; 21 packages installed |
| `npm run typecheck` | 成功 | R6 branch working tree |
| `npm run lint` | 成功 | 39 source files |
| `npm run licenses:check` | 成功 | Apache-2.0:4, BSD-3-Clause:1, ISC:1, MIT:64 |
| `npm test` | 成功 | 72 tests passed; fail/skip 0 |
| `npm run puzzles:test` | 成功 | P01-P09 and 100,000 fixed-seed draws |
| `npm run build` | 成功 | Regular root-base Vite production build |
| `PAGES_BUILD=1 npm run build` | 成功 | Vite Pages base `/sekibanmawashi/` |
| `npm run pages:artifact:check` | 成功 | Source and requested SHA both `dab3b9133d3b6ef5f4c88c433719192d64e413cd`; title/lang/description/OG, null OG image absence, base-prefixed JS/CSS/favicon, file existence, version fields |
| `npm run performance:r5` | 実行成功（測定のみ） | 155,520 samples; p50 `0.032238 ms`, p95 `0.064076 ms`, max `5.104793 ms`. Linux/Node observation, not a pass/fail gate or device result; observed max is above the historical 5 ms target |
| GitHub CLI GET-method correction | 対応済み | [公式`gh api`マニュアル](https://cli.github.com/manual/gh_api)は、field指定でmethodがPOSTへ切り替わり、GET queryにするには `--method GET` が必要と説明。workflowのworkflow-runs/jobs両list呼出に追加 |
| Mocked CI-runs/jobs query | 成功 | PyYAMLでworkflow stepを抽出し、`gh`関数mockでGET method、URL、query fieldsと成功JSON応答を検査。実GitHub API/本番認証には接続していない |
| Rollback verifier source | 対応済み | verifier scriptをdispatch workflow revisionから`RUNNER_TEMP`へ保存後にrequested SHAへcheckout。対象SHAの`site.config.ts`を同じtempへ渡し、R6導入前の受入済みsourceもartifact/smoke検査できます |
| Deployment URL output | 必須化・isolated check成功 | published smokeは`PAGES_DEPLOYMENT_URL`非空、HTTPS、`site.config.ts`のpublicUrlと同じorigin/pathでなければ失敗。SHAを設定してURLを省いた実行はHTTP fetchの前に必須URLエラーで停止 |
| Playwright browser install | blocked | `npm run test:e2e:install` (`--with-deps`) failed because apt could not `setgroups` in this sandbox. `npx playwright install chromium webkit` failed after repeated zero-byte/truncated browser archive responses. Cached WebKit revision 2336 does not match current Playwright 1.63's required 2359; pinned Chromium 1243 is absent |
| local targeted E2E / full E2E | 未実施 | Local Playwright install was blocked above; the full suite did run in GitHub PR CI below |
| static source/workflow checks | 成功 / actionlint未導入 | `node --check scripts/check-pages.mjs`, PyYAML parse of both workflow files, `git diff --check`; actionlint was not installed |
| 独立担当レビュー | Draft PR作成可 | Sol Highが最終差分を再レビューし、Draft PRを妨げるblockerなしを確認。GET method、pre-R6 rollback verifier、release-gate/waiver、deployment URLの指摘を修正済み。公開受入完了を意味しない |
| PR #12 CI | 成功 | [run 36313174213](https://github.com/chameleonjp-lab/sekibanmawashi/actions/runs/36313174213), head `036b0e04f16a2a3b5531ad3411f35db87a8a93d9`; verify成功。unit72、P01-P09、Pages artifact check成功、browser 90件は89 pass + 1 flaky（再試行成功）、最終失敗0・skip0 |
| PR #12 browser flaky | 未解決 / final CI success | WebKit `w390-h844`・文字200%のstate matrixで初回、開始後に`game-screen`が現れずtimeout。retry成功。根因は未確定で、ゲーム実装はこのPRで変更していない |
| Pages dispatch / live HTTP smoke | 未実施 | 本番公開はしていない。live smokeはR6 PR merge後のroot実deploy時に実施 |

## 残る受入・本番状態

- Q05は未実施: iPhone 17 Pro物理Safariの縦横、200%文字、VoiceOver、ロック復帰、実機音を未確認。
- 正式名「石板回し」は仮表示のまま。`site.config.ts` の `shareImageUrl` は `null` のままで、正式名・共有画像を確定したとは扱わない。
- ユーザーの2026-09-27公開許可は記録済みだが、上記Q05、正式名/URL/共有画像、必須自動検査/独立レビューの未達gateを免除しない。各gate完了または個別の明示waiverまではdispatchしない。
- 公開URLは `https://chameleonjp-lab.github.io/sekibanmawashi/`。このURLへ本番deployしていない。
- 自動公開後検査はHTTP smokeまでであり、ライブサイト上のチャレンジ開始・入力・5問結果・共有・実験場往復をブラウザ操作した結果ではない。計画8.2のこれらの実URLフロー確認がR6完了前に必要。既存Playwright CIはlocalhost previewで動作する。
- R6変更のPR merge後でも、rootは事前gate完了または個別waiverの記録、main head・`CI / verify`を再確認してからdispatchする。Pages Settings、branch protection、ランキング、Supabase、実験場本番データは変更しない。
- Draft PR作成前のSol High独立レビューではblockerなし。actionlint未導入のためYAMLはPyYAMLでparse確認。PR #12 CIは成功したが1 browser flakyを再試行で通過。dispatch・実deploy・実URLフロー・Q05は未実施で、公開ゲート完了または個別明示waiverまではdispatchしない。
