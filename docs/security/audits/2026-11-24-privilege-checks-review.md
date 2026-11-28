# 権限の検査 SQL の書き換えの監査（fix/privilege-checks-role-independent、0dd4bba）

- 状態: 草案
- 更新日: 2026-11-24
- 監査者: security-auditor
- 工程: 構築後の変更差分（Supabase の権限の検査に触れる変更）

## 1. 範囲

`supabase/checks/` の 2 つの検査 SQL を、information_schema から pg_catalog の ACL と `has_*_privilege` に書き換えた変更と、同じ本文を写したマイグレーション 0008。スキーマと権限そのものは変わらない。

読んだファイル:

| ファイル | 範囲 |
| --- | --- |
| supabase/checks/anon_privileges.sql | 全体（150 行） |
| supabase/checks/batch_writer_privileges.sql | 全体（133 行） |
| supabase/migrations/0008_privilege_checks.sql | 1〜20 行、各 do ブロックの終わり（156〜165、298〜307 行） |
| apps/batch/tests/db/test_privileges.py | 366〜490 行 |
| `git diff main -- supabase/checks` | 全体 |
| .claude/rules/security.md | 「Supabase」の節 |

確認の方法は、文の読み比べ（書き換え前の各節と 1 対 1）だけ。SQL は実行していない。ローカルと本番のどちらのデータベースにも接続していない。PostgreSQL と Supabase の挙動は、依頼の事実票（確認日 2026-11-24、公式文書での再確認なし）と監査者の知識によるもので、公式文書では確かめていない。

## 2. 結論

**修正後に本番へ適用**（ブランチの main への merge は妨げない）。

- 致命的 0、高 0、中 2、低 4。
- 書き換えの方針（pg_catalog の ACL と 3 引数の `has_*_privilege` だけで判定する）は正しく、実行する役割で結果が変わる箇所は残っていないと読める。表、関数、シーケンス、ドメイン、スキーマ、列、PUBLIC、既定の ACL（NULL）の扱いは、書き換え前と同じか、より広い。
- 検出が狭くなった箇所が 2 つある（M-1: anon の検査から外部データラッパーと外部サーバーが抜けた。L-1: 検査対象の役割が所有者で ACL が NULL のオブジェクト）。どちらも、いまの権限に露出があることを示すものではない。
- 0008 は本番に適用すると書き換えられない（0005 と同じ）。M-1 と L-1 を直すなら、**0008 を本番に適用する前**に検査ファイルと 0008 の両方を直すのがよい。適用後に直すと 0009 がもう 1 本要る。
- 0008 の適用の前に、検査ファイル 2 本を本番に読み取り専用で流し、0 行であることを確かめる（L-2）。本番で新しく違反が出るかどうかは、リポジトリからは判断できない。

## 3. 指摘（重要度順）

### M-1（中）anon の検査から、外部データラッパーと外部サーバーの USAGE が抜けた

- 対象: supabase/checks/anon_privileges.sql 37〜54 行（usage grant の 2 節）。0008 の同じ箇所。
- 問題: 書き換え前の `information_schema.role_usage_grants` は、シーケンスとドメインのほかに、外部データラッパーと外部サーバーの USAGE も返す。この 2 つは `object_schema` が空文字なので `managed` の除外に当たらず、anon / authenticated / PUBLIC への付与があれば違反になっていた。書き換え後は、シーケンス（relkind `S`）とドメイン（typtype `d`）の 2 節だけで、`pg_foreign_data_wrapper` と `pg_foreign_server` を見る節がない。batch_writer の検査には足してある（112〜120 行）のに、anon の検査にはない。
- 悪用の筋道: 誤操作で `grant usage on foreign server ... to anon`（または PUBLIC）が入っても、検査が通る。いまは外部サーバーがなく、anon にはどのスキーマにも CREATE がない（92〜95 行で検査している）ので、これだけで読み書きにはつながらない。
- 影響: 検査の 1 枚が欠ける。現在の露出はない。
- 対策: anon の検査に、batch_writer の検査の 112〜120 行と同じ形の 2 節を足す（grantee が 0、anon、authenticated のもの。`coalesce(fdwacl, acldefault('F', fdwowner))` と `coalesce(srvacl, acldefault('S', srvowner))`）。Supabase の基盤が持つ外部データラッパーが本番にあれば除外の一覧が要るので、L-2 の事前の実行で確かめる。テストに `create server` と `grant usage` の 1 件を足す。
- 根拠: `git diff main -- supabase/checks` の anon_privileges.sql の usage grant の節。`role_usage_grants` が外部データラッパーと外部サーバーを含むことは監査者の知識（公式文書では未確認）。
- 関係する規則: .claude/rules/security.md「Supabase」（anon には公開用のビューまたは表に対する select 以外を与えない）。07 I-DB-01。

