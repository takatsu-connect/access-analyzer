# デプロイ手順（初回の本番化と通常の更新）

- 状態: 草案
- 更新日: 2026-11-07

## 0. この文書の使い方

- 初回の本番化（§1）は、手順 1 から順に 1 つずつ実行する。各手順に「確かめ方」と「戻し方」を書いた。確かめ方が通らなければ次へ進まない。
- **本番を変える手順には「依頼者の確認が要る」と書いた。** エージェントはこれらを実行しない。依頼者が実行するか、依頼者が内容を確かめて指示したときだけ行う。
- 値（パスワード、接続文字列、Hook の URL、プロパティ ID、PROJECT-REF、pooler の host）は、この文書、Issue、コミットメッセージ、チャット、ログに書かない（NFR-44）。コマンドの例の `<...>` はその場で置き換え、置き換えた後のコマンドを保存しない。
- 前提: `.github/` のワークフローが main に push されていること（親が監査の後に push する）。push した時点では `DAILY_ENABLED` がないので、`daily.yml` は動かない。`ci.yml`、`audit.yml`、`heartbeat.yml` は Secrets を使わないので、この時点から動いてよい。
- 設定値の一覧は environments.md。

| 手順 | 内容 | 本番を変えるか | 所要の目安 |
| --- | --- | --- | --- |
| 1 | WIF を作り、リポジトリの Secrets 3 つを登録する | 変える（GCP、GitHub） | 20 分 |
| 2 | `wif-check` を流す | 変えない（GA4 を 1 回読む） | 5 分 |
| 3 | 本番の Supabase にマイグレーションを適用する | 変える（Supabase） | 20 分 |
| 4 | `batch_writer` のパスワードを設定する | 変える（Supabase） | 10 分 |
| 5 | GitHub の Environment `production` と `SUPABASE_BATCH_DB_URL` | 変える（GitHub） | 10 分 |
| 6 | Vercel のプロジェクトと環境変数 | 変える（Vercel） | 20 分 |
| 7 | Deploy Hook と Standard Protection | 変える（Vercel、GitHub） | 10 分 |
| 8 | `DAILY_ENABLED` と `publish_only` の試し | 変える（GitHub） | 10 分 |
| 9 | 初回の backfill | 変える（Supabase のデータ、Vercel のデプロイ） | 20 分 |
| 10 | A-11 の実機確認 | 一部変える（確認用の一時ブランチ） | 30 分 |
| 11 | JSON 鍵と一時的なロールを消す | 変える（GCP、ローカル） | 10 分 |

## 1. 初回の本番化

### 手順 1: WIF を作り、Secrets を登録する（依頼者の確認が要る）

1. docs/operations/initial_setup.md §2「GCP 側の手順」の 2〜6 を実行する（1 の API の有効化は 2026-11-03 に実行済み）。手順 4 の `--attribute-condition` は repository、repository_id（1443616803）、ref（refs/heads/main）の 3 つを含むことを目で確かめる。
2. GitHub の Settings → Secrets and variables → Actions → Repository secrets に、`GCP_WORKLOAD_IDENTITY_PROVIDER`（手順 6 の出力）、`GCP_SERVICE_ACCOUNT`、`GA4_PROPERTY_ID` を登録する。ブラウザの画面から入力する（シェルの履歴に残さない）。

確かめ方:

```
gcloud iam workload-identity-pools providers describe access-analyzer --project=affable-enigma-513514-q8 --location=global --workload-identity-pool=github --format="value(attributeCondition)"
```

```
gh secret list --repo takatsu-connect/access-analyzer
```

1 つ目が 3 つの条件を含み、2 つ目に 3 つの名前が出る（値は出ない）。

戻し方: `gcloud iam workload-identity-pools providers delete access-analyzer ...`（同じ `--project`、`--location`、`--workload-identity-pool`）と、手順 5 の `add-iam-policy-binding` を `remove-iam-policy-binding` に替えて実行する。Secrets は `gh secret delete <名前> --repo takatsu-connect/access-analyzer`。

### 手順 2: wif-check を流す（GA4 を 1 回読むだけ。本番は変えない）

1. GitHub の Actions → `wif-check` → Run workflow。ブランチは main を選ぶ。

```
gh workflow run wif-check.yml --repo takatsu-connect/access-analyzer --ref main
```

確かめ方: ジョブのログの最後の行が `status=200 rows=1`（行数は 1 以上）。応答の本文とトークンはログに出ない。

