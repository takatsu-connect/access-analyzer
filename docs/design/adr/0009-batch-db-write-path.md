# ADR 0009: バッチの書き込み経路（psycopg、shared pooler の session mode、専用ロール）

- 状態: 条件付き承認の条件を反映済み。残る確認は実装着手前（docs/security/audits/2026-11-03-write-path-review.md。残る確認は本文「実装着手前の確認項目」）
- 更新日: 2026-11-03
- 関係: 02_data_model.md §1・§6、03_data_pipeline.md §7・§14・§15、06_security.md §2.3・§3・§9、ADR 0004、ADR 0005、ADR 0007、NFR-22、NFR-40、NFR-43、NFR-44、NFR-45
- 変更履歴:
  - 2026-11-03: 新規。ADR 0007 の「supabase-js の upsert、直接接続は使わない」を置き換える
  - 2026-11-03: 書き込み経路の監査（以下「経路監査」。docs/security/audits/2026-11-03-write-path-review.md）の W-1〜W-4、W-8、L-1〜L-4、L-7 を反映。TLS の 3 段階の基準、接続設定のコード固定、Environment への Secret の移動、`nologin` でのロール作成、漏えい時の影響の書き直し、実装着手前の確認項目

## 文脈

- 内部表は `internal` スキーマにあり、Exposed schemas に含めない（設計レビュー M-7）。したがって PostgREST（supabase クライアント + service role キー）では書けない前提で扱う。
- バッチは GitHub Actions のランナーで動く。接続先は IPv4 で届く必要があるものとして扱う。
- バッチは除外リストを読まない（ADR 0005）。これまではコードレビューで守っていた。

事実票（2026-11-03、supabase.com/docs で親が確認）:

- direct（5432）は Free では IPv6 のみ。shared pooler の session（5432）と transaction（6543）は全プラン IPv4。
- session の形式は `postgresql://[ROLE].[PROJECT-REF]:[PASSWORD]@[POOLER-HOST]:5432/postgres`。カスタムロールは pooler で利用でき、ユーザー名は `[ROLE].[PROJECT-REF]`。POOLER-HOST は Connect ダイアログからコピーする。
- 独自スキーマを data API で使うには Exposed schemas への追加が要る。未公開スキーマに service_role が届くかは文書に記載なし。

psycopg の事実（2026-11-03、context7 で psycopg のドキュメントとソースを確認）:

- コネクションプールの中間層は、明示がない限り prepared statements と互換がないものとして扱い、`prepare_threshold` を `None` にする。
- `psycopg.errors.Error` は `sqlstate`、`diag`、`pgconn`、`pgresult` を持つ。SQLSTATE の class 08、28、53、57 などは `OperationalError` になる。

## 選択肢

### (1) 経路

| 案 | 内容 | 評価 |
| --- | --- | --- |
| A（採用） | psycopg で shared pooler の session mode に接続し、専用ロールで書く | IPv4 で届く。ロールで権限を絞れる。書き込みを 1 トランザクションにできる。接続文字列という秘密が 1 つ要る |
| B | `internal` を Exposed schemas に足し、supabase クライアント + service role キーで書く | M-7 の多層防御を崩す。service role キーは権限が広く、除外リストの不読をロールで強制できない |
| C | `public` に `security definer` の関数を置き、service role から rpc で呼ぶ | 公開面に関数が増える（L-4 の方針と逆行）。数万行の受け渡しにも向かない |
| D | direct（5432）に接続 | Free では IPv6 のみ。不採用 |

### (2) pooler のモード

| 案 | 評価 |
| --- | --- |
| session（5432、採用） | 接続している間は 1 つのサーバー接続を占有するので、1 回のバッチ・1 接続の使い方に合う。`set local` とトランザクションをそのまま使える |
| transaction（6543） | IPv4 で届くが、短い接続を多数さばく用途の方式で、この規模では利点がない |

### (3) 接続するロール

| 案 | 評価 |
| --- | --- |
| 専用ロール `batch_writer`（採用） | `internal` の必要な表だけに select / insert / update / delete。`excluded_author` と `pub_*` に権限なし。除外リストの不読をロールで強制できる |
| `postgres` | 全権限。接続文字列の漏えいが全体の侵害になる。不採用 |

### (4) RLS の扱い