### M-2（中）テストが、書き換えた節と「読み取り専用の役割」を十分に代表していない

- 対象: apps/batch/tests/db/test_privileges.py 368 行（`CHECK_READERS`）、398〜427 行（anon の検査の回帰 10 件）。
- 問題 1（実行する役割）: `anon` は、検査の対象そのもの。information_schema の「自分が関係する行だけ」という絞り込みは、anon が grantee の行を anon には見せる。つまり anon で流す試験は、anon への付与についてだけは、役割に左右される書き方でも通ってしまう。本番で使う `supabase_read_only_user` は、anon でも batch_writer でも所有者でもない第三者で、2026-11-08 の偽の違反はこの立場で起きた。`test_check_files_do_not_read_information_schema`（389〜394 行）が文字列で歯止めをかけているが、2 引数の `has_*_privilege`（現在の役割で判定する）や `pg_user_mappings` のような別の絞り込みは防げない。
- 問題 2（書き換えた節の回帰）: 読んだ範囲では、anon の検査で今回書き換えた節のうち、次を権限を広げて確かめる文がない。回帰の 10 件は、書き換えていない節（relation grant、default privilege、schema、effective privilege、column grant）と table grant（authenticated）に当たっている。
  - routine grant（既定の ACL のままの関数。`acldefault('f', ...)` の展開が働くこと）
  - usage grant（シーケンス、ドメイン。ドメインは既定で PUBLIC に USAGE）
  - table grant（PUBLIC、public / internal 以外のスキーマ）
  - mask column
- 影響: 将来の編集で `coalesce(..., acldefault(...))` が落ちても、テストは通る。事実票の「24 通りの文で違反が返る」は、この 4 つを含んでいない（10 + 14 = 24）。
- 対策:
  - `CHECK_READERS` に、テストの中で作る何も持たない役割（`create role check_reader nologin`。付与なし、所属なし）を足す。anon より中立で、読み取り専用の役割に近い。
  - anon の検査の回帰に次を足す: `create function internal.f() ...`（revoke なし）で `routine grant: PUBLIC internal.f`、`create domain internal.d as text` で `usage grant: PUBLIC internal.d`、`create sequence internal.s; grant usage ... to anon` で `usage grant: anon internal.s`、`_mask` を含む列を持つ `public.pub_x` で `mask column:`、`create schema extra; create table extra.t(); grant select on extra.t to public` で `table grant: PUBLIC extra.t`。
- 根拠: 366〜490 行を読んだ。1〜365 行は範囲外で読んでいないので、そこに同じ趣旨のテスト（I-DB-03 など）があれば問題 2 の一部は当たらない。
- 関係する ID: 07 I-DB-18、A-11。

### L-1（低）検査対象の役割が所有者で、ACL が NULL のオブジェクトを見逃す

- 対象: supabase/checks/batch_writer_privileges.sql 28 行（actual_grant）、95 行（関数）、102 行（シーケンス）、109 行（型）。supabase/checks/anon_privileges.sql 19 行（table grant）。
- 問題: information_schema の権限のビューは、ACL が NULL のとき `acldefault` を展開し、所有者への既定の権限を行として返す。書き換え前は、batch_writer（または anon）が所有する表・関数・シーケンス・ドメインが、付与の文なしでも違反になった。書き換え後は、これらの節が `aclexplode(...acl)` をそのまま使うので 0 行になる（anon の検査の関数・シーケンス・ドメインの節は `coalesce` があり、問題ない）。public と internal の表は「effective privilege」の節（`has_table_privilege` は所有者の権限も数える）が拾うが、関数、シーケンス、型と、ほかのスキーマの表は拾わない。
- 悪用の筋道: 管理者が誤って `alter function ... owner to batch_writer` などを実行した場合だけ。batch_writer と anon にはどのスキーマにも CREATE がないので、自分では作れない。所有者はそのオブジェクトの権限を自分で付け替えられるので、起きたときは検出したい。
- 対策: 「所有者」の節を 1 つずつ足すのが、ACL の展開より単純で漏れがない。pg_class（relowner）、pg_proc（proowner）、pg_type（typowner）、pg_namespace（nspowner）の所有者が検査対象の役割（batch_writer。anon の検査では anon と authenticated）なら違反にする。
- 根拠: 差分の読み比べ。information_schema が `acldefault` を展開することは事実票による。

