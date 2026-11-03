# 監査報告: バッチの Python 化と書き込み経路の変更
- 状態: 草案
- 更新日: 2026-11-03
- 範囲: ADR 0009（`batch_writer`、pooler、TLS）、ADR 0005 の運用経路（案 E1）、ADR 0004 のサプライチェーンとログ。工程は設計。未コミットの作業ツリーを対象にし、実装、リポジトリ設定、Supabase の実機は見ていない。
- 読んだファイル: ADR 0004・0005・0009、02 §3.6・§6（§4 と §8 は grep）、03 §14〜§16、06 §2・§3・§9・§10、07 I-DB-01・I-DB-18・I-B-11・S-08・S-16〜S-18・A-11 と seed の記述（grep）、01 のパッケージ管理（grep）、05_non_functional の NFR-22・40・43・44（grep）、.env.example、.claude/rules/security.md。
- 事実の扱い: 依頼の事実票にない Postgres、libpq、GitHub、Dependabot、pip-audit の仕様に頼る箇所は「（要確認）」と書いた。私の知識に基づくもので、今回は文書でも実機でも確かめていない。

## 結論
**設計を進めてよい（下記の条件つき）。** 致命的 0 件、高 0 件、中 9 件、低 7 件。`batch_writer` と名前列挙の grant、表ごとのポリシーは service role より明確に良い。書き込み経路が `security.md` から外れることは、ADR 0009 の理由で認める。
- 権限（観点 1）: 設計は最小に近い。名前列挙、`bypassrls` なし、`excluded_author` への grant とポリシーなしは適切。`counts_is_numeric` の execute も、純粋な関数なら問題ない。不足は検査の範囲（W-8）と `batch_run` の delete（L-2）。
- 秘密（観点 2）: 届く範囲は狭くなり、改善している。悪化は 3 点ある。TLS の検証が HTTPS の既定から接続設定任せになる（W-1）。任意の SQL を流すセッションを持てる（L-3）。「除外リストは漏れない」という説明は言い過ぎである（W-2）。
- E1（観点 3）: E2 より妥当。ただし手順の形（W-5）と slug の残存の確認（W-6）が条件。
- サプライチェーン（観点 4）: 入口は十分に堅い。足りないのは、公開直後の悪意ある版への備えと、PR がない日の検知（W-9）。
- ログ（観点 5）: 例外の経路はよく塞がれている。残る穴はプロセスの fd 2 に直接書かれる出力と、フックより前の import（W-7）。

