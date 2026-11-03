# 初期設定の記録: GitHub リポジトリと GCP の認証

- 状態: 草案
- 更新日: 2026-11-03

リポジトリと外部サービスに対して行った、または行う予定の初期設定を記録する。コードの構築より前に決まった事項なので、デプロイ工程で docs/operations/ の各文書が整ったら、そちらへ内容を移してこの文書は参照だけにする。規則の根拠は .claude/rules/security.md、指摘の出所は docs/security/audits/2026-11-03-initial.md。

## 1. GitHub リポジトリの設定（2026-11-03 に適用済み）

### 適用した設定

| 項目 | 値 | 理由 |
| --- | --- | --- |
| ルールセット「main: force push と削除の禁止」 | 対象は既定ブランチ。`deletion` と `non_fast_forward` を禁止。bypass なし | main に載ったものが日次バッチの権限で動くため、main の完全性を守る。直接 push は維持する（git の運用ルールどおり） |
| Actions の実行許可 | `allowed_actions: selected`。GitHub 製、verified creators、`google-github-actions/*` | 第三者 Action の乗っ取りで Secrets や OIDC トークンが漏れる経路を狭める |
| Action の SHA 固定 | `sha_pinning_required: true` | タグの差し替えによる攻撃を防ぐ。GitHub 製の Action も SHA で書く必要がある |
| fork からの PR のワークフロー承認 | `all_external_contributors` | 外部からの PR で勝手にワークフローが動かない |

適用前から有効だったもの: secret scanning、push protection、Dependabot alerts、Dependabot security updates、`GITHUB_TOKEN` の既定権限 `read`。

### 影響と注意

- すべての Action を commit SHA で書く。`uses: actions/checkout@v4` は拒否される。SHA の後ろにコメントでバージョンを書く。
- main への force push は管理者でもできない。やむを得ず必要なときは、Settings → Rules でルールセットを一時的に無効化し、終わったら戻す。
- 許可リストにない Action を使うときは、`patterns_allowed` に追加する（下の再現コマンドを編集して再実行）。

### 再現用のコマンド（`gh` で実行）

```
gh api -X POST repos/takatsu-connect/access-analyzer/rulesets --input ruleset.json
```

ruleset.json の内容:

```json
{
  "name": "main: force push と削除の禁止",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [ { "type": "deletion" }, { "type": "non_fast_forward" } ]
}
```

```
gh api -X PUT repos/takatsu-connect/access-analyzer/actions/permissions -F enabled=true -f allowed_actions=selected -F sha_pinning_required=true
```

```
gh api -X PUT repos/takatsu-connect/access-analyzer/actions/permissions/selected-actions -F github_owned_allowed=true -F verified_allowed=true -f "patterns_allowed[]=google-github-actions/*"
```

```
gh api -X PUT repos/takatsu-connect/access-analyzer/actions/permissions/fork-pr-contributor-approval -f approval_policy=all_external_contributors
```

確認は同じパスを GET する。`rulesets`、`actions/permissions`、`actions/permissions/selected-actions`、`actions/permissions/fork-pr-contributor-approval`。

### 依頼者が GitHub の画面で行うこと

- organization `takatsu-connect` の Settings → Authentication security で「Require two-factor authentication」を有効にする（2026-11-03 時点で未設定）。有効にすると、2 要素認証を設定していないメンバーは organization から外れるので、先に全員の設定を確認する。API からは変更できない。
- 任意: リポジトリの Settings → Code security で secret scanning の non-provider patterns と validity checks を有効にする。public リポジトリでは無料。

## 2. GCP: GA4 認証を Workload Identity Federation にする（未実施）

実施のタイミングは、デプロイ工程の最初、最初のワークフローを置く前。

### 前提（2026-11-03 時点）

- GCP プロジェクト: `affable-enigma-513514-q8`
- サービスアカウント（SA）: `sa-takatsu-connect-ga4@affable-enigma-513514-q8.iam.gserviceaccount.com`。GA4 プロパティの閲覧者を付与済み。GCP プロジェクト側のロールは不要で、付いていたら外す。
- SA の JSON 鍵が 1 つ作られ、ローカルの `credentials/`（.gitignore 済み、追跡も履歴もなし）にある。WIF の動作確認後に GCP 側とローカルの両方を削除する。
- GA4 のプロパティ ID（数字）は `credentials/GA4_PropertyID.txt` に控えてある。測定 ID `G-79CFGF83VT` とは別物で、Data API はプロパティ ID を使う。
- 2026-11-03: 手順 1 の API 有効化は依頼者が実行済み（iam、cloudresourcemanager、iamcredentials、sts、analyticsdata。analyticsadmin は以前から有効）。GA4 の設定と規模を確認するため、GCP プロジェクトの所有者アカウントに SA の「サービス アカウント トークン作成者」ロールを付与し、ローカルから読み取り専用で借用した。この付与はローカル確認用で、WIF 移行後に不要なら外す（運用で使うなら docs/operations/ の権限一覧に載せる）。
- リポジトリは 2026 年 7 月 15 日より後に作られたため、OIDC トークンの `sub` は新形式 `repo:takatsu-connect@<所有者ID>/access-analyzer@<リポジトリID>:ref:refs/heads/main`。下の手順は `sub` に依存せず、`repository` と `ref` の主張で判定する。

### 仕組み