- `status=403`: SA に GA4 プロパティの閲覧者が付いていないか、Data API が無効。
- 認証のステップで失敗: 属性条件（main 以外から実行していないか）、`roles/iam.workloadIdentityUser` の付与、Secrets の名前を見る。
- `status=000`: 接続の失敗。再実行する。

戻し方: 不要（何も書き込まない）。

### 手順 3: 本番の Supabase にマイグレーションを適用する（依頼者の確認が要る）

事前に ADR 0009 の確認項目 2（SSL の強制を有効にする）と確認項目 3（SQL エディタの履歴、AI 機能の扱い）を Supabase のダッシュボードで確かめる。結果は値を含めずに Issue か ADR に残す。

1. リポジトリ直下で、本番プロジェクトにつなぐ。`<PROJECT-REF>` はダッシュボードの URL にある英数字。

```
npx --yes supabase@3.0.0 link --project-ref <PROJECT-REF>
```

2. 適用する前に、適用されるマイグレーションの一覧を見る。

```
npx --yes supabase@3.0.0 migration list
```

3. 適用する。`postgres` のパスワードを求められたら、パスワード管理ツールから貼り付ける。

```
npx --yes supabase@3.0.0 db push
```

- **`--include-seed` を付けない。** `supabase/config.toml` の seed は E2E 用の架空のデータ（`supabase/seed/test/`）で、本番に入れてはいけない。
- ダッシュボードの SQL エディタでスキーマを手で変えない（.claude/rules/security.md「Supabase」）。

確かめ方:

1. `npx --yes supabase@3.0.0 migration list` で 0001〜0005 が Local と Remote の両方に並ぶ。
2. SQL エディタで `supabase/checks/anon_privileges.sql` と `supabase/checks/batch_writer_privileges.sql` の中身を貼って実行し、どちらも 0 行（I-DB-01、I-DB-18 (10) を本番で確かめる。A-11）。保存済みのスニペットにしない。
3. `select rolcanlogin from pg_roles where rolname = 'batch_writer';` が `false`（パスワードの設定前は login できない。I-DB-18 (3)）。

戻し方: スキーマを戻すときは、戻すためのマイグレーションを書いて PR で入れる（手で戻さない）。適用の途中で失敗した場合は、`migration list` でどこまで入ったかを確かめ、原因を直したマイグレーションで続きを入れる。初回でデータがまだないなら、Supabase のプロジェクトを作り直す方法もある（そのときは URL と anon キーが変わる）。各マイグレーションが 1 トランザクションで適用されるかは確かめていない（§4）。

### 手順 4: batch_writer のパスワードを設定する（依頼者の確認が要る）

スクリプトを使うのが簡単である。`python ops/set_batch_writer_password.py` は、パスワードを作り、SCRAM-SHA-256 の検証子にして本番に設定し、手順 5 の Secret `SUPABASE_BATCH_DB_URL` まで登録する（平文は画面にも SQL にも出ない）。前提は、`npx supabase@3.0.0 link` 済みで、Supabase CLI が対象のプロジェクトの見えるアカウントでログインしていること、`gh` がこのリポジトリに書き込めること、手順 5 の Environment `production` があること。`login` は対話できる端末で実行する（Claude Code の `!` では動かない）。

スクリプトを使わないときは、次の手作業で行う。

1. 自分の PC で、英数字 40 文字のランダムな値を作る（ADR 0009: URL エンコードの要らない英数字、32 文字以上）。

```
python -c "import secrets, string; print(''.join(secrets.choice(string.ascii_letters + string.digits) for _ in range(40)))"
```

2. Supabase の SQL エディタで次を実行する（新しいタブで。保存済みのスニペットにしない。実行後にタブを閉じ、確認項目 3 の結果に従って履歴を消す）。

```sql
alter role batch_writer login password '<作った値>';
```

3. ダッシュボードの Connect → Session pooler の接続文字列を見て、host とポート（5432）を控える。接続文字列は次の形だけにする。クエリ文字列（`?sslmode=` など）を付けない。付けるとバッチが起動時に `validation` で止まる（ADR 0009「TLS」）。

```
postgresql://batch_writer.<PROJECT-REF>:<作った値>@<POOLER-HOST>:5432/postgres
```

この文字列は手順 5 で Environment の Secret に貼り、PC には残さない。

確かめ方: `select rolcanlogin, rolconnlimit from pg_roles where rolname = 'batch_writer';` が `true`、`2`。接続できるかは手順 9 の backfill で分かる。