| 案 | 評価 |
| --- | --- |
| 表ごとにポリシーを作る（採用） | `create policy batch_writer_all on internal.<表> for all to batch_writer using (true) with check (true)`。マイグレーションに残り、検査できる。`excluded_author` にはポリシーも grant も作らないので 2 重に閉じる。表を足すたびに書く手間は、権限の付け忘れが fail-closed になる利点と引き換えに受け入れる |
| `bypassrls` を付ける | 記述は短い。ただしロール全体に効く属性で、表ごとの統制にならない。Supabase で付与できるかも事実票にない。不採用 |
| 内部表の RLS を切る | security.md「すべての表で RLS を有効にする」に反する。不採用 |

## 比較（経路）

| 観点 | A: psycopg + 専用ロール | B: PostgREST + service role | C: rpc |
| --- | --- | --- | --- |
| `internal` の非公開（M-7） | 保てる | 崩れる | 保てるが `public` に関数が増える |
| 除外リストの不読をロールで強制 | できる | できない | 関数の中身次第 |
| 秘密が漏れたときの影響 | 内部表の読み書き。完全性を失う。除外リストの表は直接読めない。ただし書き込みで除外を崩せ、差分で推定もできる（「漏えい時の影響」） | 全表 | 全表 |
| 書き込みの原子性 | 1 トランザクション | リクエストごと | 関数ごと |
| 秘密のローテーション | `alter role ... password` と Secret の更新 | JWT シークレットの更新 | 同左 |
| 新しい秘密 | 接続文字列 1 つ（service role キーを置き換える） | なし | なし |
| ログへの漏えいの経路 | 例外が host、ユーザー名、行の値を含みうる（03 §14 で閉じる） | エラーが URL、表名を含みうる | 同左 |

## 決定

(1) A、(2) session、(3) `batch_writer`、(4) 表ごとのポリシー。

- 接続文字列は Secret `SUPABASE_BATCH_DB_URL`。main だけを許可した GitHub Environment の Secret に置く（「接続文字列のブランチへの束縛」）。`SUPABASE_SERVICE_ROLE_KEY` はどこにも置かない（Actions Secrets、Vercel、ローカルのいずれにも）。
- `service_role` には `internal` の権限を与えない（前回の N-3 の grant を取り消す）。使う場所がなくなったため。
- Vercel のビルドは anon キーで `pub_*` を読む。変更しない。
- 接続文字列は `daily` と `backfill` の取得・書き込みのステップだけに渡す。`publish_only` のステップには渡さない。
- TLS が第 1 か第 2 の基準（「TLS」）で成立するまで、本番に接続しない。

## 漏えい時の影響

`SUPABASE_BATCH_DB_URL` が漏れたときの影響を、次のように扱う。「除外リストは漏れない」とは書かない。

- 除外リストの表は直接読めない。ただし書き込みで除外を崩せ、差分で推定もできる。
- 差分: `internal.wp_author` と `pub_author` の差で除外著者が分かる（公開情報だけでも推測できることは NFR-22 が認めている）。`pg_stat_all_tables` や `pg_class` からは件数も読める可能性がある（要確認 V-4）。
- 書き込みによる無効化: `wp_author` や `wp_post` の slug を書き換えると `not exists` を通り抜け、次回のビルドで除外著者の数値が公開される。再取得の範囲（直近 7 日）より古い改ざんは、日次バッチでは直らない。
- 容量: Free の容量を埋める攻撃は、ロールの設定では防げない。
- 対処の順序は 06 §3 に書く。

## 実装方式

### ロールと権限

SQL の全文は 02 §6。要点:

- マイグレーションで `create role batch_writer nologin noinherit nobypassrls` として作る（経路監査 L-1）。パスワードは書かない。有効にするときは、運用担当が Supabase の SQL エディタで `alter role batch_writer login password '...'` を実行する（docs/operations/ に手順を書く。保存済みスニペットに残さない）。ローテーションは `alter role batch_writer with password '...'`。パスワードは URL エンコードが不要な英数字のみ、32 文字以上のランダム値にする。
- 手順を実行するまでは `nologin` なので、「パスワードなしの login ロールを pooler が拒否するか」に安全性が依存しない。
- `if not exists` は既存のロールの属性を直さない。そこでマイグレーションは続けて `alter role` で属性を揃え、残りの属性は検査で確かめる（W-8。02 §6）。
- `alter role ... password` の平文は、SQL エディタの履歴やサーバーログに残る可能性がある（経路監査 L-4。要確認 V-5）。見られるのはダッシュボードの権限者なので影響は小さい。SCRAM の verifier を事前に作って渡せるかを、pooler との互換を含めて確かめる（確認項目 3、V-5）。確かめるまでは平文の手順を使い、実行後に履歴の扱いを確認項目 3 の結果に従う。
- `alter role batch_writer connection limit 2` と、ロールの既定の `statement_timeout`（120 秒）を置く（経路監査 L-3）。接続の上限は同時接続 1 本の設計に余裕を 1 本足した値。pooler のサーバー接続の持ち方によって足りないときは A-11 で分かるので、そこで見直す。既定の `statement_timeout` は通常の実行の歯止めで、接続を持つ者は `set` で変えられる。悪用時の歯止めに数えない。
- 権限は表の名前を列挙して与える。`all tables in schema` と `alter default privileges` は使わない。`excluded_author` と、それを参照する `internal.article_cumulative`、`internal.benchmark_curve` まで届いてしまうため。表を足すときは grant とポリシーを書かないと書けない。
- `batch_run` には delete を与えない（経路監査 L-2。保持期間の削除がなく、痕跡を消せないようにする。02 §6）。