## 指摘（中）
- **W-1 TLS の設定が Secret に依存し、検査を回避でき、下げる基準もない。** 対象: ADR 0009:96-100、06 §3:78、03 §16:333。問題: `sslmode` を接続文字列に頼り、`env.py` が host と `sslmode` をどう読むかが未定。libpq の URI は `?host=` が前の host を上書きする（要確認）ので、素朴な解析では `localhost` の例外を回避できる。筋道: `require` に下げた状態で経路上の能動的な攻撃者が割り込むと、内部表の読み書きができる。サーバーが平文認証を要求すれば libpq はパスワードを送る（要確認）。影響: 接続文字列の窃取と完全性の喪失。対策: (a) `sslmode` と `sslrootcert` を `psycopg.connect` のキーワードでコードから固定し、`conninfo_to_dict` で解析した実効値を検査する。`hostaddr` も確かめる。(b) libpq 16 以上なら `require_auth=scram-sha-256` を足す（pooler の対応は A-11 で確認）。`psycopg-binary` は同梱の libpq に依存するので版を確かめ、`sslrootcert=system` に頼らず CA を `apps/batch/certs/` に固定する（要確認）。(c) 実装に入る前に、認証情報なしで証明書の鎖と SAN を確かめる（確認項目 1）。(d) 下げる基準: 第 1 は verify-full + 固定した CA。第 2 は verify-ca + 固定した CA で、CA が Supabase 専用と確かめられた場合に限り、ADR に残余リスク（host 名を検証しない）を書いて認める。第 3 の `require` は本レビューでは認めない。依頼者が ADR でリスクを受容し再監査を通すまで本番に接続しない。CA の失効や交換は `network` に分類されるので、手順書に切り分けを書く。根拠: 文書の読解。関係: NFR-40、ADR 0009。
- **W-2 漏えい時の影響と対処が過小に書かれている。** 対象: ADR 0009:64、06 §2.3:48、06 §3:66。問題: 「除外リストは漏れない」は直接の select についてだけ正しい。`internal.wp_author` と `pub_author` の差で除外著者が分かる（公開情報だけでも推測できることは NFR-22 が認めている）。`pg_stat_all_tables` や `pg_class` からは件数も読める（要確認）。さらに `wp_author` や `wp_post` の slug を書き換えると `not exists` を通り抜け、除外著者の数値を公開できる。筋道: 接続文字列の漏えい → 除外の無効化 → 次回ビルドで公開。再取得の範囲（直近 7 日）より古い改ざんは残り続ける。パスワード変更では既存のセッションが切れない（要確認）。対策: ADR 0009 と 06 の文言を「除外リストの表は直接読めない。ただし書き込みで除外を崩せ、差分で推定もできる」に直す。06 §3 の対処を次の順にする: パスワード変更 → `pg_terminate_backend` で切断 → Secret 更新 → backfill で内部表を作り直す → `pub_*` に除外著者がないことを確認 → 再ビルドと旧デプロイの削除。根拠: 文書の読解。関係: NFR-40、NFR-43。
- **W-3 接続文字列がブランチに束縛されていない。** 対象: 06 §3:66、06 §9:140。問題: WIF は main に限定されるが、Secret はリポジトリ全体で使える。筋道: 書き込み権限を持つアカウントや PAT の侵害 → 別ブランチのワークフローを `workflow_dispatch` で実行 → 接続文字列を取得し、main のレビューを経ない。影響: W-2 と同じ。対策: main だけを許可した GitHub Environment の Secret に移し、`VERCEL_DEPLOY_HOOK_URL` も同様にする（public リポジトリでの可否は要確認）。`daily.yml` のジョブに `environment:` を付ける。S-10 に検査を足す。根拠: 02、03、06、07 に Environment の記述なし（grep）。関係: NFR-40、NFR-45。
- **W-4 テスト用の固定パスワードが public リポジトリに入る。** 対象: 02 §8:524、07:31。問題: I-DB-18 (5) の検査対象はマイグレーションだけで seed を見ない。筋道: `supabase/seed/test/` を本番に誤って適用する（`--include-seed` と `sql_paths`、または手作業）→ `batch_writer` のパスワードが公開値になり、架空のデータも入る。影響: 攻撃には PROJECT-REF と host も要るので、高とはしない。対策: CI では実行時にランダムな値を生成して設定する。ローカルは `.env` の値を使う。seed からパスワードをなくし、検査対象に `supabase/seed` を加える。根拠: 文書の読解。関係: NFR-40、NFR-43。
- **W-5 固定 SQL が 1 つのブロックに追加、解除、確認を並べている。** 対象: ADR 0005:63-76。筋道: 全文を貼って実行する → 追加の直後に解除され、最後の結果だけを見て見落とす → 除外が効かないまま再ビルド。影響: 申し出た著者の数値が公開され続ける。対策: 手順書で追加、解除、確認を別ブロックに分け、1 ブロックに 1 操作とする。再ビルドの前に `excluded_author` の行と `pub_author` の 0 件を確認する。根拠: 文書の読解。関係: FR-36、NFR-11。
- **W-6 slug の残存が未確認のまま E1 を採っている。** 対象: ADR 0005:78。問題: 「新しい露出ではない」は登録中についてだけ言える。解除後も履歴に slug が残ると、表からは消えた申し出の事実が保持される。ダッシュボードの AI 機能に SQL が送られる場合は、Supabase の外へ出る（未確認）。影響: 申し出の事実の残存。対策: 初回の操作の前に確認項目 3 を確かめ、残るなら手順に削除を入れる。消せないなら残存の事実と保持期間を台帳の運用（NFR-73）に書き、Q-30 の説明文面でも扱う。根拠: ADR の未確定の記述。関係: NFR-40、NFR-44。
- **W-7 stderr の塞ぎ方に順序と範囲の穴がある。** 対象: 03 §14:278・281・282、07 I-B-11。問題: (a) フックは Python の例外しか捕まえず、`GRPC_VERBOSITY` は gRPC 専用。ネイティブのライブラリや致命的エラーの出力は fd 2 に直接出る。(b) `GRPC_VERBOSITY` はワークフロー側の設定なので、I-B-11 の偽の GA4 では通らない。(c) `__main__.py` の先頭で第三者を import すると、フック登録より前の例外が既定の表示になる（isort が import を先頭に寄せる）。(d) ルートロガーのレベルでは、独自のレベルとハンドラを持つロガーを止められない。(e) `SystemExit` を通すので、文字列つきの `sys.exit` や argparse の出力は stderr に出る。筋道と影響: public のログに host、URL、行の値が出る。対策: `__main__.py` と `__init__.py` は標準ライブラリだけで最初に次を行う: `os.dup2` で fd 2 を `/dev/null` へ向ける、フック登録、`logging.disable(logging.CRITICAL)` と `logging.raiseExceptions = False`、`GRPC_VERBOSITY` の設定。その後で本体を遅延 import する。`SystemExit` は code が int 以外なら `sys.exit(1)` に置き換える。I-B-11 に (h) 閉じたポートへの実際の gRPC 呼び出し、(i) `sys.exit("msg")`、(j) import 時の例外、(k) 独自ハンドラを持つロガー、を足す。根拠: 文書の読解（ライブラリの挙動は要確認）。関係: NFR-44。
- **W-8 権限の検査が本番と、列挙した対象の外を見ていない。** 対象: 07 I-DB-18、02 §6:446-452・498-502。問題: 検査の中心は表の grant で、他のスキーマの usage、`public` と `internal` の CREATE、関数とシーケンスの grant、ロールの所属が網羅されていない。Supabase の既定権限は未確認（02:487）。`if not exists` は既存ロールの属性を直さない。マイグレーション末尾の検査 4 項目に `batch_writer` が入っていない。筋道と影響: 本番の手変更や既定権限で広がった権限に気づけない。対策: I-DB-18 に、全スキーマの `has_schema_privilege`（USAGE、CREATE。許可は `internal` の USAGE と、PUBLIC 経由を確認した `public` だけ）、`routine_privileges` と `role_usage_grants`（`counts_is_numeric` と必要なシーケンスだけ）、`pg_auth_members` の 0 件を足す。同じ SQL をマイグレーション末尾と A-11 の本番確認にも置く。根拠: 文書の読解。関係: NFR-43、ADR 0009。
- **W-9 依存の更新に公開直後の版と PR のない日への備えがない。** 対象: 06 §10:147-150、ADR 0004:68、07 S-08。評価: ハッシュ固定と wheel のみは、インストール時の実行と差し替えを止める。ただし wheel のコードは import 時に接続文字列の下で動く。問題: pip-audit は merge 前だけなので、PR のない日に公表された脆弱性を止めない（security.md「依存」）。Dependabot の自動 merge の可否も未定。筋道と影響: 悪意ある版の merge → 翌日に Secrets の下で実行。対策: Dependabot に `cooldown`（例: 7 日。セキュリティ更新を除く。要確認）を設定し、自動 merge を禁止する。週 1 の `schedule` で pip-audit と pnpm audit を流し、失敗を通知する。Dependabot が pip-compile のハッシュを再生成することを初回の PR で確かめ、S-10 で `daily.yml` の `--require-hashes --only-binary :all:` を検査する。根拠: grep で記述なし。関係: NFR-45、ADR 0004。