GitHub Actions のジョブは実行のたびに GitHub から短命の OIDC トークンを受け取る。ジョブはそれを Google の Security Token Service に渡し、Google は発行者と属性条件を検証して連携トークンを返す。連携トークンで SA の 1 時間だけ有効なアクセストークンを発行してもらい、GA4 Data API を呼ぶ。長生きする鍵はどこにも存在しない。Google は SA を介さない「直接 WIF」を推奨しているが、GA4 の権限は Google アカウントか SA のメールアドレスにしか付けられないので、SA を介する方式を使う。

### GCP 側の手順

`PROJECT_NUMBER` は手順 2 の出力で置き換える。各コマンドは 1 行で、PowerShell でも bash でも動く。

1. API を有効にする。

```
gcloud services enable iam.googleapis.com cloudresourcemanager.googleapis.com iamcredentials.googleapis.com sts.googleapis.com analyticsdata.googleapis.com --project=affable-enigma-513514-q8
```

2. プロジェクト番号を控える。

```
gcloud projects describe affable-enigma-513514-q8 --format="value(projectNumber)"
```

3. Workload Identity プールを作る。

```
gcloud iam workload-identity-pools create github --project=affable-enigma-513514-q8 --location=global --display-name="GitHub Actions Pool"
```

4. GitHub を発行者とするプロバイダを作る。`attribute-condition` が入口の門番で、この repo の main からのトークンだけを通す。

```
gcloud iam workload-identity-pools providers create-oidc access-analyzer --project=affable-enigma-513514-q8 --location=global --workload-identity-pool=github --display-name="takatsu-connect/access-analyzer" --issuer-uri="https://token.actions.githubusercontent.com" --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_id=assertion.repository_id,attribute.repository_owner=assertion.repository_owner,attribute.ref=assertion.ref" --attribute-condition="assertion.repository == 'takatsu-connect/access-analyzer' && assertion.repository_id == '1443616803' && assertion.ref == 'refs/heads/main'"
```

`repository_id`（このリポジトリの数値 ID。2026-11-03 に `gh api` で確認）も条件に含める。リポジトリ名の変更や移管で名前が変わっても、別のリポジトリが同じ名前を取って条件を満たすことを防ぐ（設計レビュー L-10）。

5. この repo からの連携 ID に、SA になりすます権限を与える。

```
gcloud iam service-accounts add-iam-policy-binding sa-takatsu-connect-ga4@affable-enigma-513514-q8.iam.gserviceaccount.com --project=affable-enigma-513514-q8 --role=roles/iam.workloadIdentityUser --member="principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/takatsu-connect/access-analyzer"
```

6. プロバイダのリソース名を控える。GitHub Secrets に入れる。

```
gcloud iam workload-identity-pools providers describe access-analyzer --project=affable-enigma-513514-q8 --location=global --workload-identity-pool=github --format="value(name)"
```

7. 動作確認が済んだら JSON 鍵を消す。`USER_MANAGED` の鍵 ID を確認して削除し、ローカルの `credentials/` の JSON も削除する。

```
gcloud iam service-accounts keys list --iam-account=sa-takatsu-connect-ga4@affable-enigma-513514-q8.iam.gserviceaccount.com --managed-by=user
```

```
gcloud iam service-accounts keys delete <鍵ID> --iam-account=sa-takatsu-connect-ga4@affable-enigma-513514-q8.iam.gserviceaccount.com
```

### GitHub 側の手順

Settings → Secrets and variables → Actions に次を登録する。秘密でない値もあるが、公開される YAML に埋め込まないために Secrets に置く。

| 名前 | 値 |
| --- | --- |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | 手順 6 の出力。`projects/<番号>/locations/global/workloadIdentityPools/github/providers/access-analyzer` |
| `GCP_SERVICE_ACCOUNT` | `sa-takatsu-connect-ga4@affable-enigma-513514-q8.iam.gserviceaccount.com` |
| `GA4_PROPERTY_ID` | GA4 のプロパティ ID（数字） |

ワークフローの認証ステップ。SHA 固定が必須なので、置く時点で `google-github-actions/auth` v3 系の最新リリースの commit SHA を調べて書く。認証アクションが資格情報ファイルを書いて環境変数を設定するので、Google のクライアントライブラリは何もしなくてもそれを拾う。

```yaml
permissions:
  contents: read
  id-token: write

steps:
  - uses: actions/checkout@<SHA>  # v4
  - id: auth
    uses: google-github-actions/auth@<SHA>  # v3
    with:
      workload_identity_provider: ${{ secrets.GCP_WORKLOAD_IDENTITY_PROVIDER }}
      service_account: ${{ secrets.GCP_SERVICE_ACCOUNT }}
```

### 動作確認

認証ステップに `token_format: access_token` を足すと `steps.auth.outputs.access_token` が使えるので、同じジョブで Data API を 1 回叩く。WIF、GA4 の権限、API の有効化を一度に確かめられる。直近 7 日の PV が JSON で返れば成功。403 なら GA4 側の権限か手順 1 の API 有効化が抜けている。

```yaml
  - run: |
      curl -sS -X POST -H "Authorization: Bearer ${{ steps.auth.outputs.access_token }}" -H "Content-Type: application/json" -d '{"dateRanges":[{"startDate":"7daysAgo","endDate":"yesterday"}],"metrics":[{"name":"screenPageViews"}]}' "https://analyticsdata.googleapis.com/v1beta/properties/${{ secrets.GA4_PROPERTY_ID }}:runReport"
```

### 出典（2026-11-03 確認）

- google-github-actions/auth README（v3、SA を介する WIF の設定手順と YAML）
- GitHub Docs「OpenID Connect reference」（新形式の `sub`、`repository` と `ref` の主張）
- GitHub Docs「Configuring OpenID Connect in Google Cloud Platform」（`id-token: write`、属性条件を必ず付けること）
