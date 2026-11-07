# セキュリティ監査: デプロイ工程のワークフロー、Dependabot、CI の補助スクリプト、運用手順書

- 状態: 草案
- 更新日: 2026-11-07
- 監査者: security-auditor
- 工程: デプロイ（push の前。ファイルは未コミット）

## 範囲

デプロイ工程で作られた次のファイルを、観点 2（秘密情報と認証）、3（GitHub リポジトリと Actions）、6（依存とサプライチェーン）、7（ログと運用）で監査した。観点 1、4、5 は、ワークフローと手順書が触れる部分（Supabase の権限の確認手順、Vercel の Build Command など）だけを見た。

- ワークフロー: `.github/workflows/ci.yml`、`daily.yml`、`wif-check.yml`、`audit.yml`、`heartbeat.yml`
- 設定: `.github/dependabot.yml`、`.gitleaks.toml`、`.env.example`（差分）、`.github/requirements/audit.in`、`audit.txt`（パッケージ名だけ）
- 補助スクリプト: `.github/scripts/check_repo_rules.py`、`install-tools.sh`、`pip-audit.sh`、`supabase-local-env.sh`
- 手順書: `docs/operations/environments.md`、`deploy.md`、`runbook.md`、`monitoring.md`

`ops/heartbeat.txt` は `ops/` が未追跡で中身の確認は省いた（heartbeat が上書きする日付だけのファイル）。

## 読んだファイル

- `.claude/rules/security.md`（会話の前提として読み込み済み）
- `docs/design/06_security.md` §3（64〜93 行）、§9〜§10（141〜165 行）
- `docs/design/07_test_plan.md` 42 行（§2 の歯止め）、174〜181 行（S-08〜S-10、S-15）
- `docs/design/adr/0009-batch-db-write-path.md`（W-1〜W-9、Environment、TLS、V-2〜V-6 の行を grep）
- `docs/design/adr/0010-csp-script-src.md` 83 行（判断の 7）
- 上の「範囲」の監査対象のすべて
- `apps/web/package.json`（scripts の行だけ）

実行した読み取りコマンド（すべて GET か読み取り）:

- `gh api repos/takatsu-connect/access-analyzer/actions/permissions/workflow` → `default_workflow_permissions: read`、`can_approve_pull_request_reviews: false`
- `gh api repos/takatsu-connect/access-analyzer/actions/permissions` → `allowed_actions: selected`、`sha_pinning_required: true`
- `gh api repos/takatsu-connect/access-analyzer/actions/permissions/selected-actions` → GitHub 製、verified creators、`google-github-actions/*`
- `gh api repos/takatsu-connect/access-analyzer/actions/permissions/fork-pr-contributor-approval` → `all_external_contributors`
- `gh api repos/takatsu-connect/access-analyzer --jq .security_and_analysis` → secret scanning、push protection、Dependabot security updates が有効
- `gh api repos/takatsu-connect/access-analyzer/rulesets` → ルールセットは「main: force push と削除の禁止」の 1 つだけ
- `git diff .env.example`、`git grep -l -E "eyJ[A-Za-z0-9_-]{10,}\."`（該当なし）、`git status --ignored -- .env credentials ops`（`.env` と `credentials/` は ignore 済み）、`git grep -l -e affable-enigma -e 359672952827`

## 結論

**push してよい。** 致命的と高の指摘はない。

ワークフローは security.md の「GitHub Actions」の規則と 06 §9 の設計どおりになっている。権限は最小で、Secrets を持つジョブと持たないジョブが分かれている。`run:` で式を展開していない。Action はすべて SHA で固定されている。リポジトリ側にも、fork の PR の承認制と SHA 固定の強制がかかっている。push すると `ci.yml`、`audit.yml`、`heartbeat.yml` が動き始めるが、どれも Secrets を参照しないので、それによって新しく露出するものはない。

中の指摘 4 件（M-1〜M-4）は、本番化（deploy.md の手順 8、`DAILY_ENABLED=true`）より前に直すか、依頼者が判断してほしい。M-1 は直さないと、何もしない期間が 60 日に届く前に daily と audit の schedule が止まりうる不具合である。

| 重要度 | 件数 |
| --- | --- |
| 致命的 | 0 |
| 高 | 0 |
| 中 | 4 |
| 低 | 5 |
| 情報 | 5 |

## 指摘

### 致命的

