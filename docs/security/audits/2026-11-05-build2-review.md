# セキュリティ監査: 構築 2（日次バッチ本体）

- 状態: 草案
- 更新日: 2026-11-05
- 範囲: main の 0b2ed8d に対する未コミットの変更（バッチ本体、結合テストの土台、0005 の 1 か所、contracts/）。観点 1、2、4、6、7 と、対象サイトへの配慮（NFR-72）。実行は読み取りの git コマンドだけ。テストは実行していない。本番、対象サイト、GA4 には触れていない。ワークフローはまだないので観点 3 は申し送りにした。
- 読んだファイル: apps/batch/src/takatsu_batch/ の env.py、pipeline.py、cli.py、publish.py、log.py（全体）、db.py（1〜55、99〜166 行）、wp_fetch.py（1〜60、116〜200、240〜330 行）、ga4_client.py（186〜258 行）、write.py（163〜260 行）。apps/batch/tests/ の conftest.py、integration/conftest.py、support/localenv.py、support/entry_harness.py。supabase/migrations/0005_public_views.sql（226〜240 行と差分）。contracts/constants.json、.env.example、.gitignore、.claude/rules/security.md、docs/design/03_data_pipeline.md（67〜89、287〜326 行）、前回の報告の冒頭 40 行。これ以外は `git grep` の一致だけ（config.py の設定値、ADR 0009、02、07、テストの接続文字列）。docs/design/06_security.md、`__main__.py`、errors.py は読んでいない。

## 結論

**修正後に次の工程へ進んでよい**（致命的 0、高 0、中 1、低 7）。

今回の変更に、秘密や行データが外へ出る経路は見つからなかった。作業ツリー（未追跡を含む）に本物の鍵や接続文字列はない。コミットを止める指摘はない。中の 1 件（結合テストの破壊的な操作の歯止め）は、デプロイ工程で本番の管理接続を扱い始める前に直す。低は構築 3 とデプロイ工程の中で片づけてよい。

## 指摘（重要度順）

### 致命的

なし。

### 高

なし。

### M-1（中）結合テストの `truncate` と `alter role` の歯止めが、host の一致 1 枚だけ（BI データの完全性）

- 対象: apps/batch/tests/conftest.py:21-28（接続先の検査）、:53-60（`alter role batch_writer login password ...` と `nologin password null`）、apps/batch/tests/integration/conftest.py:31-43（`truncate ... restart identity cascade` を前後 2 回）、apps/batch/tests/support/localenv.py:24-26（環境変数を `.env` より優先）。
- いま止まるもの: `DATABASE_URL`（環境変数でも `.env` でも）に本番の host を書いた場合は、`pytest.fail` で止まる。複数 host（`localhost,本番`）と `?host=` の上書きも、`conninfo_to_dict` の実効値を見るので止まる。`SUPABASE_BATCH_DB_URL` はこの経路で読まれない。`batch_writer` には truncate と `alter role` の権限がないので、バッチ用の接続文字列を取り違えても壊せない。現実的な取り違えは閉じている。
- 抜け: 検査は `host` の値しか見ない。本体の env.py（U-30）は許可リストで `hostaddr` と `service` を拒否するが、テスト側は同じ検査をしていない。
  1. `DATABASE_URL` が `postgresql://...@localhost:5432/postgres?hostaddr=<別の IP>`、または `host=localhost hostaddr=<別の IP>` の形だと、検査を通って別の宛先へつながる。
  2. 環境変数 `PGHOSTADDR`、`PGSERVICE`（サービスファイルが `hostaddr` を補う）が開発者のシェルに残っている場合も同じ。
  3. `localhost` へのポート転送（ssh -L など）の先が本番の場合。