## 指摘（低）
- **L-1** ADR 0009:85-86: `login` でパスワードなしの安全性は pooler の未検証の挙動に依存する。マイグレーションは `nologin` で作り、手順で `alter role ... login password` とすれば検証が不要になる。
- **L-2** 02 §6:466-470: 全表に同じ 4 権限を与えているので、`batch_run` の痕跡を消せる。保持期間の削除が不要なら `batch_run` の delete を外す。`generated always as identity` のシーケンスは grant なしで動く可能性がある（要確認）ので、I-DB-18 (4) が失敗するまで足さない。
- **L-3** ADR 0009:94: `set local statement_timeout` はクライアント側の設定で、悪用時の歯止めにならない。`alter role batch_writer connection limit 2` と、ロールの既定の `statement_timeout` を足す。Free の容量を埋める攻撃は防げないので、W-2 の対処に含める。
- **L-4** ADR 0009:85: `alter role ... password` の平文は SQL エディタの履歴やサーバーログに残りうる（Postgres の文書の注意。要確認）。見られるのはダッシュボードの権限者なので影響は小さい。SCRAM の verifier を事前に作って渡せるか、pooler との互換を含めて確かめる。
- **L-5** 03 §14:279、07 S-18: `str(e)` の grep は `str(exc)` や `f"{e}"`、`__context__`、`__traceback__`、`logging.exception`、`traceback.format_exception` を見逃す。`ast` のテストで、`except ... as` の束縛名を `classify_error` への受け渡しにだけ使えるようにする。
- **L-6** 07 I-B-11 (c): 接続失敗で `batch_run` を `failed` にできないのに、全 7 通りで `failed` を要求している。03 §14 の 6 に合わせて (c) を外す。`google.auth.exceptions` と `RetryError` は分類規則にないので `unknown` になる。漏えいはしないが WIF の失敗を `auth` と判別できない。
- **L-7** 文書の差分: ADR 0009:87 と ADR 0005:79 に `internal.article_cumulative` がない（02:463、06:37 にはある）。06 §3 の「日次の取得・書き込みのステップ」に `backfill` を明記する。`colorama` は `requirements-dev` か環境マーカーに寄せ、本番のロックに入れない。pip-audit に `--disable-pip` が使えるなら足す（要確認）。