なし。

### 高

なし。

### 中

#### M-1 heartbeat のしきい値（45 日）と実行間隔（月 1）の組み合わせでは、60 日の無活動に間に合わない

- 対象: `.github/workflows/heartbeat.yml` 10 行（`cron: "0 3 1 * *"`）と 33 行（`-lt 45`）、`docs/operations/runbook.md` 155 行、`environments.md` 42 行
- 問題（確認済み。日付の計算）: heartbeat は月 1 日にだけ動き、最後のコミットから 45 日以上たっているときだけコミットする。最後のコミットから 44 日目に 1 日が来ると何もしない。次の 1 日は 28〜31 日後なので、そのときには 72〜75 日たっている。60 日目の時点で、public リポジトリの schedule はすべて止まる（03 §12 の前提）。止まるのは heartbeat 自身も含むので、ひとりでには戻らない。
- 起こりうること: 文書の更新も Dependabot の merge もない期間が続くと、`daily` が止まる。取り下げた記事が BI に残り続け（FR-72、NFR-52）、同時に `audit.yml` の週 1 の脆弱性監査も止まる（W-9）。失敗のメールは届かない（monitoring.md §1 の「通知が届かない失敗」）。気づける手段は月 1 の目視と「更新が遅れています」の表示だけになる。
- 直し方の案: しきい値 T と実行間隔 I が `T + I < 60` を満たすようにする。例えば (a) 月 1 のまま T を 25 日にする、(b) 週 1（`0 3 * * 1`）にして T を 45 日のままにする（45 + 7 = 52）。(b) のほうがコミットが少なくて済む。あわせて runbook.md §10 と environments.md §2.2 の説明を直す。S-10 の検査には影響しない。
- 関係: 03 §12、06 §9、設計レビュー M-3、NFR-52

#### M-2 Supabase CLI を `npx supabase@3.0.0` で取っており、依存の依存が固定されていない。依頼者の PC で `postgres` のパスワードの下でも動く

- 対象: `.github/workflows/ci.yml` 114 行と 150 行、`.github/scripts/supabase-local-env.sh` 9 行、`docs/operations/deploy.md` 72〜92 行（`link`、`migration list`、`db push`）
- 問題（確かめたこと）: 固定されているのは `supabase` パッケージの版だけ。ロックファイルがないので、`npx --yes` は実行のたびに依存の依存を semver の範囲の中で解決し直す。Dependabot の対象にも cooldown の対象にもならない。（推測）npm の `supabase` パッケージは、インストール時にスクリプトで CLI のバイナリを取りに行く作りだと理解している。そのスクリプトがチェックサムを照合するか、依存に何があるかは、この監査では確かめていない（npm の情報を取るのは許された操作に入っていない）。
- 起こりうること:
  - CI: 依存の依存が侵害された版に置き換わると、`integration` ジョブの中で任意のコードが動く。このジョブは Secrets を持たず、トークンも `contents: read` だけで、`daily.yml` は cache を使わない（setup-python に `cache:` がない）。だから本番の秘密には届かない。届くのは CI の結果の偽装まで。
  - 依頼者の PC: deploy.md の手順 3 と §2（マイグレーションの更新のたび）では、同じ `npx` が `supabase login` のアクセストークンのある PC で動く。`postgres` のパスワードを入力する場でもある。ここで侵害された版が動くと、Supabase の管理者の権限が取られ、BI データの完全性とスキーマの両方が危うくなる。ロックのない取り込みが、いちばん強い権限のある場所で動いている。
- 直し方の案（どれか 1 つ）:
  1. リポジトリのどこか（例: `tools/supabase-cli/package.json` と `pnpm-lock.yaml`）に `supabase` を devDependency として固定する。CI も PC もそこから `pnpm exec supabase` で呼ぶ。Dependabot（npm、cooldown つき）の対象にも足す。
  2. install-tools.sh と同じやり方で、GitHub Releases の Linux 版のバイナリを版と SHA-256 で固定して取る（CI 用）。PC は、公式の配布物をチェックサムで確かめて入れる手順を deploy.md に書く。
  - どちらにしても、3.0.0 の公開日が 14 日のルール（ci.yml 19 行の注記）を満たすかを確かめる（environments.md §8 の 2、deploy.md §4 の 1 が未確認のまま）。
- 関係: security.md「依存」（ロックファイルをコミットする）、06 §10、NFR-45

