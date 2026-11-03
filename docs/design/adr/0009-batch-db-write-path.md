# ADR 0009: バッチの書き込み経路（psycopg、shared pooler の session mode、専用ロール）

- 状態: レビュー中（2026-11-03。security-auditor の確認待ち）
- 更新日: 2026-11-03
- 関係: 02_data_model.md §1・§6、03_data_pipeline.md §7・§14・§15、06_security.md §2.3・§3、ADR 0004、ADR 0005、ADR 0007、NFR-22、NFR-40、NFR-43、NFR-44
- 変更履歴: 2026-11-03: 新規。ADR 0007 の「supabase-js の upsert、直接接続は使わない」を置き換える

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
| 秘密が漏れたときの影響 | 内部表の読み書き（除外リストを除く）。完全性は失うが除外リストは漏れない | 全表 | 全表 |
| 書き込みの原子性 | 1 トランザクション | リクエストごと | 関数ごと |
| 秘密のローテーション | `alter role ... password` と Secret の更新 | JWT シークレットの更新 | 同左 |
| 新しい秘密 | 接続文字列 1 つ（service role キーを置き換える） | なし | なし |
| ログへの漏えいの経路 | 例外が host、ユーザー名、行の値を含みうる（03 §14 で閉じる） | エラーが URL、表名を含みうる | 同左 |

## 決定

(1) A、(2) session、(3) `batch_writer`、(4) 表ごとのポリシー。

- 接続文字列は Secret `SUPABASE_BATCH_DB_URL`。`SUPABASE_SERVICE_ROLE_KEY` はどこにも置かない（Actions Secrets、Vercel、ローカルのいずれにも）。
- `service_role` には `internal` の権限を与えない（前回の N-3 の grant を取り消す）。使う場所がなくなったため。
- Vercel のビルドは anon キーで `pub_*` を読む。変更しない。
- 接続文字列は日次の取得・書き込みのステップだけに渡す。`publish_only` のステップには渡さない。

## 実装方式

### ロールと権限

SQL の全文は 02 §6。要点:

- マイグレーションで `create role batch_writer login noinherit nobypassrls`（パスワードなし）。パスワードは書かない。設定は運用担当が Supabase の SQL エディタで `alter role batch_writer with password '...'` を実行する（docs/operations/ に手順を書く。保存済みスニペットに残さない）。パスワードは URL エンコードが不要な英数字のみ、32 文字以上のランダム値にする。
- パスワードが未設定の間はログインできない状態になる（fail-closed。実装時に pooler 経由で確認）。
- 権限は表の名前を列挙して与える。`all tables in schema` と `alter default privileges` は使わない。`excluded_author` と、それを参照する `internal.benchmark_curve` まで届いてしまうため。表を足すときは grant とポリシーを書かないと書けない。

### 接続

- `psycopg.connect(url, prepare_threshold=None, connect_timeout=10, autocommit=False)`。
- 接続は工程ごとに開いて閉じる（preflight、derive の読み出し、write、完了記録）。GA4 と WP を待つ間は接続を持たない。同時に開く接続は 1 本だけ。
- 表名はすべて `internal.<表>` と修飾して書き、`search_path` に依存しない。
- 書き込み（工程 6）は 1 トランザクション。先頭で `set local statement_timeout = '120s'`。途中で失敗すればロールバックされるので、BI のビルドが半端な状態を読まない。

### TLS

- 目標は `sslmode=verify-full`。接続文字列に含める。`env.py` は、host が `localhost` / `127.0.0.1` でない接続先に `sslmode=verify-full` がなければ起動時に validation で失敗する。ローカルの `supabase start` は TLS なしで接続する。
- pooler の証明書を検証する CA の入手方法（`sslrootcert` の指定）は事実票にないので実装時に確認する。CA 証明書は秘密ではないので、必要なら `apps/batch/certs/` に置いてよい。
- verify-full が成り立たないと分かったときは、黙って `require` に下げず、security-auditor に諮って決める。

### ログ

03 §14・§15。`str(e)`、`e.diag`、`e.pgconn`、`e.pgresult` を使わず、例外の型と `sqlstate` だけで分類する。

### テスト

- 07 I-DB-18: `batch_writer` の grant とポリシーが許可リストと完全に一致し、`excluded_author` と `pub_*` には読めない。
- 07 I-B-11: psycopg の例外の内容がログに出ない。
- 07 A-11: 初回公開前に、実際の pooler に接続できること、TLS が verify-full で通ること、IPv4 のランナーから届くことを確認する。CI のローカル環境には pooler がないため自動化できない。

## 結果

- 良い点: `internal` を公開しないまま書ける。「バッチは除外リストを読まない」がコードレビューだけでなくロールで強制される。書き込みが原子的になり、半端な状態が公開されない。使わない service role キーを配らずに済む。
- 引き受ける点: 接続文字列という秘密を持つ。パスワードの設定とローテーションが人の手順になる。表を足すときの grant とポリシーの記述が増える。pooler の挙動は CI で確かめられない。shared pooler の接続上限と停止に依存する（1 回のバッチに 1 接続なので当たる見込みは低いが、上限の値は事実票にない）。
- 影響: `.claude/rules/security.md` と NFR-43 の「書き込みは service role だけ」の文言は実態と合わなくなる。親が更新する（open_questions の D-10 の「運用スクリプト（service role）」も同様）。

## 未確定

- pooler の証明書を検証するための CA の入手方法と `sslmode=verify-full` の成立（実装時）。
- `executemany` の pipeline mode が pooler の session mode で問題なく動くか（実装時。問題があれば `unnest` を使う 1 文の upsert に替える）。
- パスワードなしの login ロールが pooler 経由で確実に拒否されるか（実装時）。
- Actions のランナーから pooler に IPv4 で届くこと（A-11）。
- SQLSTATE を見ずに種別だけを記録する運用で、接続トラブルの切り分けが足りるか（初回運用で判断。足りなければ `batch_run` に sqlstate の class を足すかを検討する）。