- 事故の筋道: 本番の管理接続（postgres）を手元で扱う場面（マイグレーションの適用、`batch_writer` のパスワード設定）と上のどれかが重なると、内部表 26 本が空になり、`batch_writer` が `nologin password null` になる。BI のデータと実行記録がすべて消え、日次バッチが認証で失敗する。復旧はバックフィルとパスワードの再設定。誤りが 2 つ重なる必要があるので中とした。
- 直し方の案（上から順に効く）:
  1. 接続先を設定値にしない。ローカルの Supabase の管理接続は固定（`postgres:postgres@127.0.0.1` と supabase/config.toml の port）なので、コードで組み立てる。`DATABASE_URL` を `.env.example` から外せば、取り違えの入口がなくなる。
  2. 設定値を残すなら、`_local_url` で本体と同じ検査を通す（`takatsu_batch.env.parse_db_url` を呼び、`is_local` を確かめる。キーは host、port、user、password、dbname だけ、クエリなし）。port が config.toml の値であること、`PGHOSTADDR`・`PGSERVICE`・`PGSERVICEFILE` が環境にないことも確かめる。
  3. `_truncate` と `batch_writer_url` の直前に、DB 側の確認を 1 文足す。例: `internal.batch_run` に `github_run_id` が数字の行（Actions の実行記録）が 1 行でもあれば fail。host の見かけに頼らない 2 枚目になる。
  4. 名前を `DATABASE_URL` から、ローカル専用と分かる名前に変える（他の道具やプロジェクトが同じ名前を export していることが多い）。
- 根拠: 上記ファイルの通読。`git grep` で tests/ に `hostaddr` の検査は test_env.py（本体の検査）にしかない。libpq の `hostaddr` と `PGHOSTADDR` の挙動は PostgreSQL の仕様に基づく（ADR 0009:143、:192 の記述と一致。テスト側の経路は実機では未確認）。
- 関係: ADR 0009「TLS」、07 §1、security.md「Supabase」。

### 低

- **L-1 テスト全体に「本物のネットワークへ出ない」歯止めがない**（NFR-72、security.md「対象サイトへの配慮」）。apps/batch/tests/ に autouse の fixture やソケットの遮断はなく（`git grep` で `autouse`、`pytest_socket`、`disable_socket` が 0 件）、対象サイトへ出ないことは各テストが respx を使うことに頼っている。`_API_ROOT` は本物の origin で、テストは待ち時間を偽の sleep に替えるので、respx を忘れたテストが 1 本入ると、間隔なしで takatsu-connect.com を叩く。案: tests/conftest.py に autouse の fixture を置き、`httpx` の送信を既定で失敗させる（respx の `assert_all_mocked` を全体に掛ける、または `pytest-socket` で `127.0.0.1` 以外を遮断する）。CI でも同じ設定にする。
- **L-2 失敗した日は、削除・非公開化の反映が止まる**（FR-72、NFR-34、NFR-52）。
  - apps/batch/src/takatsu_batch/pipeline.py:173-185、publish.py:11-16。write のコミット後に Deploy Hook が失敗すると、Supabase からは消えているが BI には前回のビルドが残る。Hook の POST は 1 回だけで再試行がない。案: 通信の失敗と 5xx に 1〜2 回の再試行を足す（二重に呼んでも害はない）。手順書に「`failed_step = publish` の日は当日中に `publish_only` を実行する」と書く。
  - pipeline.py:130-175。削除は write 工程でまとめて行うので、GA4 の工程が失敗している間（割り当て、認証）は、WP 側で取り下げた記事が Supabase にも BI にも残り続ける。設計どおりだが、「次のバッチで消す」が「次に成功したバッチで消す」になる。手順書に、失敗が続くときの期限と手動の対処を書く。削除だけ先に反映する経路を作るかは依頼者の判断（設計の変更になるので ADR）。
- **L-3 パスワード付きの検出が `modified` に頼り、4b が保護記事を毎日取りに行く**（NFR-34、NFR-72）。wp_fetch.py:273-278、:303-310。取り込み済みの記事がパスワード付きに変わったことは、差分（`modified_after`）に掛かったときしか分からない。予約投稿と同じく `modified` が変わらない経路があると、公開のまま残る。また保護記事は毎日 4b でタイトルごと取って捨てている。案: 工程 4 の ID 一覧の `_fields` を `id,content.protected` にする。リクエスト数は増えず、保護の状態が毎日全件で分かり、保護記事を `missing_ids` から外せるので 4b の毎日の 1 回もなくなる。`content.protected` だけの指定で本文の描画が走らないことは WordPress の実機で未確認（最初の本番実行の前に 1 回確かめる）。
- **L-4 接続と HTTP の設定に、環境変数と既定値から入る余地が残る**（ADR 0009）。
  - db.py:41-45。`sslmode`、`sslrootcert`、`require_auth` はキーワードで固定されているが、`gssencmode` は既定（prefer）のまま。`gssencmode="disable"` を固定に足す。
  - env.py:75。host の検査は `/` で始まる値を拒否するが、`@` で始まる値（抽象名前空間の Unix ソケット。libpq 14 以上）を拒否しない。Unix ソケットでは TLS が使われない。`host.startswith(("/", "@"))` にする。
  - cli.py:36、:47。`httpx.Client()` は既定で `HTTP(S)_PROXY`、`SSL_CERT_FILE`、`.netrc` を読む。`trust_env=False` を付ける。
  - いずれも、秘密か実行環境を既に握っている相手にしか使えないので悪用の筋道はない。「設定はコードで固定する」方針の残り。libpq の挙動は仕様に基づく（実機では未確認）。