### 接続文字列のブランチへの束縛（W-3）

- WIF は main に限定されるが、リポジトリの Secret は全ブランチのワークフローから使える。書き込み権限を持つアカウントや PAT が侵害されると、別ブランチのワークフローを `workflow_dispatch` で実行して接続文字列を取得でき、main のレビューを経ない。
- 対策: main だけを許可した GitHub Environment（名前は `production`）の Secret に `SUPABASE_BATCH_DB_URL` と `VERCEL_DEPLOY_HOOK_URL` を移す。`daily.yml` のジョブに `environment: production` を付ける。リポジトリの Secret に同名の値を残さない。
- 可否の確認: public リポジトリと organization のプランで Environment とブランチ制限が使えるかは、実装前に親が確認する（確認項目 4）。
- 使えない場合の代替: GCP Secret Manager に置き、main に限定した WIF（06 §2.2）の下で実行時に取得する。ブランチの束縛は WIF の属性条件で得られる。代わりに SA の権限（GA4 閲覧者だけ）に対象の Secret だけの読み取りを足すことになり、GCP への依存が増える。Secret Manager の料金と権限の粒度、取得に使う Action は確認していない（要確認 V-3）。採るときはこの ADR を改訂し、security-auditor の再確認を受ける。

### 接続

- `psycopg.connect(url, prepare_threshold=None, connect_timeout=10, autocommit=False, sslmode=..., sslrootcert=...)`。TLS の引数は下の「TLS」のとおりコードから渡す。`psycopg.connect` を呼ぶのは 1 か所（`apps/batch/src/takatsu_batch/db.py`）だけにする。
- 接続は工程ごとに開いて閉じる（preflight、derive の読み出し、write、完了記録）。GA4 と WP を待つ間は接続を持たない。同時に開く接続は 1 本だけ。
- 表名はすべて `internal.<表>` と修飾して書き、`search_path` に依存しない。
- 書き込み（工程 6）は 1 トランザクション。先頭で `set local statement_timeout = '120s'`。途中で失敗すればロールバックされるので、BI のビルドが半端な状態を読まない。これはクライアント側の設定で、悪用時の歯止めではない（経路監査 L-3）。

### TLS

接続文字列という Secret に TLS の設定を頼らない。`sslmode` を接続文字列に頼ると、Secret の内容次第で検査を回避できる（libpq の URI は `?host=` が前の host を上書きする。要確認 V-1。素朴な解析では `localhost` の例外を回避できる）。

#### 基準（3 段階）

| 段階 | 設定 | 扱い |
| --- | --- | --- |
| 第 1 | `verify-full` + 固定した CA | 目標。これを最初に試す |
| 第 2 | `verify-ca` + 固定した CA | CA が Supabase 専用と確かめられた場合に限り、この ADR に残余リスク（host 名を検証しない）を書いて認める |
| 第 3 | `require` | 本レビューでは認めない。依頼者が ADR でリスクを受容し再監査を通すまで本番に接続しない |

下げるときに黙って下げない。第 3 が認められない理由: `require` に下げた状態で経路上の能動的な攻撃者が割り込むと、内部表の読み書きができる。サーバーが平文認証を要求すれば libpq はパスワードを送る可能性がある（要確認 V-1）。

#### コードでの固定（W-1 (a)(b)）