戻し方: `alter role batch_writer nologin;`（パスワードは残るが login できない）。

### 手順 5: GitHub の Environment と Secret（依頼者の確認が要る）

1. Settings → Environments → New environment。名前は `production`。
2. Deployment branches and tags を「Selected branches and tags」にし、`main` だけを足す。Required reviewers は付けない（付けると schedule の実行が承認待ちで止まる）。
3. Environment secrets に `SUPABASE_BATCH_DB_URL`（手順 4 の文字列）を足す。
4. リポジトリの Secrets に同じ名前がないことを確かめる（W-3）。

確かめ方:

```
gh api repos/takatsu-connect/access-analyzer/environments/production --jq ".deployment_branch_policy"
```

```
gh api repos/takatsu-connect/access-analyzer/environments/production/deployment-branch-policies --jq ".branch_policies[].name"
```

```
gh secret list --repo takatsu-connect/access-analyzer --env production
```

1 つ目が `custom_branch_policies: true`、2 つ目が `main` だけ、3 つ目に `SUPABASE_BATCH_DB_URL` が出る。`gh secret list --repo takatsu-connect/access-analyzer`（リポジトリの Secrets）にこの名前が出ない。

戻し方: Environment の Secret を消す（`gh secret delete SUPABASE_BATCH_DB_URL --repo takatsu-connect/access-analyzer --env production`）か、Environment ごと消す。

Environment のブランチ制限が organization のプランで使えないと分かったら、ここで止めて ADR 0009 の代替（GCP Secret Manager）を親に相談する。

### 手順 6: Vercel のプロジェクトと環境変数（依頼者の確認が要る）

1. Vercel（Hobby）で Add New → Project → GitHub の `takatsu-connect/access-analyzer` を選ぶ。Vercel の GitHub App のインストールでは「Only select repositories」にしてこのリポジトリだけを許可する。
2. 設定:
   - Root Directory: `apps/web`
   - Framework Preset: Next.js
   - Build Command（上書きを有効にする）: `pnpm run build && pnpm run check:build`
     - `pnpm run build` は最初に `.next/cache/fetch-cache` を消す。Vercel は Build Cache を引き継ぐので（Vercel Docs「Deploy Hooks」の Build Cache、2026-11-07 確認）、古いデータのページが混ざるのをこれで防ぐ。
     - `check:build` が失敗すると Build Command が 0 以外で終わり、デプロイは失敗して前のデプロイが残る（ADR 0010 の 7）。
   - Install Command、Output Directory: 既定のまま。
3. Environment Variables に `SUPABASE_URL` と `SUPABASE_ANON_KEY`（Supabase の Project Settings → API）を、Production と Preview の両方に入れる。名前に `NEXT_PUBLIC_` を付けない。
4. Web Analytics、Speed Insights、Toolbar を有効にしない（2026-11-07 の決定）。Settings の該当の項目が無効であることを確かめる。
5. Settings → Git で、fork からの PR のプレビューをビルドしない設定を確かめる（06 §2.4。項目の名前は未確認。§4）。
6. Deploy する。この時点では本番の Supabase にデータがないので、ビルドかその後の検査が失敗しうる。失敗しても、手順 9 の backfill の後の Deploy Hook で作り直されるので進めてよい。

確かめ方: Deployments に main のビルドが出る。ビルドログに `SUPABASE_URL` の値や anon キーが出ていない（件数だけ）。

戻し方: Settings → Advanced → Delete Project。

### 手順 7: Deploy Hook と Standard Protection（依頼者の確認が要る）

1. Vercel の Settings → Git → Deploy Hooks で、名前 `daily-batch`、ブランチ `main` の Hook を作る。表示された URL をコピーする。
2. GitHub の Environment `production` の Secrets に `VERCEL_DEPLOY_HOOK_URL` として貼る。他の場所（リポジトリの Secrets、PC のメモ）に置かない。
3. Vercel の Settings → Deployment Protection で、Vercel Authentication を有効にし、範囲を Standard Protection にする。Standard Protection は本番ドメイン以外のすべてのデプロイを保護する（Vercel Docs「Deployment Protection」、2026-11-07 確認。Hobby でも使える）。
4. Settings → Domains に、本番ドメインとして `<プロジェクト名>.vercel.app` があることを確かめる。

確かめ方:

- `gh secret list --repo takatsu-connect/access-analyzer --env production` に `VERCEL_DEPLOY_HOOK_URL` が出る。
- ログインしていないブラウザ（プライベートウィンドウ）で `https://<プロジェクト名>.vercel.app/` が開き、デプロイごとの URL（Deployments の各行の URL）はログインを求められる。