- **L-5 入力の検査の小さな抜け**。
  - env.py:85-87。Deploy Hook の URL は `https://` で始まることしか見ない。host を `api.vercel.com` に固定すると、Secret の設定ミスで別の宛先に POST することがなくなる。
  - env.py:44、db.py:125-134。`GITHUB_RUN_ID` は自由文字列のまま `internal.batch_run.github_run_id`（text、制約なし）に入る。公開ビューには出ないが、前回の M-3 と同じ考えで、ASCII の数字だけに絞る。
  - wp_fetch.py:34。`_MAX_PAGES = 1000` は、誤ったヘッダで 1 つの一覧に最大 1,000 リクエストを許す。225 本の規模に合わせて 2 桁に下げる。
  - wp_fetch.py:163-166。429 と 503 を 1、2、4 秒で再試行し、`Retry-After` を見ない。回数は小さいので害は限られるが、429 は再試行せず失敗にするか、`Retry-After` に従う。
- **L-6 既存のマイグレーションの書き換えと、日付の重複**。supabase/migrations/0005_public_views.sql:231-236。0005 を新しいファイルにせず書き換えている。本番に 0005 を適用済みなら、`supabase db push` はこの変更を流さず、リポジトリと本番の定義がずれる（security.md「スキーマの変更はマイグレーションファイルで行い」）。未適用なら問題ない（依頼者に確認）。また `date '2025-10-08'` が 0005 に 8 か所あり、config.py:31 の `BACKFILL_START` と別に書かれている。値の一致を見るテストがなければ足す（tests/test_static_rules.py には一致なし。他のテストは未確認）。
- **L-7 ローカルの値の扱い**。tests/conftest.py:50-57 は `LOCAL_BATCH_WRITER_PASSWORD` を `.env` から読むが、fixture が自分で設定して自分で消すので、セッションごとに `secrets.token_urlsafe()` で作れば設定値が要らなくなる（本番と同じパスワードを手元で使い回す余地もなくなる）。.env.example:17 のコメントは `apps/batch/tests/db` を指したままで、今の置き場所（tests/conftest.py、tests/integration/）と合っていない。tests/support/entry_harness.py:20 などの偽の接続文字列（`hunter2@pooler.example`）は、CI に gitleaks を入れるときに許可リストが要る。

## 見てほしいと言われた点への答え

### 1. 秘密と行データの出口（ログ、例外、戻り値、batch_run、テストの出力）

問題は見つからなかった。

- ログ: log.py は許可リストの語と int だけを出す（許可外は `unknown`、int 以外は -1）。今回足した `ga4_missing_days`、`ga4_unknown_device_rows`、`skip` は件数と固定の語で、03 §5（95 行）に書かれている。§15 の件数の一覧には、この 2 つと GA4 の残量 2 つが載っていないので、一覧に足すとよい（文書だけの差分）。
- 例外: env.py は `raise BatchValidationError from None` で元の例外を切り、引数を持たせない。pipeline.py:196-200 は種別だけを渡す。`record_failure` の中の失敗も出さない（:94-98）。
- SecretStr: `get_secret_value()` は env.py:64、:86、:95-97（検査）、db.py:51（接続の直前）、publish.py:14（POST の直前）、ga4_client.py:197 の 4 か所の用途だけ。ga4_client.py:197 はプロパティ ID を平文の属性 `_property_name` に持つが、出力する経路はない。
- 戻り値: `run_batch` と `dispatch` は終了コードだけを返す。
- batch_run: 書くのは固定の語、数値の counts、`github_run_id`（L-5）。SQL は db.py も write.py もパラメータと `psycopg.sql` の識別子で組み、値を文字列として埋めていない。
- テストの出力: 出うるのはローカルの値と偽物だけ。`_local_url` は `pytrace=False` で URL を出さない。`.env` に本番の値を置かないことが前提（確認依頼 3）。
- I-B-11、I-B-05、S-18 が通っていることは事実票による。今回は中身を読んでいない。