- `sslmode` と `sslrootcert` は `psycopg.connect` のキーワードでコードから渡す。値は `config.py` の定数で、変更はコミットに残る。`sslmode` の定数の型は `Literal["verify-full", "verify-ca"]` にし、`require` を型の上で持てないようにする。第 3 を受容した場合だけ、ADR の改訂と一緒に型を変える。
- CA は `apps/batch/certs/` に固定する（秘密ではない）。`sslrootcert=system` に頼らない（要確認 V-1）。
- 接続文字列（`SUPABASE_BATCH_DB_URL`）に TLS の設定を書かない。形式は `postgresql://batch_writer.[PROJECT-REF]:[PASSWORD]@[POOLER-HOST]:5432/postgres` だけにする。
- `env.py` は起動時に、`psycopg.conninfo.conninfo_to_dict` で解析した実効値を検査する（解析結果が実際の接続と同じ値になることは要確認 V-1）。次のどれかに当たれば `validation` で失敗する。
  - キーが `host`、`port`、`user`、`password`、`dbname` の許可リストの外にある（`sslmode`、`sslrootcert`、`hostaddr`、`service`、`passfile` などを含む）。
  - `host` が空、複数（カンマ区切り）、または `/` で始まる。
- `host` の実効値が `localhost` / `127.0.0.1` のときだけ、ローカルの `supabase start` への接続として TLS なしで接続する。それ以外はすべて固定の TLS 設定で接続する。`hostaddr` は上の許可リストで拒否するので、`host` だけローカルに見せて別の宛先へ接続する形を取れない。ワークフローに `PG*` の環境変数を設定しない。
- libpq 16 以上なら `require_auth=scram-sha-256` を足す（要確認 V-1。pooler の対応は A-11 で確認。対応していないと分かったら外し、その事実をこの ADR に書く）。`psycopg-binary` は同梱の libpq に依存するので、実装時に版を確かめる（V-1）。

#### 実装着手前の作業（W-1 (c)）

実装に入る前に、認証情報なしで証明書の鎖と SAN を確かめる（確認項目 1）。結果に応じて基準の段階を決め、この ADR に記録する。第 1 か第 2 で成立するまで本番に接続しない。

途中経過（2026-11-04、認証情報なしの `openssl s_client` で確認）: TLS 1.3 で接続できた。サーバー証明書の SAN は `*.pooler.supabase.com` と `*.pooler.supabase.co` で、host 名と合う。鎖は Supabase Intermediate 2021 CA から Supabase Root 2021 CA（自己署名）で、公開の CA ではない。証明書の有効期限は 2030-03-11。ダッシュボードから取得した CA（Supabase Root 2021 CA、SHA-256 指紋 `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`、有効期限 2031-04-26）で、鎖と host 名の検証が通った（`Verification: OK`）。したがって基準は第 1（verify-full + 固定した CA）とする。CA の有効期限を運用手順に控える。ただしこの確認は openssl によるもので、psycopg からの接続、認証、Actions のランナーからの到達は未確認（A-11）。SSL の強制は公式文書（supabase.com/docs/guides/platform/ssl-enforcement、2026-11-04 確認）によると shared pooler にも効く。

#### CA の失効と交換

CA の失効や交換が起きると、接続は TLS のエラーで失敗し、`sqlstate` のない `OperationalError` として `network` に分類される（03 §14）。ログだけでは一時的な障害と区別できないので、docs/operations/ の手順書に切り分けを書く: 連続して失敗したら確認項目 1 のコマンドで現在の鎖を確かめ、`apps/batch/certs/` の CA で検証できなければ CA を差し替える。証明書の確認で分かった CA の有効期限も手順書に控える。

### ログ

03 §14・§15。`str(e)`、`e.diag`、`e.pgconn`、`e.pgresult` を使わず、例外の型と `sqlstate` だけで分類する。

### テスト

- 07 I-DB-18: `batch_writer` の grant とポリシーが許可リストと完全に一致し、`excluded_author` と `pub_*` には読めない。スキーマの権限、関数とシーケンスの grant、ロールの所属まで見る（W-8）。同じ検査をマイグレーション末尾と A-11 の本番確認にも置く。
- 07 U-30: 接続設定の検査（`?host=` の上書き、`hostaddr`、複数 host、TLS 設定を含む接続文字列を拒否し、キーワードで固定した値が渡る）。
- 07 I-B-11: psycopg の例外の内容がログに出ない。
- 07 S-10: `daily.yml` のジョブの `environment:` を検査する。
- 07 A-11: 初回公開前に、実際の pooler に接続できること、TLS が採用した基準（第 1 か第 2）で通ること、IPv4 のランナーから届くこと、main 以外のブランチから接続文字列を取れないことを確認する。CI のローカル環境には pooler がないため自動化できない。

## 実装着手前の確認項目

監査の「依頼者に確認してもらう項目」の番号をそのまま使う。

