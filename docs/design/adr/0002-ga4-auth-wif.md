# ADR 0002: GA4 の認証は Workload Identity Federation（サービスアカウントを介する方式）

- 状態: 承認済み（依頼者の決定を記録。2026-11-03）
- 更新日: 2026-11-03
- 変更履歴: 2026-11-03: 設計レビュー（audits/2026-11-03-design-review.md）の L-10（属性条件に repository_id を加える案）を「結果」に追記
- 関係: NFR-41、NFR-45、DS-01（03_data_sources.md §2.3）、docs/operations/initial_setup.md §2、.claude/rules/security.md「秘密情報」

## 文脈

- 日次バッチ（GitHub Actions）が GA4 Data API を呼ぶには、GA4 プロパティの閲覧権限を持つ Google の身元が要る。
- リポジトリは public。長生きする鍵（サービスアカウントの JSON 鍵）をどこかに置くと、漏れたときに GA4 のデータ（集計値だが、伏せる前の細かい値も読める）に第三者が恒久的にアクセスできる。
- GA4 の権限は Google アカウントかサービスアカウント（SA）のメールアドレスにしか付けられない。
- GitHub Actions は実行ごとに短命の OIDC トークンを発行でき、Google Cloud の Workload Identity Federation（WIF）はそれを検証して Google の資格情報に交換できる。

## 選択肢

| 案 | 仕組み | 長生きする秘密 | 問題 |
| --- | --- | --- | --- |
| A（採用） | WIF、SA を介する方式。Actions の OIDC トークン → STS で連携トークン → SA の 1 時間有効なアクセストークン | なし | SA になりすます権限の付与先（属性条件）を正しく絞る必要がある。GCP 側の設定手順が 7 ステップ |
| B | SA の JSON 鍵を Actions Secrets に置く | SA の鍵（無期限） | 漏れたら無効化まで使われる。鍵のローテーションを人手で回す。security.md「JSON 鍵を作らない」に反する |
| C | 直接 WIF（SA を介さず、連携 ID に直接権限を付ける。Google の推奨） | なし | GA4 のプロパティ権限は Google アカウントか SA のメールにしか付けられず、連携 ID（principalSet）に直接付けられない。GA4 には使えない |
| D | OAuth のユーザー資格情報（リフレッシュトークン）を Secrets に置く | リフレッシュトークン（長期） | 個人アカウントに依存。トークンの失効・再同意が運用負荷。B と同じ漏えいの問題 |

## 決定

案 A。

- GCP 側: プール `github`、プロバイダ `access-analyzer`（発行者 `https://token.actions.githubusercontent.com`）、属性マッピングで `repository` と `ref` を取り、属性条件 `assertion.repository == 'takatsu-connect/access-analyzer' && assertion.ref == 'refs/heads/main'`。SA `sa-takatsu-connect-ga4@...` に `roles/iam.workloadIdentityUser` を `principalSet://.../attribute.repository/takatsu-connect/access-analyzer` へ付与。SA の権限は GA4 プロパティの閲覧者だけ（GCP のロールなし）。
- GitHub 側: Secrets に `GCP_WORKLOAD_IDENTITY_PROVIDER`、`GCP_SERVICE_ACCOUNT`、`GA4_PROPERTY_ID`。ワークフローは `permissions: id-token: write` を認証するジョブだけに付け、`google-github-actions/auth` v3（commit SHA 固定）で認証する。認証アクションが資格情報ファイルを書き `GOOGLE_APPLICATION_CREDENTIALS` を設定するので、`@google-analytics/data` は ADC で拾う。
- 既存の JSON 鍵（ローカル確認用、`credentials/`）は WIF の動作確認後に GCP 側とローカルの両方で削除する。ローカル確認用に付けた「サービス アカウント トークン作成者」ロールも不要なら外す。
- `sub` の新形式（`repo:owner@id/repo@id:ref:...`）に依存せず、`repository` と `ref` の主張で判定する。

## 結果

- 良い点: 長生きする鍵がどこにも存在しない。トークンは 1 時間で失効し、main ブランチの Actions からしか取れない。fork や他ブランチからは SA になりすませない。鍵のローテーションが不要。
- 引き受ける点: GCP 側の初期設定（initial_setup.md §2）はデプロイ工程で依頼者が実行する。属性条件を誤ると他リポジトリから使えてしまうので、設定後に security-auditor が条件を確認する。
- 追記（2026-11-03、設計レビュー L-10）: 属性条件に `assertion.repository_id == '<リポジトリの数値 ID>'`（または `assertion.repository_owner_id`）を加え、属性マッピングに `attribute.repository_id = assertion.repository_id` を追加する。リポジトリ名の変更・移管・同名の再作成で `repository` の文字列が他者のものを指す事態に備える。数値 ID は `gh api repos/takatsu-connect/access-analyzer --jq .id` で取れる（秘密ではないが文書には書かない）。GCP 側の作業はデプロイ工程で、initial_setup.md の手順は親が直す。バッチの 1 回の実行は 1 時間以内に収める（通常 2〜4 分、バックフィル 10 分未満）。
- ローカル開発: `gcloud auth application-default login` の ADC（開発者個人の Google アカウント。GA4 の閲覧者を付けてもらう）で動かし、JSON 鍵は作らない。