### 2. 接続文字列の検査と TLS の固定

- env.py:59-77。scheme、クエリ、フラグメントを先に拒否し、libpq 自身の解析結果（`conninfo_to_dict`）のキーを許可リストで見るので、`urlsplit` と libpq の解釈の差を突く形は fail closed になる（`?` を含めば必ず拒否、キーワード形式は scheme で拒否）。複数 host、Unix ソケット（`/`）、空の host を拒否する。抜けは L-4 の `@` だけ。
- db.py:34-52。`psycopg.connect` は 1 か所で、ローカル以外は `sslmode=verify-full`（config.py:57）、`sslrootcert`（apps/batch/certs/supabase-root-2021.crt、追跡済み）、`require_auth=scram-sha-256` をキーワードで渡す。psycopg はキーワードを接続文字列より優先するので、Secret の内容で下げられない。CA のファイルが見つからなければ接続は失敗する（fail closed）。libpq が 16 未満だと `require_auth` が外れる点は、tests/test_db.py:56 が版を確かめている（`git grep` の一致）。
- TLS なしになるのは host が `localhost` / `127.0.0.1` と完全一致したときだけ。`hostaddr` は許可リストで拒否される。

### 3. 対象サイトへの配慮（NFR-72）と著者の数値 ID

規則に反する点はない。

- 範囲: 宛先は `SITE_ORIGIN` 固定、`follow_redirects=False`、匿名の GET だけ。4b も `status=publish` 付き。`_fields` に本文（`content.rendered`）はない。保護記事は取って捨てる（wp_fetch.py:309-310、:318）。
- 間隔: `WpClient._send_once` が再試行を含むすべての送信の前に 1 秒（config.py:39）を空ける。失敗は 3 回までで、だめなら最初の失敗で止まる。
- 回数: 4b は該当があるときだけ 100 本ずつ。通常日は 7〜9 回、日曜は 30 回弱。上限と 429 の扱いは L-5、保護記事の毎日の 1 回は L-3。同時に 2 つ走ると間隔が半分になるので、ワークフローの `concurrency` で防ぐ（申し送り）。
- 数値の著者 ID: 参照は wp_fetch.py の 281〜389 行だけで（`git grep`）、slug に解決して捨てている。DB、ログ、batch_run に出る経路はない。`WpResult` の定義（61〜115 行）は読んでいないので、この点は grep の範囲での確認。
- 本物の WordPress での挙動（`users/<id>` が匿名で読めるか、`modified_after`、`include`）は未確認。

### 4. HTML エンティティを戻した文字列の格納

バッチ側に問題はない。戻すのは 1 回だけ（wp_fetch.py:212、:214、:296、:346、:373）。ただし格納される文字列は `<`、`>`、`&`、引用符を含みうる「HTML ではない文字列」になり、安全は表示側だけで決まる。構築 3 への申し送りが要る（下の節）。JSX の経路は 07 S-03（`react/no-danger`）と ADR 0008 で既に塞がれている。

### 5. 結合テストの truncate が本番に向く経路

M-1 のとおり。現実的な取り違え（本番の host を `DATABASE_URL` や `.env` に書く、バッチ用の接続文字列を使う）は止まる。残るのは `hostaddr`、`PG*` の環境変数、ポート転送で、歯止めを 1 枚足す。

### 6. pub_article_cumulative の行の絞り込み

新しい露出はない。

