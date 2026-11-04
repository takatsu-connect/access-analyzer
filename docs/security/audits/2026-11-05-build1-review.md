# セキュリティ監査: 構築 1（秘密、Supabase、依存、ログ）

- 状態: 草案
- 更新日: 2026-11-05
- 範囲: main の f643ed6。観点 2、4、6、7。実行は読み取りと pip-audit だけで、DB は動かしていない。本番と対象サイトには触れていない。
- 読んだファイル: supabase/migrations/0001、0004、0005、supabase/checks/ の 2 本、supabase/config.toml、apps/batch/src/takatsu_batch/__main__.py、log.py、errors.py、apps/batch/tests/db/test_privileges.py、apps/batch/requirements.in、.env.example、.gitignore、.claude/rules/security.md、docs/design/02_data_model.md §2.3・§4〜§6、docs/requirements/05_non_functional.md §4・§5。0002 は 14〜25 行、0003 と他のコードと文書は `git grep` の一致だけ。

## 結論

**修正後に次の工程へ進んでよい**（致命的 0、高 0、中 3、低 4）。今すぐの露出はない。公開ビューの列は設計と一致し、`internal.article_cumulative` の追加列は公開に出ない。中の 3 件はバッチの書き込みと公開の前に直す。いずれも、今後の誤りを止める層の不足である。

## 指摘（重要度順）

### M-1（中）公開ビューの列のスナップショット検査がない（NFR-39、NFR-43、07 I-DB-16）
- 対象: apps/batch/tests/db/test_privileges.py:251-262。`tests/snapshots/pub-columns.json` は未追跡で、`git grep pub-columns` は apps/batch に一致しない。
- 問題: 検査はビュー名、`_mask`、`author_count`、`share_count` だけを見る。02 §6 の検査 4 が求める列集合と型の一致は未実装。
- 悪用の筋道: 所有者権限のビューの実効的な守りは grant と列の投影である。ビューに `article_cumulative.published_on` や別の内部列を足す、または `select *` にする変更をしても、検査は通り、anon から読める。
- 対策: 02 §4 からスナップショットを作り、完全一致のテストを足す。バッチの書き込みより前に行う。

### M-2（中）伏せ値の整合を DB が保証しない（NFR-33）
- 対象: 0002 の `_mask` を持つ各表（例: 19 行）、0005 の `pub_site_daily_channel` など。0002 と 0003 に `is null`、`>= 数値` の制約はない（`git grep` で 0 件）。
- 悪用の筋道: 書き込みの不具合で、`_mask` を設定したまま値を残す、T 未満の値を伏せずに入れる、T 未満の参照元の行を残すと、ビューが値をそのまま公開する。読み出し側の確認はなく、防御は mask.py と書き込みの実装だけになる。
- 対策: 各組に `check ((x_mask is null) = (x is not null))` を足す。`_mask` は `threshold`、`secondary` の値だけ持つので、0 は `_mask` が null の値として通る。下限（0 または T 以上）は、指標の定義を確かめてから回数の列と 0003 の参照元・市の行に足す。T を変えるときは NFR-39 の手順にマイグレーションを含める。

### M-3（中）公開される `failed_step` が自由文字列のまま（NFR-44、02 §3.6）
- 対象: 0004_operations.sql:39、0005_public_views.sql:99。`error_kind`（0004:40）と `counts` は DB で制約するが、`failed_step` は `text` だけ。
- 悪用の筋道: 書き込みの誤りで例外の文面や内部 URL が入ると、`pub_batch_run` と BI から誰でも読める。
- 対策: 02 §3.6 の 8 値を check 制約にする（`startup` は含めない。03 §1）。違反する値のテストを足す。