戻し方: Hook を消す（Settings → Git → Deploy Hooks）。Deployment Protection を元の設定に戻す。

### 手順 8: DAILY_ENABLED と publish_only の試し（依頼者の確認が要る）

1. Settings → Secrets and variables → Actions → Variables → New repository variable。名前 `DAILY_ENABLED`、値 `true`。

```
gh variable set DAILY_ENABLED --body true --repo takatsu-connect/access-analyzer
```

2. Deploy Hook だけを試す。

```
gh workflow run daily.yml --repo takatsu-connect/access-analyzer --ref main -f mode=publish_only
```

確かめ方: `publish_only` のジョブが成功し、`daily` と `backfill` は skipped。Vercel の Deployments に Deploy Hook から始まったビルドが出る。

- この時点から、毎日 JST 17:00 と 18:00 に `daily` が動く。手順 9 を同じ日の 17:00 より前に終えるか、終えるまで次の戻し方で止めておく。

戻し方: `gh variable set DAILY_ENABLED --body false --repo takatsu-connect/access-analyzer`（または変数を消す）。以後の schedule はジョブが skipped になり、失敗のメールも出ない。

### 手順 9: 初回の backfill（依頼者の確認が要る）

- JST 15:30 より後に始める（前日の GA4 のデータがそろってから。03 §2）。JST 17:00 の schedule と重なっても `concurrency` で順番待ちになり、backfill の後の daily は同じ基準日の成功を見て何もせずに終わる。

```
gh workflow run daily.yml --repo takatsu-connect/access-analyzer --ref main -f mode=backfill
```

`from` と `to` は空のまま（`from` は `BACKFILL_START` = 2025-10-08、`to` は前日。03 §10）。

確かめ方:

1. `backfill` のジョブが成功する（見込み 6〜8 分、上限 60 分）。ログに件数、GA4 のトークンの消費と残量、所要時間が出る。行データ、URL、接続文字列が出ていないことを目で確かめる。
2. Supabase の SQL エディタで `select status, failed_step, error_kind, counts from internal.batch_run order by started_at desc limit 1;` が `success`。`counts.ga4_tokens` を 03 §11 の見込み（約 5,200）と比べ、3 倍を超えたら D-01 を開き直す。
3. Vercel に Deploy Hook のビルドが出て成功し、BI の画面の「◯月◯日までのデータ」が前日になる。

失敗したとき: runbook.md §2 の表で `failed_step` と `error_kind` から対処を選ぶ。backfill は冪等なので、原因を直してそのまま再実行してよい。

戻し方: データは backfill の再実行で作り直す。取り込みを止めるときは手順 8 の戻し方。

### 手順 10: A-11 の実機確認（依頼者の確認が要る）

07 A-11 と ADR 0009 の「テスト」の項目を確かめ、結果（値を含めない）を Issue に残す。

| 項目 | 確かめ方 |
| --- | --- |
| pooler に接続でき、TLS が第 1 の基準（verify-full + 固定 CA）で通る | 手順 9 の backfill が成功した（バッチはローカル以外では verify-full でしか接続しない） |
| IPv4 のランナーから届く | 同上（GitHub のホスト型ランナー） |
| `require_auth=scram-sha-256` と `connection limit 2` が pooler 経由で問題ない | 同上 |
| Environment を付けたジョブで WIF が通る（ADR 0009 V-2） | 同上の `GCP に WIF で認証する` のステップが成功 |
| 権限の検査が本番で 0 行 | 手順 3 の確かめ方 2 |
| main 以外のブランチから接続文字列を取れない（W-3） | 下の手順 |

main 以外のブランチからの確認:

1. 一時ブランチ `a11-env-check` を作り、`.github/workflows/a11-env-check.yml` を置いて push する。中身は `workflow_dispatch` だけ、`permissions: contents: read`、`environment: production` のジョブ 1 つで、ステップは `env: { X: ${{ secrets.SUPABASE_BATCH_DB_URL }} }` と `run: test -n "$X"` だけ（値を出力しない）。
2. `gh workflow run a11-env-check.yml --repo takatsu-connect/access-analyzer --ref a11-env-check` で実行する。
3. ジョブが始まる前に、ブランチが Environment の保護の規則で許可されていない旨で失敗することを確かめる。ステップまで進んで成功したら、ブランチ制限が効いていない。すぐに `SUPABASE_BATCH_DB_URL` を runbook.md §9 の順で無効化し、手順 5 をやり直す。
4. ブランチを消す（`git push origin --delete a11-env-check`）。このブランチでは ci.yml の static ジョブが S-10 の違反で失敗するが、一時的なので構わない。