- 差分は `where` 句とコメントだけで、列（post_id、n、cumulative_pv）は変わらない。`published_on` は列に出ない。
- 行の有無から分かるのは「公開日が 2025-10-08 以降か」だけで、公開日は元から公開情報。日付そのものは config.py と 0005 の他のビューに既にある。
- 隠れる行の中身は、公開済みの `pub_article_daily` の値から作れる累積で、秘密ではない。絞り込みの目的は正確さなので、`security_barrier` は要らない。行を減らす変更なので、0b2ed8d で記録した差分による逆算の範囲も広がらない。
- 定義のずれの心配は L-6。

### 7. 失敗時の扱い（preflight の後始末、publish の失敗）

- preflight（db.py:107-116）: 直すのは 2 時間を超えた `running` の行だけで、入れるのは `failed`、`unknown`、時刻。公開ビューに新しい情報は出ない。`finished_at` は実際の終了ではなく後始末の時刻になる（表示上の注意だけ）。走行が 2 時間を超える実行や同時実行があると、走行中の行を失敗に直してしまうので、ワークフローの `timeout-minutes` と `concurrency` で防ぐ（申し送り）。
- publish の失敗: 書き込みは 1 トランザクションでコミット済み（write.py に commit はなく、接続の `with` の終わりで確定する。`git grep` による）。途中で失敗すれば全体が巻き戻るので、半端な状態は公開ビューに出ない。公開面の影響は「BI が前回のまま残る」ことで、取り下げた記事の反映が遅れる点だけが問題になる（L-2）。
- 補足: Hook の後の `finish_run_success`（pipeline.py:187-190）が失敗すると、BI は新しいのに実行記録は `failed` / `publish`、または `running` のままになる。公開面の害はなく、次の実行がやり直す。

## 構築 3 への申し送り

1. 記事タイトル、著者の表示名、カテゴリ名、タグ名は HTML ではない文字列として扱う。JSX のテキストと属性値にだけ使う。S-03（`react/no-danger`）を外さない。
2. JSX の外の出口を静的検査に足す: `innerHTML`、`outerHTML`、`insertAdjacentHTML`、`document.write`、`<script>` への埋め込み（JSON-LD を含む。`JSON.stringify` は `<` を逃がさない）。
3. 名前から URL、`href`、`id`、`className`、CSS を作らない。リンクは DB の `link` を使い、BI でも `https://takatsu-connect.com/` で始まることを確かめる（バッチの検査との二重化。NFR-91）。
4. `<title>` や OG などのメタデータは Next.js の Metadata API を通し、文字列の連結で HTML を作らない。
5. CSV などの書き出しを作るなら、`=`、`+`、`-`、`@` で始まるセルの扱いを先に決める。
6. 制御文字と双方向の制御文字（U+202E など）、極端に長い名前で表が崩れないようにする（格納時に除くか、表示で隔離と省略）。
7. D-17（CSP の `script-src`）は inline を許さない形で決める。1〜2 が破れたときの 2 枚目になる。
8. 03 §4 の「BI は文字列として描く」を、06 の規則として書く（06 は今回読んでいない）。

## デプロイ工程への申し送り

1. ワークフローに `concurrency` を付け、日次と手動の実行が重ならないようにする。`timeout-minutes` は 120 未満にする（`ABANDONED_RUN_HOURS = 2` との整合）。
2. `PG*`、`HTTP_PROXY`、`HTTPS_PROXY`、`SSL_CERT_FILE` をワークフローに置かない（ADR 0009:143）。静的検査に入れる。
3. `workflow_dispatch` の入力（mode、from、to、BASE_DATE）は `env:` 経由で渡し、`run:` に `${{ }}` を直接書かない。
4. `publish_only` のジョブには Deploy Hook だけを渡す。pytest を回すジョブには Secrets を渡さない。本番の管理接続（postgres）を Actions の Secrets に置かない。
5. CI に pip-audit、gitleaks（L-7 の許可リスト）、L-1 のネットワーク遮断、pytest の `--tb=short` を入れる。
6. docs/operations/ に書くこと: `failed_step = publish` の日の `publish_only`、失敗が続くときの取り下げ記事の扱い（L-2）、60 日無活動の自動停止、鍵のローテーションと漏えい時の手順（前回 L-4 の続き）。
7. 最初の本番実行で確かめること: `users/<id>` が匿名で読めるか、`modified_after` と `include` の挙動、pooler の `require_auth`（A-11）、L-3 の `_fields`。
8. security.md の GitHub Actions の規則（`permissions:`、SHA 固定、`pull_request_target` を使わない、main だけの定期実行）と、WIF の属性条件、Environment。ワークフローができたら監査を依頼する。