#### M-3 CI が main への merge の必須チェックになっていない（ADR 0010 判断 7、06 §10 との差）

- 対象: リポジトリのルールセット（`gh api .../rulesets` で 1 件だけ。force push と削除の禁止）、`docs/operations/deploy.md` 264〜267 行、`docs/design/adr/0010-csp-script-src.md` 83 行
- 問題（確認済み）: ADR 0010 の判断 7 は「lint、E2E、ビルド後の検査を CI の必須チェックにする（デプロイ工程）」としている。06 §10 は「main への merge 前の CI で止める」としている。いまのルールセットには必須のステータスチェックも PR の要求もない。deploy.md 266 行も、main への直接の push ができ、そのとき CI の落ちたコードも BI に出ることを認めている。Vercel の Build Command に `check:build` を入れたので、ビルド後の検査（判断 7 の後半）は満たしている。一方で、lint（`noInlineConfig` の歯止め）、E2E、`deps-audit`（致命的・高の脆弱性）、`static`（gitleaks、S-10）で merge を止める仕組みはない。これらは人の注意に任されている。
- 起こりうること: Dependabot の PR や急ぎの修正を、CI が赤いまま、または終わる前に merge する誤操作があると、高の脆弱性がある依存や CSP の歯止めを外したコードがそのまま本番に出る。バッチなら、翌日に Secrets の下で動く。
- 直し方の案: ルールセットに「Require status checks to pass」（`batch`、`web`、`integration`、`static`、`deps-audit`）と「Require a pull request before merging」を足す。ただし heartbeat は GITHUB_TOKEN で main に直接 push するので、そのままでは止まる。次のどちらかを依頼者が決める。
  - (a) ルールセットの bypass に GitHub Actions を入れられるかを確かめて入れる。入れられないなら、heartbeat を PR を作る方式にするか、M-1 の直しと合わせて別の手段を探す（情報 I-4）。
  - (b) 必須チェックを付けないと決め、ADR 0010 の判断 7 と 06 §10 の文言を「人が CI の成功を確かめてから merge する」に改める。残るリスクを ADR に書く。
- 関係: ADR 0010 判断 7、06 §10、security.md「依存」（致命的または高の脆弱性が残った状態でデプロイしない）、NFR-45

#### M-4 侵害時の手順に、WIF / サービスアカウントの悪用と、依存や Action の侵害の場合がない

- 対象: `docs/operations/runbook.md` §9（132〜151 行）
- 問題（確認済み）: §9 は `SUPABASE_BATCH_DB_URL`、Deploy Hook、git 履歴の 3 つを扱っている。§9.1 の順序（止める → パスワードの変更 → セッションの切断 → Secret の更新 → 作り直し → 旧デプロイの削除）は 06 §3 の W-2 どおりで、無効化が先にある。一方、脅威モデルの「悪意ある依存パッケージや GitHub Action」の場合がない。`daily` と `backfill` のジョブは `id-token: write` を持つので、そのジョブで動く wheel は OIDC トークンを取り、WIF を経て GA4 を読める（設計上、避けられない）。GA4 の生データには、公開しない次元（サイト内検索語、市区より細かい地域、完全な参照 URL など）が含まれる。もう一つ、GitHub のアカウント（書き込み権限）の侵害の場合もない。
- 起こりうること: 侵害に気づいても、WIF のプロバイダを止める手順が手元にない。その間、GA4 の読み出しと接続文字列の利用が続く。
- 直し方の案: runbook.md §9 に「9.4 依存・Action・GitHub アカウントの侵害が疑われるとき」を足す。順序の案:
  1. `DAILY_ENABLED=false`
  2. WIF のプロバイダを無効化する（`gcloud iam workload-identity-pools providers update-oidc ... --disabled`、または SA の `roles/iam.workloadIdentityUser` の付与を外す。コマンドの形は依頼者が確かめる）
  3. §9.1 の 2〜4（`batch_writer` のパスワード）と §8.2（Hook）を行う
  4. 影響範囲を確かめる（Actions の実行履歴で、どの実行がどのコミットで動いたか。GCP の監査ログで SA のトークン発行の記録。Supabase の `batch_run`）
  5. 原因のコミットや依存を revert してから、プロバイダを有効に戻して backfill を流す
  - GitHub アカウントの侵害なら、先に組織の Owner がそのアカウントの権限を外し、PAT と SSH 鍵を失効させる。