### 低
- L-1 権限の検査の穴。`supabase/checks/anon_privileges.sql` は PUBLIC の CREATE だけを見て、anon と authenticated へ直接与えた CREATE を見ない。service_role の `internal` の検査は pytest にしかなく、本番で流す A-11 に入らない。`role_table_grants` と `relacl` は列単位の grant を出さず、`role_table_grants` は実行ロールの有効なロールに絞られる（PostgreSQL の仕様に基づく。実機では未確認）。`has_schema_privilege` と `has_table_privilege`、`has_column_privilege` か `attacl` で補う。`test_check_detects_regression` は anon の検査だけなので、batch_writer の検査にも足す。
- L-2 .gitignore の `*service*account*.json` は、Google の既定の鍵ファイル名（`<プロジェクト>-<ハッシュ>.json`）に一致しない。WIF で JSON 鍵は作らず `credentials/` は除外済みなので、誤って別の場所に置いた場合だけの穴である。pre-commit か CI の gitleaks（07 S-09）で `"type": "service_account"` の内容を検出する。
- L-3 05 §4.1 に明示の行がない列がある。`pub_article_summary` の pv_7d、pv_30d、pv_total と各フラグ、`pub_article_milestone`、`pub_author_summary`、`pub_benchmark_curve`。公開値から導けるので新たな露出はないが、「表にない組み合わせは格納しない」との差を NFR-39 の手順で表に書く。
- L-4 `.github/` がなく、Dependabot の更新設定、CI、`pip-audit`、gitleaks、失敗通知が未整備。docs/operations/ に鍵のローテーションと漏えい時の手順もない。初回公開前の必須項目とする。

## 確認できたこと

- 列: 0005 の公開ビュー 34 本の列は 02 §4 の表と一致する。`internal.article_cumulative` の `age_days`、`base_date`、`published_on`、`is_ad` は、`pub_article_cumulative`、`pub_benchmark_curve`、`pub_article_summary` の列に出ない（列を列挙し `select *` なし）。参照元・市は確定月だけ。`sns_source_unmapped`、`github_run_id`、`counts`、`modified_at`、`_mask` は公開されない。
- 所有者権限のビュー: 0005 の全ビューが既定（`security_invoker` なし）で、関数は `internal.counts_is_numeric` だけ（`security definer` なし、`search_path = ''`）。anon の `internal` への usage なし、Exposed schemas は config.toml で `public` のみ、34 本すべて revoke 済み。単純なビューの書き込み経路は grant で閉じ、適用時に検査で失敗する。RLS は所有者に効かないので、残る単一の防御が M-1 と M-2 の点である。
- batch_writer: 25 表を名前で列挙（0001: 7、0002: 10、0003: 6、0004: 2）。`batch_run` は delete なし。ビューと `public` への grant なし。`all tables in schema`、`alter default privileges ... to`、`bypassrls` は使っていない（`nobypassrls` の指定だけ）。パスワードはマイグレーションにない。02 §6 と一致する。
- 秘密: `git grep`（.beads/ を除く）で一致したのは、説明文、ダミーの `hunter2@pooler.example`（tests/test_errors.py:17、test_main.py:19）、ADR 0009 の CA の指紋と pooler のホスト名の説明、07 の例だけ。履歴に `.env`、鍵ファイルの追加はなく、JSON の追加は .beads/metadata.json と .claude/settings.json だけ。`.env.example` は名前だけで、値に `NEXT_PUBLIC_` の項目はない。
- 接続: `DB_SSLMODE` は `verify-full`（config.py:34、テストあり）。結合テストはローカルのホストの一覧を持つ（conftest.py:18。適用箇所は未読）。実際の接続処理は読んでいない。
- ログ: log.py は許可した語と整数だけを出す。errors.py は型と sqlstate だけを読む。__main__.py は本体の import の前に fd 2、例外フック、logging、gRPC の出力を塞ぐ。`__init__.py` は空。src に `print(` はない。
- 依存: `pip-audit --require-hashes --disable-pip` は requirements.txt と requirements-dev.txt のどちらも既知の脆弱性なし（2026-11-05）。ロックはハッシュつきで、`colorama` は dev だけ。
- GitHub（`gh api`）: secret scanning、push protection、Dependabot のアラートとセキュリティ更新は有効。開いたアラートは 0 件。

## 依頼者に確認してもらう項目

- Supabase の本番: (1) Exposed schemas が `public` のみで、`graphql_public` を使わないなら外してあること。(2) ログインを使わないので新規登録（Allow new users to sign up）が無効であること。config.toml はローカルで `enable_signup = true` のままで、本番には適用されない前提。(3) 適用後に SQL エディタで checks の 2 本が 0 行であること。

## 未確認

- 実機の権限: 実装担当の報告（事実票）と静的な読み取りが矛盾しないことだけを確認した。確認方法は `supabase start` のあと `pytest -m db`。親の再実行は単体テストだけである。
- 本番の管理スキーマの一覧と既定権限: 本番への適用時の検査（A-11）で確かめる。
- 0002、0003 の全文、mask.py と書き込みの処理。.beads/ と credentials/ は指示により読んでいない。
- 追跡されていないローカルファイルの中身。`git grep` は追跡ファイルだけを見る。