あわせて、06_acceptance.md の目視と照合（07 §8）を本番の画面で行う。本番の BI と対象サイトに、スキャンや負荷試験をしない（NFR-72）。応答ヘッダの確認はブラウザの開発者ツールで見る。

### 手順 11: JSON 鍵と一時的なロールを消す（依頼者の確認が要る）

1. initial_setup.md §2 の手順 7 で、SA の `USER_MANAGED` の鍵を消し、ローカルの `credentials/` の JSON を消す。
2. GCP プロジェクトの所有者アカウントに付けた、SA の「サービス アカウント トークン作成者」を、ローカルで GA4 を確かめる予定がなければ外す（initial_setup.md §2 の前提）。

確かめ方: `gcloud iam service-accounts keys list --iam-account=sa-takatsu-connect-ga4@affable-enigma-513514-q8.iam.gserviceaccount.com --managed-by=user` が空。

戻し方: なし（鍵は作り直さない。WIF だけを使う）。

## 2. 通常の更新

| 変えるもの | やり方 | 本番に出るまで |
| --- | --- | --- |
| BI（`apps/web`） | PR を作り、`ci.yml` が通ってから main に merge する | merge の push で Vercel が main をビルドする。データは前回のまま |
| バッチ（`apps/batch`） | 同上 | 次の schedule（JST 17:00）から新しいコードで動く。すぐ確かめるなら `mode=daily` を手動で実行（同じ基準日の成功があれば何もしない） |
| 画面の文言、設定値（`ui-text.ts`、`config.ts`） | 同上 | BI は push でビルドされる。バッチの設定値は次の実行から |
| マイグレーション（`supabase/migrations`） | PR で入れ、CI の I-DB を通し、merge の後に手順 3 の `db push` を依頼者が実行する（依頼者の確認が要る） | `db push` の後の次のバッチから |
| 依存（Dependabot の PR） | runbook.md §12 | merge の後 |
| ワークフロー（`.github/workflows/`） | PR で入れ、security-auditor の監査を受けてから merge する（CLAUDE.md） | merge の後 |

- main への直接の push も許可されている（initial_setup.md §1）。そのとき CI は push の後に動き、Vercel のビルドと同時に進むので、CI が落ちたコードも BI に出る。BI とバッチの変更は PR にすることを勧める。
- 致命的・高の脆弱性が `deps-audit` に出ている間は merge しない（06 §10）。

## 3. ロールバック

| 何が壊れたか | 戻し方 |
| --- | --- |
| BI の表示（デプロイ） | Vercel の Deployments で、前の正常な本番デプロイを選び、本番に戻す（Instant Rollback / Promote。Hobby で使える範囲は未確認。§4）。その後、原因のコミットを `git revert` して push する（`push --force` はルールセットで禁止） |
| BI のビルドの失敗 | 何もしなくても前のデプロイが残る。直した後に `publish_only` で作り直す（runbook.md §3） |
| バッチのコード | `git revert` して push する。次の実行から戻る。急ぐなら `DAILY_ENABLED=false` で止めてから戻す |
| データ（誤った集計が書かれた） | コードを直してから `backfill`（全期間を取り直す。runbook.md §4） |
| マイグレーション | 戻すためのマイグレーションを PR で入れ、`db push`（手で戻さない） |
| 秘密が漏れた | runbook.md §9 |

## 4. 確認が要ること

1. Supabase CLI 3.0.0 が npm にあり、公開から 2 週間たっているか。`supabase db push` の各マイグレーションのトランザクションの扱い。
2. Environment のブランチ制限が organization のプランで使えるか（ADR 0009 確認項目 4）。手順 5 で分かる。
3. Vercel の Git の設定で、fork の PR のプレビューを止める項目の名前と既定値（06 §2.4）。
4. Vercel の Hobby で、前の本番デプロイへ戻す操作（Instant Rollback）がどこまで使えるか。旧デプロイの削除の手順（06 §2.4）を runbook.md §9 に書いたが、画面の操作は未確認。
5. データが空の本番の Supabase で BI のビルドと `check:build` が通るか（手順 6 の 6）。通らない場合でも手順 9 で解消する見込み。
6. Vercel のビルドが `packageManager: pnpm@10.6.5` を使うか（corepack の要否）。