## 依頼者に確認してもらう項目

1. 本番の Supabase に 0001〜0005 を適用済みか。適用済みなら、今回の 0005 の変更は新しいマイグレーションにする（L-6）。
2. `supabase status` が表示する DB URL が `postgresql://postgres:postgres@127.0.0.1:54322/postgres` か（M-1 の案 1 の前提）。
3. リポジトリ直下の `.env` に本番の値（接続文字列、Deploy Hook、プロパティ ID）が入っていないこと。監査では `.env` を読んでいない。
4. GA4 の失敗が続く間も、WP 側の削除・非公開化だけは先に BI へ反映する経路を作るか（L-2。作るなら ADR）。

## 未確認

- テストは実行していない。ruff、mypy、pytest 1,150 件、I-B-11、I-B-05、U-30、S-06・S-17・S-18 の結果は依頼の事実票による。確認方法: CI またはローカルで再実行する。
- 読んでいない範囲: `__main__.py`、errors.py、models.py、derive.py、period.py、ga4_daily.py、ga4_period.py、wp_fetch.py の 61〜115・201〜239・331 行以降、db.py の 56〜98・167 行以降、write.py の 1〜162・261 行以降、テスト本体、偽物（fake_wp、fake_ga4、batch_scenario）、docs/design/06_security.md。
- 単体テストが本物の対象サイトへ接続しないこと（L-1）。確認方法: ネットワークを遮断して pytest を回す。
- 依存の脆弱性。この環境に pip-audit がなかった。確認方法: `pip-audit -r apps/batch/requirements-dev.txt --require-hashes --disable-pip` と、requirements.txt にも同じ。respx は 0.23.1 で固定されている（ハッシュの行は見ていない）。
- libpq の挙動（`@` で始まる host、`gssencmode`、テスト側の `hostaddr` と `PGHOSTADDR`）と、WordPress の `_fields=id,content.protected` の負荷は、仕様の理解に基づく。実機では確かめていない。
- リポジトリの設定（secret scanning、main の保護など）は今回の範囲に入れていない。

## 問題なしと確認した項目

- 作業ツリー（追跡と未追跡）に、`sb_secret_`、`private_key`、JWT、service role キーはない。`service_role` の一致はロール名だけ。接続文字列の形の文字列は、`pooler.example`、`hunter2`、`localhost` の偽物だけ（`git grep --untracked`）。
- `.env`、credentials/、.github/ は追跡されていない。追跡されている証明書は公開の CA（apps/batch/certs/supabase-root-2021.crt）だけ。.gitignore は `.env`、`.env.*`、鍵の拡張子、Google の既定のファイル名を除外する（前回 L-2 は対応済み）。
- .env.example は項目名だけ。Supabase のキーに `NEXT_PUBLIC_` は付いていない。
- contracts/constants.json は SITE_ORIGIN と区分の名前だけで、公開してよい値。
- ログは工程、件数、所要時間、種別だけ（log.py）。SQL は値を埋め込まない。書き込みは `truncate` を使わず、キーの差分で消す（write.py:221-252）。
- WP への問い合わせは固定の origin、匿名の GET、1 秒間隔、リダイレクトなし。著者は必要な ID だけを個別に取り、`_fields=name,slug,link` に限る。著者と記事のリンクは `https://takatsu-connect.com/` で始まることを確かめる（wp_fetch.py:189-192、:284）。
- Deploy Hook は POST を 1 回、本文を読まず、URL を出力しない（publish.py）。
- `BASE_DATE` は YYYY-MM-DD だけを受け、未来と計測開始前を拒否する（env.py:46-52、pipeline.py:101-108）。
- 開発用の依存 respx は理由つきで requirements-dev.in に足され、本番の requirements.txt は変わっていない（`git status`、`git diff`）。

## 所要時間とツール呼び出し回数

- 所要時間: 約 17 分（時計を参照する手段がないので概算。上限 20 分）。
- ツール呼び出し: 42 回（Read 23、Glob 1、Bash 15、Write 2、報告 1）。