| 番号 | 内容 | 担当 |
| --- | --- | --- |
| 確認項目 1 | 認証情報なしで pooler の証明書を確かめる: 自分のプロジェクトの host に `openssl s_client -starttls postgres -connect <POOLER-HOST>:5432 -showcerts` を実行し、発行元と SAN が host と合うか、Supabase が配布する CA で検証できるかを見る。結果の host 名と PROJECT-REF を文書やログに書かない（W-1 (c)） | 依頼者 |
| 確認項目 2 | Supabase の「SSL の強制」の設定があれば有効にできるか。pooler にも効くか | 依頼者 |
| 確認項目 3 | SQL エディタの履歴、自動保存、Postgres ログ、監査ログ、AI 機能に、slug と `alter role` の文が残るか、外部へ送られるか。残る場合の削除方法と保持期間。組織の AI のオプトインの状態（ADR 0005 の W-6、経路監査 L-4） | 依頼者 |
| 確認項目 4 | GitHub Environment のブランチ制限が public リポジトリと organization のプランで使えるか（W-3。実装前に親が確認）。Supabase と GitHub の管理者全員に多要素認証が有効か。組織のメンバーの一覧 | 親、依頼者 |

次の仕様は監査の時点で文書でも実機でも確かめていない。確定事項として扱わず、実装着手前に出典つきで確かめる。

| 番号 | 確かめる仕様 | 影響する箇所 |
| --- | --- | --- |
| V-1 | libpq / psycopg: URI の `?host=` の上書き、`conninfo_to_dict` の実効値、平文認証の要求でパスワードを送るか、`require_auth` の対応版、`psycopg-binary` が同梱する libpq の版、`sslrootcert=system` の挙動 | 「TLS」 |
| V-2 | GitHub: Environment を付けたジョブで OIDC トークンの `sub` が変わるか。WIF の属性条件（`assertion.ref`、`assertion.repository`、`assertion.repository_id`）と `google.subject` の対応に影響しないか | 06 §2.2、§9 |
| V-3 | Environment が使えない場合の代替: GCP Secret Manager の料金、権限の粒度、取得に使う Action | 「接続文字列のブランチへの束縛」 |
| V-4 | Postgres: `pg_stat_all_tables` と `pg_class` から `excluded_author` の件数が読めるか。パスワード変更で既存のセッションが切れないこと。`generated always as identity` のシーケンスが grant なしで動くか。`batch_writer` 自身が `connection limit` を変えられないこと | 「漏えい時の影響」、06 §3、02 §6 |
| V-5 | Postgres / Supabase: `alter role ... password` の平文が履歴やログに残る条件。SCRAM の verifier を渡す方法と pooler との互換 | 「ロールと権限」 |
| V-6 | Dependabot と pip-audit: `cooldown` の設定とセキュリティ更新の扱い、pip-compile のハッシュの再生成、`pip-audit --disable-pip` の可否 | ADR 0004、06 §10 |

## 結果

- 良い点: `internal` を公開しないまま書ける。「バッチは除外リストを読まない」がコードレビューだけでなくロールで強制される。書き込みが原子的になり、半端な状態が公開されない。使わない service role キーを配らずに済む。
- 引き受ける点: 接続文字列という秘密を持つ。パスワードの設定とローテーションが人の手順になる。表を足すときの grant とポリシーの記述が増える。pooler の挙動は CI で確かめられない。shared pooler の接続上限と停止に依存する（1 回のバッチに 1 接続なので当たる見込みは低いが、上限の値は事実票にない）。固定した CA の交換は、人の手順とコミットになる。任意の SQL を流せるセッションを持てるので、接続文字列が漏れたときの容量の消費は防げない（「漏えい時の影響」）。
- 影響: `.claude/rules/security.md` と NFR-43 の「書き込みは service role だけ」の文言は実態と合わなくなる。親が更新する（監査の「規則の改定文言の案」。open_questions の D-10 の「運用スクリプト（service role）」も同様）。

## 未確定

- 実装着手前の確認項目 1〜4 と V-1〜V-6（上の節）。特に、TLS の基準の段階は確認項目 1 の結果で決まる。
- `executemany` の pipeline mode が pooler の session mode で問題なく動くか（実装時。問題があれば `unnest` を使う 1 文の upsert に替える）。
- Actions のランナーから pooler に IPv4 で届くこと、`require_auth` と `connection limit 2` が pooler 経由で問題ないこと（A-11）。
- Supabase の既定権限（07 I-DB-18 でローカルの結果を確かめる）。
- SQLSTATE を見ずに種別だけを記録する運用で、接続トラブルの切り分けが足りるか（初回運用で判断。足りなければ `batch_run` に sqlstate の class を足すかを検討する）。