- 関係: 06 §3、NFR-44、観点 7（漏えい時の無効化、再発行、影響範囲の確認）

### 低

#### L-1 `check_repo_rules.py` が、設計の規律のうち次の項目を検査していない

- 対象: `.github/scripts/check_repo_rules.py` 121〜208 行
- 確かめたこと（いまのワークフローはどれも満たしている。将来の退行を防ぐための指摘）:
  1. `ci.yml` が `secrets.` を参照しないこと（06 §9「PR 用の CI は Secrets を参照しない」）。`audit.yml` と `heartbeat.yml` には検査があるが、`ci.yml` にはない。
  2. `workflow_run` の起点（fork の PR の結果を、権限のある文脈で受ける経路）の禁止。
  3. heartbeat 以外の `actions/checkout` に `persist-credentials: false` があること。
  4. `ci.yml` と `audit.yml` の `uses:` の許可リスト（06 §9）。なお `ci.yml` 140 行は `actions/upload-artifact` を使っているが、06 §9 の ci.yml の列挙には入っていない。GitHub 製で、リポジトリ側の許可にも入っているので問題はない。設計の列挙に足すか、検査の許可リストに入れて、設計と揃える。
- 直し方の案: 1〜3 を規則に足す。4 は 06 §9 に `actions/upload-artifact` を足す。

#### L-2 `batch_writer` のパスワードを端末に表示し、平文の SQL で設定する手順

- 対象: `docs/operations/deploy.md` 100〜110 行、`runbook.md` 109 行と 137 行
- 問題: 手順 4 の `python -c ... print(...)` は値を端末の画面とスクロールバックに出す。`alter role ... password '<値>'` は平文で送られる。SQL エディタの履歴は ADR 0009 の確認項目 3 で扱っている。（推測）Postgres の文のログ（`log_statement` や、エラー時の文の記録）に残るかどうかは、Supabase の設定次第で、確かめていない。
- 直し方の案: 生成した値を端末に出さずにクリップボードへ送る形にする（例: PowerShell の `Set-Clipboard`）。使い終わったら端末を閉じることを書く。Supabase の Logs で、`alter role` の文が記録されないかを確認項目に足す。

#### L-3 A-11 の「main 以外のブランチから接続文字列を取れない」の確かめ方が、Environment の制限とは別の理由で失敗しうる

- 対象: `docs/operations/deploy.md` 239〜242 行
- 問題（推測。確かめていない）: `workflow_dispatch` は、既定のブランチにないワークフローのファイルを起動できない場合がある。そうだと `gh workflow run a11-env-check.yml --ref a11-env-check` は 404 などで失敗し、Environment の制限が効いているかは分からない。手順は「Environment の保護の規則で許可されていない旨で失敗する」ことを見るよう書いているので、取り違えにくい作りではある。
- 直し方の案: 一時ワークフローの起点を `push`（`branches: [a11-env-check]`）にする。そうすれば、push しただけで Environment の判定まで進む。

#### L-4 06 §3 では「文書に置かない」とした GCP の識別子が、手順書に書かれている

- 対象: `docs/operations/environments.md` 104〜106 行、`deploy.md` 38 行と 251 行（プロジェクト ID、番号、SA のメールアドレス）
- 問題（確認済み）: 06 §3 は `GCP_SERVICE_ACCOUNT` などについて「秘密ではないが公開 YAML に埋め込まない」とし、置かない場所に「YAML、文書」を挙げている。手順書は、これらをそのまま書いている。ただし同じ値は、コミット済みの `docs/operations/initial_setup.md` と `docs/security/audits/2026-11-03-initial.md` に既にある（`git grep` で確認）。新しい露出はない。WIF の属性条件があるので、値だけでは使えない。
- 直し方の案: 06 §3 を「プロジェクト ID と SA の名前は公開してよい（属性条件で守る）」に改める。そうでなければ手順書をプレースホルダにする。どちらにするかは依頼者が決める。

#### L-5 侵害の後の「影響範囲の確認」が §9.1 にない