### L-2（低）本番で新しく違反が出るかは未確認。0008 の前に読み取り専用で流す

- 対象: supabase/checks/anon_privileges.sql 9〜14 行（managed）と 15〜54 行。supabase/migrations/0008_privilege_checks.sql。
- 問題: 書き換え前の検査は、0005 の適用時に postgres の役割で本番を通っている。そのとき `role_table_grants` と `role_usage_grants` が返したのは、grantor か grantee が postgres の有効な役割である行だけ。書き換え後は、基盤の役割（supabase_admin など）が与えた権限もすべて見える。次が `managed` の外にあれば、本番で初めて違反になる。**以下は推測で、本番の状態は確かめていない。**
  - 基盤の役割が所有するドメイン（既定で PUBLIC に USAGE。書き換え前は grantor が見えず、出なかったはず）。
  - 基盤の役割が anon / authenticated / PUBLIC に与えた、表・シーケンスへの権限。候補は拡張が作るスキーマ（vault、pgbouncer、net、cron、pgsodium など。本番にどれがあるかは未確認）。
  - 関数の PUBLIC への EXECUTE は、書き換え前も `routine_privileges` で見えていた（事実票）ので、0005 を通った時点から基盤が変わっていなければ新しくは出ない。anon / authenticated への明示の付与は新しく見える可能性がある。
  - 「schema usage」の節は書き換えておらず、本番を通っている。つまり anon と authenticated は `managed` の外のスキーマに USAGE を持たない。上の違反が出ても、そのスキーマのオブジェクトに anon は届かないので、実害ではなく一覧の調整の話になる見込み。
- 影響: 0008 が本番で失敗すると、適用は止まる（do ブロックの例外でトランザクションが戻り、何も変わらない）。安全側だが、原因を調べて検査ファイルと 0008 を直すまで、後続のマイグレーションを本番に出せない。
- 対策: 依頼者が CLI にログインし直したあと、検査ファイル 2 本を本番に読み取り専用で流す。0 行なら 0008 を適用する。違反が出たら、1 行ずつ基盤のものかを確かめ、`managed` に足すのはスキーマ単位ではなく理由を書ける最小の範囲にする（anon_privileges.sql 8 行の方針どおり）。0008 は未適用のうちは書き換えてよい。
- 根拠: 差分と事実票。ローカルで 0 行だったことは親の確認による。ローカルと本番の基盤の差は未確認。

### L-3（低）PUBLIC が違反の文で `-` と表示される節がある

- 対象: supabase/checks/anon_privileges.sql 76 行（relation grant）、84 行（default privilege）、116 行（column grant）。
- 問題: `acl.grantee::regrole::text` は、grantee が 0（PUBLIC）のとき `-` になる。今回書き換えた節（15、30、38、47 行）は `case when acl.grantee = 0 then 'PUBLIC'` で直してあるが、この 3 節は元のまま。検出はする。読み取りにくいだけ。
- 対策: 同じ `case` をこの 3 節にも入れる。0008 を直す機会があれば一緒に。
- 根拠: 文の読み取り。`0::regrole` が `-` になることは監査者の知識。

### L-4（低）カタログと関数の名前がスキーマ修飾なし

- 対象: 2 つの検査ファイルの全体（`pg_class`、`aclexplode`、`has_table_privilege` など）。
- 問題: `search_path` に pg_catalog を明示して後ろに置いた接続では、public の同名のオブジェクトが先に解決される。anon と batch_writer には CREATE がなく、public に `pub_` 以外の表や関数があれば検査自身が違反にする（134〜144 行）ので、成立には管理者の誤操作が重なる必要がある。実行する役割で結果が変わる余地として、理屈の上で残るのはここだけ。
- 対策: 直すなら `pg_catalog.` を付ける。本文が長くなるので、採否は任せる。

## 4. 書き換え前との照合（1 対 1）