## 判定
- **ADR 0009: 条件付き承認。** 実装前に W-3、W-4、W-8、L-1 を設計へ反映する。W-1 は (a)(b)(d) を設計へ反映し、(c) は実装の着手前に済ませる。W-2 の文言と対処を直す。TLS が第 1 か第 2 の基準で成立するまで本番に接続しない。
- **ADR 0005（運用経路）: 条件付き承認。** E1 を採る。E2 は権限が最も狭いが、最も機微な表に読み書きできる長期の秘密をインターネットから届く形で端末に置くことになり、年数回の操作には釣り合わない。ダッシュボードの権限者は既に全権を持つので E1 で増える権限はない、という ADR の主張は認める。条件は W-5 の反映と、初回操作の前の W-6 の確認。
- **ADR 0004（サプライチェーンとログ）:** 案 A と P1 に異論なし。W-7 と W-9 を反映する。

## 規則の改定文言の案（適用は親。本監査では編集しない）
- `security.md` 冒頭の秘密情報: 「GA4 への認証、Supabase のバッチ用接続文字列、Vercel の環境変数」に置き換える。
- `security.md`「Supabase」の 1 項目目を 2 つに分ける: 「すべての表で RLS を有効にする。anon ロールには、公開用のビューまたは表に対する select 以外の権限を与えない。」「自動の書き込みは専用ロール `batch_writer` だけが行う。権限とポリシーは表の名前を列挙して与え、`all tables in schema`、`alter default privileges ... to`、`bypassrls` を使わない。除外リストと公開ビューには何も与えない。service role キーは使わず、どこにも置かない。」
- 同節に追加: 「手動の書き込みは、運用手順の固定の SQL で除外リストの行を変える場合に限る。ロールのパスワードは運用手順で設定し、マイグレーションとシードに書かない。この 2 つの操作は、ダッシュボードでの手変更を禁じる規則の例外とする。スキーマと権限の変更はこの例外に含めない。」
- `security.md`「秘密情報」に追加: 「DB への接続は接続先の証明書を検証する（`sslmode=verify-full`）。下げるときは ADR に理由を書き、security-auditor のレビューを受ける。」
- NFR-43: 「書き込みは service role だけ」を「自動の書き込みは専用ロール `batch_writer` だけ、手動の書き込みは除外リストの固定の SQL だけ」に置き換える（要件の担当へ）。
- `.claude/agents/security-auditor.md` の脅威モデルと観点 2・4 も service role を前提にしている。「Supabase に書けるのは Actions のバッチだけ」は人の手動操作と食い違うので、上と揃える（親へ）。

## 依頼者に確認してもらう項目
1. 認証情報なしで pooler の証明書を確かめる（実装の着手前）: 自分のプロジェクトの host に `openssl s_client -starttls postgres -connect <POOLER-HOST>:5432 -showcerts` を実行し、発行元と SAN が host と合うか、Supabase が配布する CA で検証できるかを見る。結果の host 名と PROJECT-REF を文書やログに書かない。
2. Supabase の「SSL の強制」の設定があれば有効にできるか。pooler にも効くか。
3. SQL エディタの履歴、自動保存、Postgres ログ、監査ログ、AI 機能に、slug と `alter role` の文が残るか、外部へ送られるか。残る場合の削除方法と保持期間。組織の AI のオプトインの状態。
4. GitHub Environment のブランチ制限が使えるか（W-3）。Supabase と GitHub の管理者全員に多要素認証が有効か。組織のメンバーの一覧。

## 未確認
- 未検証のまま文書に残る項目（確認方法は ADR 0009 の未確定と A-11）: pooler の verify-full、パスワードなしのログイン拒否、pipeline mode、ランナーからの到達、Supabase の既定権限。実装がないので、`counts_is_numeric` の本文と `search_path` の固定、Dependabot の設定、実際のログ出力も未確認（実装後に I-DB-18、I-B-11、S-18 で確かめる）。`gh api` によるリポジトリ設定の確認と git 履歴の秘密の走査は、依頼の範囲外として行っていない。

## 問題なしと確認した項目（文書の記述として）
- `.env.example` は名前だけで、`NEXT_PUBLIC_` と service role キーがない。`SUPABASE_BATCH_DB_URL` は Actions のみ、anon キーは Vercel のみと 03 §16、06 §3 で一貫している。パスワードは 32 文字以上のランダムな英数字で、マイグレーションに書かない。
- `excluded_author` は grant もポリシーもなく、`bypassrls` なしの fail-closed の 2 重の閉じ方である。`article_cumulative` と `benchmark_curve` にも grant がなく、S-17 と I-DB-18 に検査がある。所有者権限のビューが RLS を通らない点は、06 §2.3 が明記し、RLS を守りに数えていない。