- 対象: `docs/operations/runbook.md` 134〜143 行
- 問題: 作り直し（backfill）と旧デプロイの削除はある。一方、いつから漏れていたか、何に使われたかを調べる手順がない（Supabase のログで `batch_writer` の接続元と時刻を見る、`batch_run` に覚えのない行がないかを見る、漏れた経路を特定する。例えば Actions のログなら、その実行のログを消す）。
- 直し方の案: §9.1 の 4 と 5 の間に「影響範囲の確認」を足す（値を記録しない）。M-4 の 9.4 と同じ形にする。

### 情報

- I-1 `wif-check.yml` 36〜40 行: curl が接続に失敗すると、`-w '%{http_code}'` が出す `000` に `|| echo "000"` の `000` が続き、`status=000000` になる。deploy.md 61 行の `status=000` と表示が違うだけで、`test` で失敗するので安全上の問題はない。
- I-2 `daily.yml` の `google-github-actions/auth` は既定の `create_credentials_file: true` で、ワークスペースに資格情報の構成ファイル（`gha-creds-*.json`）を作る。（推測）このファイルには、ジョブの間だけ有効な OIDC の要求トークンが入る。ワークスペースを成果物にしたりコミットしたりするステップはないので、いまは問題ない。将来 `daily.yml` に `upload-artifact` を足さないこと（S-10 の許可リストが止める）。
- I-3 `concurrency`（`daily-batch`、`cancel-in-progress: false`）では、待ちに入れる実行は 1 本だけ。待っている実行は、後から来た実行に置き換えられて取り消される（GitHub の concurrency の一般的な動き。この監査では公式文書で確かめていない）。backfill が走っている間に 17:00 と 18:00 の schedule が両方来ると、17:00 の daily は取り消される。18:00 の daily が動くので、データの上では困らない。
- I-4 heartbeat のコミットは main への push なので、Vercel の本番ビルドを起こす（データは前回と同じ）。害はない。heartbeat の代わりの手段として、`actions: write` でワークフローを有効にし直す API を呼ぶ方式がある。`contents: write` より狭い権限で済む。ただし、それで 60 日の判定が戻るかは確かめていない。runbook.md §13 の 1（GITHUB_TOKEN のコミットが活動として数えられるか）と合わせて、事実を確かめてから選ぶ。
- I-5 `.github/requirements/audit.txt` は pip-audit とその依存（requests、rich、cyclonedx-python-lib、pip ほか 28 件）で、`pip==26.2.2` を含む。CI の中で pip が上書きされるが、どのジョブも Secrets を持たないので許容できる。新しい依存の採用（pip-audit）は 06 §10 に沿っている。

## 問題なしと確認した項目

権限:

- 5 本すべてに最上位の `permissions:` がある。`ci.yml`、`daily.yml`、`wif-check.yml`、`audit.yml` は `contents: read` だけ。
- `id-token: write` は、`daily.yml` の `daily` と `backfill`、`wif-check.yml` の `wif-check` のジョブだけにある。`publish_only` は `contents: read` だけで、GCP の認証をしない。
- `contents: write` は `heartbeat.yml` だけ。heartbeat は `actions/checkout` と `git` だけを使い、Secrets、依存のインストール、プロジェクトのコードを使わない（06 §9 の M-3 の分離どおり）。書くのは `ops/heartbeat.txt` の日付だけで、入力を受けない。GITHUB_TOKEN ではワークフローのファイルを変えられないので、この権限から `.github/workflows/` を書き換えられない。
- `environment: production` は `daily.yml` の 3 つのジョブだけにある。`SUPABASE_BATCH_DB_URL` は `daily` と `backfill` の実行のステップの `env:` だけ、`VERCEL_DEPLOY_HOOK_URL` は 3 つの実行のステップだけに渡る。pip install のステップと、Action の `with:`（WIF のプロバイダ名と SA 名だけ）には渡らない。
- `ci.yml`（pytest、E2E を含む）と `audit.yml` は、Secrets、Variables、Environment を参照しない。
- リポジトリの GITHUB_TOKEN の既定は read。PR の承認はできない（`gh api` で確認）。

入口:

- `pull_request_target` と `workflow_run` は、どのワークフローにもない。fork からの `pull_request` で動くのは `ci.yml` だけで、Secrets はなく、トークンは read だけ。外部の協力者の PR は、すべて承認制（`all_external_contributors`。確認済み）。
- `workflow_dispatch` の入力（`mode` は choice、`from`、`to`、`base_date`）は `env:` に入れて渡しており、`run:` で `${{ }}` を展開していない。backfill の引数は bash の配列で組み立て、引用符で囲んでいる。値の形はバッチが検証する（06 §7、§9）。
- schedule を持つジョブには、すべて `github.ref == 'refs/heads/main'` がある。`daily.yml` は、加えて `vars.DAILY_ENABLED == 'true'` が条件になっている。
- すべてのジョブに `timeout-minutes` がある（5〜60 分）。`ci.yml` の concurrency は、PR のときだけ前の実行を取り消す。`daily.yml` は 1 本ずつで、走っているものは取り消さない。

供給網:

- `uses:` はすべて 40 桁の SHA と版のコメント（親の事実票と一致）。リポジトリ側にも SHA 固定の強制と、Action の許可リストがある（確認済み）。`daily.yml` が使う Action は checkout、setup-python、auth の 3 つだけ。
- `install-tools.sh` は版を固定した URL から `curl -f` で取り、`sha256sum -c` で照合してから展開する。照合に失敗すると `set -e` で止まる。
- pip はすべて `--require-hashes --only-binary :all:` で入れる（daily、ci、audit）。pip-audit は `--require-hashes --disable-pip` で、解決し直さない。
- Dependabot は 4 つのエコシステムすべてに cooldown がある（7 日。`.github/requirements` は 14 日）。自動 merge の設定はない。runbook.md §12 に、人が見る項目（新しい保守者、インストールスクリプト、ハッシュの更新）がある。
- `pnpm install --frozen-lockfile` を使い、pnpm と Node の版を固定している。

ログ:

- `set -x`、`printenv`、`ACTIONS_STEP_DEBUG` はない（S-10 の検査もある）。monitoring.md §3 は、デバッグログを使わないことと、漏れたときにログを消すことを書いている。
- `wif-check` は、応答の本文を一時ファイルに書いて行数だけを数え、すぐ消す。出力は `status=` と `rows=` だけ。curl は `-s` で、トークンは `env:` 経由（auth の出力は GitHub がマスクする）。プロパティ ID は出さない。
- gitleaks は `--redact` つき。`check_repo_rules.py` は違反した行の中身を出さない。`supabase-local-env.sh` は `status -o env` の出力を変数に取るだけで、値を出さない（件数だけ）。
- `upload-artifact` の対象は失敗時の Playwright の報告だけで、7 日で消える。中身はフィクスチャの架空のデータと、ローカルの BI の画面。

CI の Supabase ローカル:

- `batch_writer` のパスワードは、ジョブごとに `openssl rand -hex 24` で作る（48 文字、英数字。ADR 0009 の 32 文字以上を満たす）。`GITHUB_ENV` だけに置き、ログに出さない。
- 管理接続は `postgres:postgres@127.0.0.1:54422`（ローカルの既定値。秘密ではない）。gitleaks の `postgres-url-with-password` の規則（16 文字以上の英数字）には当たらない。
- `env -u GITHUB_RUN_ID` を、pytest の単体と結合、E2E のフィクスチャの 3 か所に付けている。テストが `batch_run` に Actions の実行記録を書かないので、localdb の歯止め (3) が CI 自身の書き込みで誤って働くことはない。歯止め (1)（host が localhost で、`PGHOSTADDR` などがない）は、ワークフローが `PG*` を設定しないこと（S-10 の検査）で保たれる。(2) はコード側にある。
- CI に本番の値はないので、歯止めが外れても、本番には届かない。

秘密情報:

- `.env.example` は「名前=」だけで、06 §3 の置き場所の区分（リポジトリの Secret、Environment、Vercel、ローカル）が注記にある。`NEXT_PUBLIC_` は付いていない。`.env` と `credentials/` は ignore 済み（確認済み）。追跡されているファイルに JWT の形はない（`git grep` で確認）。
- `.gitleaks.toml` は、S-09 の形（JWT、`sb_secret_`、パスワードつきの Postgres の URL、pooler、Deploy Hook、SA の JSON 鍵）を網羅している。allowlist は Deploy Hook の規則にだけかかり、値を書いていない。
- secret scanning と push protection は有効（確認済み）。

手順書:

- deploy.md と runbook.md は、本番を変える手順のすべてに「依頼者の確認が要る」と書いている。値をこの文書、Issue、チャット、ログに書かないことと、Secrets をブラウザから入れること（シェルの履歴に残さない）も書いている。
- 手順 3 は `--include-seed` を禁止している（テストのデータが本番に入らない）。権限の検査 SQL を本番で流し、0 行であることを確かめる（A-11）。
- Vercel の Build Command（`pnpm run build && pnpm run check:build`）は、`check:build` が失敗するとビルドを失敗させ、前のデプロイを残す。ADR 0010 判断 7 のうち「日次の本番ビルドでも検査を走らせ、失敗したらビルドを失敗させる」を満たす（`apps/web/package.json` の scripts で確認）。CI の必須チェックの部分は M-3。
- ロールバック（deploy.md §3）は revert で行い、force push に頼らない。マイグレーションは戻すためのマイグレーションで戻す。
- 漏えい時（runbook.md §9.1）は、無効化（パスワードの変更とセッションの切断）が、作り直しより先にある。§9.3 は、履歴を消すより先に無効化と再発行をすることを書いている。
- 年 1 回のローテーション（§8）と、運用担当の退任時のローテーションが書かれている。

## 依頼者に確認してもらう項目

リポジトリの外にあり、この監査では見られないもの:

1. GCP: WIF のプロバイダの属性条件が、事実票の 3 条件（repository、repository_id、ref）と一致していること（deploy.md 手順 1 の確かめ方）。SA に GA4 の閲覧者以外の権限がないこと。手順 11 の後に、`USER_MANAGED` の鍵がないこと。
2. GitHub: Environment `production` の Deployment branches が main だけで、リポジトリの Secrets に `SUPABASE_BATCH_DB_URL` と `VERCEL_DEPLOY_HOOK_URL` がないこと（手順 5 の確かめ方。organization のプランで使えるか、ADR 0009 の確認項目 4）。Environment を付けたジョブで WIF が通ること（V-2、手順 10）。
3. GitHub: ルールセットに必須のステータスチェックを足すかどうか（M-3）。足すなら、heartbeat の push との両立（GitHub Actions を bypass にできるか）。
4. GitHub: GITHUB_TOKEN による heartbeat のコミットが、60 日の判定で活動として数えられるか（runbook.md §13 の 1）。M-1 の直しと合わせて決める。
5. Supabase: `alter role ... password` の文が、Logs や SQL エディタの履歴に残らないこと（L-2、ADR 0009 の確認項目 3）。プロジェクトの管理者全員に 2 要素認証があること。
6. Vercel: fork の PR のプレビューをビルドしない設定（environments.md §8 の 5）。Standard Protection（手順 7）。GitHub App の対象を、このリポジトリだけにしていること（手順 6 の 1）。アカウントの 2 要素認証。
7. npm: `supabase@3.0.0` の公開日と、インストール時のスクリプトの動き（M-2）。

## 依頼者の判断が要ること

1. M-1: heartbeat を「週 1 + 45 日」にするか、「月 1 + 25 日」にするか（監査の推奨は週 1）。
2. M-2: Supabase CLI をロックファイルで固定するか、バイナリをチェックサムで固定するか。依頼者の PC での入れ方。
3. M-3: CI を必須チェックにするか（heartbeat の扱いを含む）。必須にしないなら、ADR 0010 の判断 7 と 06 §10 の文言を改め、残るリスクを受け入れることを ADR に書く。
4. L-4: GCP のプロジェクト ID と SA 名を「公開してよい」と 06 §3 に書くか、手順書から外すか。

## 未確認

- `supabase@3.0.0` の依存の一覧と、インストール時のスクリプトのチェックサムの照合（npm の情報を取らなかった。M-2）。
- GitHub の concurrency で、待ちの実行が置き換えられる動き（I-3）と、`workflow_dispatch` が既定のブランチにないファイルを起動できるか（L-3）。どちらも公式文書を取っていない。確かめ方: 依頼者か親が GitHub Docs の「Using concurrency」と「Events that trigger workflows」の `workflow_dispatch` の節を事実票にする。
- Postgres のログに `alter role` の文が残るか（L-2）。
- `ops/heartbeat.txt` の中身（未追跡。heartbeat が上書きするだけなので、安全上の影響はない）。
- バッチが空の `BASE_DATE`（schedule のとき）を「指定なし」として扱うか。`env.py` を読んでいない。機能の問題で、安全上の影響はない。
- ワークフローを実際に動かした結果（actionlint、gitleaks、`check_repo_rules.py` が通るか）。push の後の最初の `ci.yml` で分かる。