| 書き換え前 | 書き換え後 | 判定 |
| --- | --- | --- |
| anon: role_table_grants（anon / authenticated / PUBLIC、managed の外） | pg_class.relacl の aclexplode（relkind r, v, m, f, p） | 同等以上。マテリアライズドビューが加わった。所有者が anon で ACL が NULL の場合だけ L-1 |
| anon: routine_privileges | pg_proc.proacl。NULL は `acldefault('f', proowner)` | 同等。既定の PUBLIC への EXECUTE を検出する |
| anon: role_usage_grants（シーケンス） | relkind `S`。NULL は `acldefault('s', relowner)` | 同等以上。USAGE だけでなく SELECT、UPDATE も出る |
| anon: role_usage_grants（ドメイン） | pg_type（typtype `d`）。NULL は `acldefault('T', typowner)` | 同等。既定の PUBLIC への USAGE を検出する |
| anon: role_usage_grants（外部データラッパー、外部サーバー） | なし | **検出できなくなった（M-1）** |
| anon: information_schema.columns（mask column） | pg_attribute（attnum > 0、削除済みを除く） | 同等以上。役割に左右されなくなった（偽の合格の解消） |
| batch_writer: role_table_grants | pg_class.relacl の aclexplode | 同等。偽の「missing table grant」の解消。所有者の場合だけ L-1 |
| batch_writer: routine_privileges | pg_proc.proacl の aclexplode | 同等。所有者の場合だけ L-1 |
| batch_writer: role_usage_grants | シーケンス、型（すべての typtype）、外部データラッパー、外部サーバー | 同等以上。所有者の場合だけ L-1 |
| スキーマ、列単位、既定権限、effective privilege、役割の所属と属性 | 変更なし | 対象外（元から pg_catalog と `has_*_privilege`） |

## 5. 問題なしと確認した項目

- `has_schema_privilege` と `has_table_privilege` は、すべて役割を名前で渡す 3 引数の形（anon 59、95、99、108 行。batch_writer 55、74、78 行）。現在の役割で判定する 2 引数の形はない。
- `'anon'::regrole`、`'authenticated'::regrole`、`'batch_writer'::regrole`、`'postgres'::regrole` は、役割がなければ誰が流してもエラーになる。0 行（偽の合格）にはならず、0008 では適用が止まる。安全側。
- 検査の本文（コメントを除く）に `information_schema.` の参照は残っていない。`managed` の値としての文字列だけ。
- 0008 は do ブロック 2 つで、select と `raise exception` だけ。grant、revoke、alter、create はない（読んだ範囲と、本文が検査ファイルと一致するというテスト I-DB-18 (10) による）。失敗すれば何も変わらない。例外の文に出るのはオブジェクト名と役割名で、秘密の値は含まない。
- .claude/rules/security.md「Supabase」: 検査は、anon は `pub_` への select だけ、batch_writer は表の名前の列挙、公開ビューには何も与えない、`bypassrls` なし、を引き続き確かめている。この変更は権限とスキーマを変えず、規則から外れる箇所はない。ADR は不要と判断した。
- 差分に、鍵、接続文字列、パスワードはない。

## 6. 範囲の外で気づいたこと（指摘には数えない）

今回の差分が触れていない節。次に検査を直すときの材料として残す。

- anon_privileges.sql 84〜90 行: 既定権限の検査は `pg_namespace` と結合するので、スキーマを指定しない `alter default privileges for role postgres grant ... to anon`（defaclnamespace が 0）を拾わない。作られた表は次の検査で違反になるので、遅れて検出される。
- どちらの検査も、データベース単位の権限（CREATE、TEMPORARY）と言語の USAGE は見ていない。書き換え前も同じ。

## 7. 未確認

| 項目 | 確認の方法 |
| --- | --- |
| 本番で検査が 0 行になるか（L-2） | 依頼者の CLI ログインのあと、2 本を読み取り専用で流す |
| `supabase_read_only_user` の実際の属性と所属（anon や何も持たない役割との差） | 本番で `select rolname, rolinherit from pg_roles` と `pg_auth_members` を読み取り専用で読む |
| 事実票の内容（information_schema の絞り込み、`acldefault` の既定） | PostgreSQL の公式文書で確認（今回は外部文書を取らない指定） |
| `role_usage_grants` が外部データラッパーと外部サーバーを空のスキーマ名で返すこと（M-1 の前提） | ローカルで、main の検査に対して `create server` と `grant usage ... to anon` を流して違反が出るかを見る |
| test_privileges.py の 1〜365 行に、M-2 の問題 2 に当たるテストがあるか | そのファイルの前半を読む |
| 0008 の 21〜155 行、166〜297 行が検査ファイルと一致すること | I-DB-18 (10) の結果（親の確認で 243 件合格）に依拠。監査者は読んでいない |
| main への merge で本番にマイグレーションが自動で適用される経路がないこと | .github/workflows/ と docs/operations/deploy.md を読む（今回は範囲外） |

## 8. 依頼者に確認してもらう項目

1. Supabase CLI にログインし直し、検査 2 本を本番に読み取り専用で流すこと（結果が 0 行かどうか）。
2. M-1 と L-1 を 0008 の適用前に直すか、適用後に 0009 で直すかの判断。監査者は適用前を勧める。
3. 0008 の本番への適用の可否（1 が 0 行のあと）。
