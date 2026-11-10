# 06 セキュリティ

- 状態: 確定（2026-11-04。依頼者の確認済み。実装時の確認項目は ADR 0009 にある）
- 更新日: 2026-11-10
- 参照: .claude/rules/security.md（原本）、NFR-20〜NFR-22、NFR-30〜NFR-45、NFR-91、FR-36（初回対象外）、ADR 0002、ADR 0003、ADR 0004、ADR 0005（保留）、ADR 0006、ADR 0009、ADR 0011（レビュー中）、docs/operations/initial_setup.md
- 変更履歴:
  - 2026-11-03: 設計レビュー（audits/2026-11-03-design-review.md）の H-1・M-1〜M-8・L-1〜L-10 と Q-36 を反映
  - 2026-11-03: バッチを Python に（ADR 0004）、書き込みを専用ロール `batch_writer` と接続文字列 `SUPABASE_BATCH_DB_URL` に（ADR 0009）、除外リストの変更を SQL エディタに（ADR 0005）。service role キーを配らない形に変更
  - 2026-11-03: 書き込み経路の監査（以下「経路監査」。docs/security/audits/2026-11-03-write-path-review.md）の W-1〜W-3、W-5、W-6、W-9、L-1〜L-4、L-7 を反映（§2.3 の漏えい時の影響、§3 の対処の順序と TLS、§5 の手順、§9 の Environment、§10 の依存の更新、§13）
  - 2026-11-04: 著者の除外（FR-36）を初回対象外に（依頼者の決定、ADR 0005 保留）。§5 を置き換え、§1、§2、§3、§4、§12、§13 の除外リストの記述を外した
  - 2026-11-04: tech-writer の整合確認。Q-12 の確定を反映（§3、§10、§13）。TLS の基準を第 1 に合わせた（§3、§13）
  - 2026-11-07: D-17 を ADR 0010 で確定。§6 の CSP を実装の値にし、§7 に値を文字として描く規則と検索語の扱いを足し、§13 から D-17 を外した
  - 2026-11-09: §11 に WP REST API の中継（ADR 0011）の項目を足した
  - 2026-11-10: §6 の CSP に、BI 自身の閲覧の計測（GA4、ADR 0013）のときだけ足す送り先を書いた

## 1. 守る資産と前提

- 守る資産は 3 つ: 訪問者のプライバシー（公開するのは集計値だけ）、秘密情報（GA4 への認証、Supabase の接続文字列 `SUPABASE_BATCH_DB_URL`、Vercel の環境変数、Deploy Hook）、BI データの完全性（第三者が Supabase に書けない、BI が改ざんされない）。
- 前提: ログインなし（NFR-20）、URL を知る人だけが見る形で noindex（NFR-21）、public リポジトリ、無料枠。「運営が見る」と「全員が見る」が同じ。
- BI は静的サイト（ADR 0006）。実行時にサーバー側のコードが利用者の入力を受け取る経路はない。利用者の入力はブラウザ内の状態（期間、フィルタ）と URL のパスだけ。

## 2. 認証・認可

### 2.1 BI の閲覧（ログインなし、noindex）

- 認証はない。すべてのページを誰でも読める。したがって公開ビュー（02 §4）に載るものがそのまま公開範囲になる（§4）。
- noindex（NFR-21）を 3 重に付ける: (1) 全ページの `<meta name="robots" content="noindex, nofollow">`、(2) 応答ヘッダ `X-Robots-Tag: noindex, nofollow`（§6）、(3) `/robots.txt` に `User-agent: *` / `Disallow: /`。ライター別ビューと記事詳細も同じ（特別扱いせず全ページに付ける）。
- Vercel の Deployment Protection は「Standard Protection」（本番ドメイン以外のすべてのデプロイ URL を Vercel Authentication で保護。Hobby で利用可）を有効にする（設計レビュー M-6）。本番ドメインはログインなし（決定どおり）。理由: 毎日のビルドは固有 URL を持つデプロイとして Vercel に残り、その URL が誰でも開けると、Supabase 側で持たない移動窓の全履歴（ADR 0003 判断 3、02 §2.2）が外部から読める。プレビューも同じ保護の中に入る。Hobby プランでこの設定が可能かの最終確認は依頼者（§13）。
- サイトマップは作らない。外部へのリンクは takatsu-connect.com 配下だけ（FR-04、§7）。例外はフッタの制作者（Small Piece）への固定の 1 つの URL（ADR 0012）。

### 2.2 GA4 への認証（WIF）

- Workload Identity Federation。サービスアカウント（SA）の JSON 鍵は作らない（NFR-41、ADR 0002）。手順は initial_setup.md §2。
- 属性条件は `assertion.repository == 'takatsu-connect/access-analyzer' && assertion.ref == 'refs/heads/main'`。main 以外のブランチや fork からのトークンでは SA になりすませない。加えて `assertion.repository_id == '<このリポジトリの数値 ID>'` を条件に加える（設計レビュー L-10。リポジトリ名の変更・移管・同名の再作成に備える。属性マッピングに `attribute.repository_id = assertion.repository_id` を追加）。GCP 側の作業はデプロイ工程（initial_setup.md は親が直す）。ADR 0002「結果」に追記。
- SA の権限は GA4 プロパティの閲覧者だけ。GCP プロジェクトのロールは持たない。ローカル確認のために付けた「サービス アカウント トークン作成者」は、WIF 移行後に外す（initial_setup.md §2 前提）。
- トークンは 1 時間有効。バッチの所要時間は通常 2〜4 分、バックフィルで 10 分未満。1 時間を超える設計にしない。
- `id-token: write` は認証するジョブ（バッチ本体）だけに付ける。heartbeat は別ワークフロー（`heartbeat.yml`、03 §12、§9）で、`id-token` を持たず Secrets も参照しない。

### 2.3 Supabase の権限（RLS、公開ビュー、専用ロール）

| ロール | 使う場所 | 権限 |
| --- | --- | --- |
| `batch_writer` | GitHub Actions のバッチだけ。Environment `production` の Secret `SUPABASE_BATCH_DB_URL`（shared pooler の session mode、TLS。ADR 0009） | 許可した内部表の select / insert / update / delete（`batch_run` は delete なし。経路監査 L-2）、必要な場合だけシーケンスの usage、`internal.counts_is_numeric` の execute。接続の上限 2。`internal.article_cumulative`、`internal.benchmark_curve`、`pub_*` への権限なし。`bypassrls` なし（表ごとのポリシー。02 §6） |
| service role | 使わない。キーをどこにも置かない | `internal` と `pub_*` の権限なし（02 §6） |
| anon | Vercel のビルド（サーバー側）。環境変数 `SUPABASE_ANON_KEY`（`NEXT_PUBLIC_` を付けない） | `public.pub_*` ビューの select のみ。`internal` スキーマへの usage なし |
| authenticated、PUBLIC | 使わない | grant なし。`internal` への usage なし。関数の EXECUTE も PUBLIC から取り消す（L-4） |
| 運用担当（人） | Supabase ダッシュボード / CLI | スキーマはマイグレーションだけで変える。`batch_writer` のパスワードの設定とローテーションは SQL エディタで行う（ADR 0009） |

- 内部表は `internal` スキーマに置き、Supabase の API 設定「Exposed schemas」に含めない（設計レビュー M-7。多層防御: 誤って `grant select on all tables in schema public to anon` を流しても、`internal` の表は PostgREST から見えない）。公開ビュー `pub_*` だけを `public` に置く。`public` には他のオブジェクトを置かない。
- 全表で RLS 有効。ポリシーは `batch_writer` 用だけ。anon / authenticated / PUBLIC / service_role への grant なし。既定権限も取り消す（02 §6）。
- 公開ビューは所有者（postgres）の権限で `internal` の表を読む（既定のビュー。`security_invoker` を付けない）。anon は内部表に触れず、ビューの投影だけを読む。**所有者権限のビューは base 表の RLS を通らないので、RLS は守りに数えない。実効的な守りは grant（anon は `pub_*` の select だけ）と `internal` スキーマの非公開（usage なし、Exposed schemas に含めない）である。** 各ビューの列は 02 §4・§5 の対応表で「公開してよい列だけ」を確認し、CI で列集合のスナップショットと照合する（07 I-DB-16）。列を足すときは NFR-39 の手順。
- anon キーはブラウザに渡さない（NFR-42）。BI は静的サイトなので、ブラウザから Supabase に接続するコードを持たない。`NEXT_PUBLIC_SUPABASE_*` という名前の環境変数を作らない（CI で名前を検査する。07 S-01）。名前の検査だけでは `apps/web/src/data/` がクライアントコンポーネントから import されたときの混入を防げないため、ビルド後の `.next/static` に `SUPABASE_URL` の値と anon キーの先頭 20 文字が含まれないことも CI で検査する（設計レビュー L-5。07 S-14、E-04）。
- anon キーが漏れた場合の影響は「公開ビューを誰でも直接読める」で、BI に出ているものと同じ。影響が小さいからこそ Vercel には anon キーだけを置く。
- `SUPABASE_BATCH_DB_URL` が漏れた場合の影響は「内部表の読み書き」で、BI の完全性を失う。伏せ値の適用前の生値（05 §4.1 で伏せ値なしとされた値）も読める。書き込みで内部表を改ざんでき、次回のビルドで BI に出る（W-2）。再取得の範囲（直近 7 日）より古い改ざんは日次バッチでは直らない。Free の容量を埋める攻撃も防げない（経路監査 L-3）。対処は §3 の順序で行う（ADR 0009「漏えい時の影響」）。
- Supabase の API 設定で「Exposed schemas」は `public` のみ（`internal` を含めない。M-7）。`graphql_public` は使わないので無効にする。Realtime、Storage、Auth は使わない。
- 自動の書き込み経路は Actions だけ。運用担当が SQL エディタで行う手動の操作は `batch_writer` のパスワードの設定とローテーションだけで、表の行は変えない。BI から Supabase に書く機能はない（NFR-22）。

### 2.4 Vercel

- 環境変数: `SUPABASE_URL`、`SUPABASE_ANON_KEY` の 2 つだけ。Production と Preview に同じ値（データは公開ビューだけ）。
- Git 連携: main への push で本番をビルド。fork からの PR はプレビューをビルドしない設定にする（Vercel の Git 設定で確認。確認できなければ Preview の環境変数を空にして、プレビューはビルドだけ通す）。
- Deploy Hook の URL は main だけを許可した GitHub Environment の Secret `VERCEL_DEPLOY_HOOK_URL` にだけ置く（§9）。呼び出しはバッチの `httpx.post` で、応答本文と URL をログに出さない（L-8、03 §8）。漏れた場合の影響は「第三者が再ビルドを起こせる」（Hobby のデプロイ 1 日 100 回の消費で日次ビルドが失敗）。漏れたら Vercel 側で Hook を作り直す。
- 過去デプロイ（設計レビュー M-6）: Deployment Protection の Standard Protection（§2.1）で本番ドメイン以外のデプロイ URL を閉じる。保持するデプロイ数は最小にし、§3 の漏えい時の対処の後は、改ざんされた値を含みうる旧デプロイを Vercel のダッシュボードまたは CLI で削除する。この手順は docs/operations/（デプロイ工程、devops-engineer）に書く。
- Vercel のアカウント所有者は docs/operations/ に記録する（NFR-60）。

## 3. 秘密情報の管理

| 秘密 | 置き場所 | 置かない場所 | 漏れたときの対処 |
| --- | --- | --- | --- |
| GCP_WORKLOAD_IDENTITY_PROVIDER、GCP_SERVICE_ACCOUNT | Actions Secrets | YAML、文書 | 秘密ではないが公開 YAML に埋め込まない。属性条件があるので単体では使えない |
| GA4_PROPERTY_ID | Actions Secrets | 文書、ログ | 単体では読めないが、文書に書かない（NFR-40） |
| SUPABASE_BATCH_DB_URL（`batch_writer` のパスワードを含む） | main だけを許可した GitHub Environment（`production`）の Secret のみ（W-3、§9）。`daily` と `backfill` の取得・書き込みのステップだけに渡す。`publish_only` のステップには渡さない | リポジトリの Secret、Vercel、マイグレーション、seed、文書、ログ、開発者のローカル（開発ではローカルの Supabase に接続する） | 下の「`SUPABASE_BATCH_DB_URL` が漏れたときの対処」の順序で行う。定期ローテーション（例: 年 1 回）と、運用担当の退任時の変更を docs/operations/ の対象に含める |
| Supabase の service role キー | どこにも置かない（使わない。ADR 0009） | すべて | Supabase で再発行する |
| Supabase の `postgres` のパスワード | マイグレーションの適用のときに運用担当が入力する（保存先は docs/operations/ で決める。リポジトリには置かない） | リポジトリ、Actions、Vercel | Supabase でリセットする |
| SUPABASE_ANON_KEY | Vercel 環境変数（サーバー / ビルド）、Actions には不要 | `NEXT_PUBLIC_*`、クライアントのバンドル | 影響は公開ビューの直接読み出しのみ。ローテーションは任意 |
| VERCEL_DEPLOY_HOOK_URL | main だけを許可した GitHub Environment（`production`）の Secret（W-3） | リポジトリの Secret | Hook を再作成 |
| 失敗通知 | 秘密を置かない（GitHub のメール。Q-12 確定） | ― | ― |
| ローカルの鍵（開発者の `.env`、`credentials/`） | `.gitignore` 済みのパス | 別の場所 | ローテーション |

- `.env.example` には名前だけを書く（03 §16 の表の名前）。
- 秘密を含みうる値はログ、エラーメッセージ、コミットメッセージ、Issue（beads を含む）、文書に書かない（NFR-44）。
- 秘密が git 履歴に入ったら、履歴を消す前に無効化と再発行をする。
- バッチで秘密を読むのは `apps/batch/src/takatsu_batch/env.py` の 1 か所に限り、pydantic（`hide_input_in_errors=True`、`SecretStr`）で必須・形式を検証する。検証に失敗したときのメッセージは変数名だけ（値を出さない）。
- DB 接続の TLS（W-1、ADR 0009「TLS」）: 接続先の証明書を検証する。第 1 の基準は verify-full + 固定した CA で、これを採用した（2026-11-04、ADR 0009）。第 2 は verify-ca + 固定した CA で、CA が Supabase 専用と確かめられた場合に限り、ADR に残余リスク（host 名を検証しない）を書いて認める。第 3 の `require` は認めない。依頼者が ADR でリスクを受容し再監査を通すまで本番に接続しない。`sslmode` と `sslrootcert` は `psycopg.connect` のキーワードでコードから固定し（CA は `apps/batch/certs/`）、接続文字列に頼らない。`env.py` は `conninfo_to_dict` で解析した実効値を検査し、`host`、`port`、`user`、`password`、`dbname` 以外のキーがあれば失敗にする。TLS なしの接続は、`host` の実効値が `localhost` / `127.0.0.1` のときだけ。

`SUPABASE_BATCH_DB_URL` が漏れたときの対処（W-2。順序を守る）:

1. SQL エディタで `alter role batch_writer with password` を実行してパスワードを変更する。
2. `pg_terminate_backend` で `batch_writer` の既存のセッションを切断する（パスワード変更では既存のセッションが切れない前提で扱う。要確認 ADR 0009 V-4）。
3. Environment の Secret を更新する。
4. `backfill` で内部表を作り直す（03 §10。消えない行の扱いは 03 §17 で未確定）。直近 7 日より古い改ざんは日次バッチでは直らないので、省略しない。
5. 再ビルドして、旧デプロイを削除する（§2.4）。

容量を埋められた場合（経路監査 L-3）は、4 の前に不要な行を消し、Free の容量の状況を確かめる。手順の詳細は docs/operations/ に書く。

## 4. 公開範囲（データ）

- 公開するのは 02 §4 の `pub_*` ビューの列だけ。すべて集計値（NFR-30）。次元は NFR-31 の一覧（記事、著者の表示名、カテゴリ、タグ、日付・曜日・時間帯、デバイス、流入チャネル、参照元ドメイン、都道府県と市）に収まる。
- 取得も格納もしないもの（NFR-32）: ユーザー ID、クライアント ID、完全な参照 URL（pageReferrer、pageLocation）、サイト内検索語、フォーム送信（件数を含む）、IP、市より細かい地域、リアルタイム、`customEvent:*`（D-15 の診断もバッチには入れない。L-2）。GA4 への問い合わせは 03 §5.4 の一覧（G1〜G17、G19、G20 の 19 種。G18 は初回対象外）に限る。
- 伏せ値（NFR-33、ADR 0003）: バッチが格納時に適用。公開ビューには伏せ済みの値だけ。二次伏せの区別を公開しない。0 は伏せず、二次伏せの候補は T 以上の最小セル（M-1）。著者 × 内訳軸 は階層差分の対策あり（M-2）。曜日 × 時間帯 にも二次伏せを適用する（L-1）。
- `pub_posting_period` に著者数を置かない（M-5）。シェア数は初回対象外で表・列・問い合わせがない（M-4）。
- 著者は表示名と著者ページ URL（slug）だけ（NFR-35）。アバターは使わない。slug は画面に文字列として出さない（リンクの href だけ）。
- 順位表・著者の数値並べ替えは作らない（NFR-36）。公開ビューに著者を並べ替えるための列（合計など）は `pub_author_period` に存在するが、これは FR-31 の本人向け表示に要るもので、BI がこれを使って著者一覧を数値で並べないことを 05_screens.md と 07_test_plan.md（2 回目）で縛る。
- 比較の相手は前期間・全体の分布・自分の過去の 3 つ（NFR-95）。公開ビューに他の著者との比較値は置かない。

## 5. 著者の非表示（初回対象外）

- ライターの非表示の申し出への対応は申し出があったときに考え、除外の仕組みを初回で作らない（2026-11-04、依頼者の決定。FR-36、D-10）。除外の表、公開ビューの除外条件、変更の手順、台帳、画面の説明文はない。
- 公開ビューに載る記事と著者は、WP REST API が公開している範囲のすべて（NFR-34）。
- 追加する場合は NFR-39 の手順に従う。検討の出発点は ADR 0005（保留）と ADR 0003 判断 4。

## 6. 応答ヘッダ

Next.js の `headers()`（`next.config`）で全パスに付ける（NFR-91）。

| ヘッダ | 値 | 備考 |
| --- | --- | --- |
| Content-Security-Policy | `default-src 'self'; script-src 'self' 'unsafe-inline'; script-src-attr 'none'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'` | 外部スクリプト・外部接続なし（Supabase にはブラウザから接続しない）。`style-src` は `'self'`（2026-11-03、ADR 0008。React の `style` prop を lint で禁止する。07 §7 S-03）。`script-src` の `'unsafe-inline'` は、App Router の静的生成が出すインラインの script のため（2026-11-07、ADR 0010 で確定。nonce は静的生成と両立せず、hash は配り方が未確認）。かわりに、`script-src-attr 'none'` でイベントハンドラの属性を止め、値を HTML として描く書き方を lint で禁止し（無効化コメントも不可）、E2E で CSP の指示の集合の完全一致、インラインの script の形、HTML の形の文字列が文字として出ることを確かめる（ADR 0010 の 1〜8）。第三者のスクリプト（Vercel の Web Analytics、Speed Insights、Toolbar を含む）は足さない。例外は BI 自身の閲覧の計測（GA4、FR-77、ADR 0013）で、本番で `BI_GA4_MEASUREMENT_ID` があるときだけ、`script-src` に `https://www.googletagmanager.com`、`img-src` に同じものと `https://*.google-analytics.com`、`connect-src` にそれらと `https://*.google.com` を足す（値は `apps/web/src/lib/csp.ts`） |
| X-Content-Type-Options | `nosniff` | |
| Referrer-Policy | `strict-origin-when-cross-origin` | takatsu-connect.com への遷移で BI の URL パスを送らない |
| X-Frame-Options | `DENY` | CSP の frame-ancestors と二重 |
| X-Robots-Tag | `noindex, nofollow` | NFR-21 |
| Permissions-Policy | `camera=(), microphone=(), geolocation=()` | 使わない機能を閉じる |
| Strict-Transport-Security | Vercel が付ける既定に従う | |

## 7. 入力の検証

- 静的サイトなので、サーバーが実行時に利用者の入力を処理することはない。検証はビルド時とクライアント側で行う。
- ビルド時: `generateStaticParams` は `pub_post.post_id`（整数）と `pub_author.author_slug`（`^[a-z0-9-]{1,64}$`。形の定義は `apps/web/src/lib/query.ts` の 1 か所）だけからパスを作る。`dynamicParams = false`。
- クライアント側: URL のクエリ（期間、フィルタ、選択）は許可リストで検証する（期間は `last7` / `last28` / `last90` / `mYYYY-MM` の形、カテゴリ・タグは埋め込んだ一覧にある ID、著者は埋め込んだ一覧にある slug）。許可されない値は既定値（直近 28 日、フィルタなし）に戻し、エラーを出さない。
- 文字列を問い合わせに埋め込む箇所はない（ビルド時の Supabase 読み出しは supabase-js のパラメータ化された API を使い、フィルタ値は上記の検証済みの値だけ）。
- 記事の題名、著者名、カテゴリ名、タグ名、参照元ドメインと、URL のクエリ由来の値（S-02e の検索語 `q`）は、HTML ではない文字列として、テキストと属性値にだけ使う（ADR 0010 の 2）。参照元ドメインは、ドメインの形でない行を表から落とす（04 §5）。検索語は送られず、問い合わせにも正規表現にも入らない。
- 外部リンクは `pub_post.post_url`、`pub_author.author_url` の値だけを使い、バッチが `https://takatsu-connect.com/` 配下であることを検証済み（03 §4）。BI 側でも描画前に同じ検証をし、違えばリンクにしない。例外として、フッタの制作者のリンクだけは、コードの定数 `SMALLPIECE_URL` と完全に一致するときに通す（ADR 0012。U-26、E-16）。
- エラー画面（404、500）は固定文。スタックトレース、内部 URL、SQL を出さない（Next.js の production ビルドの既定）。

## 8. ログと通知の規律

- 03 §15 のとおり。出すのは件数・所要時間・エラーの種別だけ。ロガーの関数を限定し、任意のオブジェクトを出せないようにする。
- 失敗通知（FR-74）の文面: ワークフロー名、基準日、失敗した工程、エラーの種別、Actions の run URL。API の応答・行データ・秘密を含めない。
- `batch_run` も同じ規律（02 §3.6）。`pub_batch_run` に出すのは状態と工程名と種別だけ。
- Vercel の Runtime Logs は静的サイトなのでほぼ発生しない。ビルドログにデータを出さない（ビルド時の読み出しは件数だけを `console.log` する）。

## 9. GitHub Actions の規律

NFR-45 と security.md「GitHub Actions」をワークフローの形に落とす。詳細な YAML はデプロイ工程（devops-engineer）。

- 日次ワークフロー（`daily.yml`）: 先頭で `permissions: contents: read`。バッチジョブに `id-token: write` を追加。`contents: write` を持つジョブを置かない。
- heartbeat（`heartbeat.yml`、設計レビュー M-3、03 §12）: 別ワークフロー。月 1 回の `schedule`、ワークフロー全体で `permissions: contents: write` のみ。中身は `actions/checkout`（GitHub 製、SHA 固定、`sparse-checkout: ops/`、`fetch-depth: 1`）と `git` CLI だけで、依存のインストール、プロジェクトコード、サードパーティ Action、Secrets の参照を置かない。理由: 日次ワークフロー内に `contents: write` があると、そのジョブの依存や Action が侵害されたときに main へコードを push でき（GITHUB_TOKEN はワークフローファイルは変えられないが `apps/` は変えられる）、翌日のバッチが接続文字列と WIF の下でそれを実行する。CI（07 S-10）で「`contents: write` は `heartbeat.yml` だけ」「`heartbeat.yml` に `actions/checkout` 以外の `uses:` と、`run:` の `pnpm`・`pip`・`python` がない」を検査する。
- Secret のブランチへの束縛（W-3、ADR 0009）: main だけを許可した GitHub Environment（名前は `production`）に `SUPABASE_BATCH_DB_URL` と `VERCEL_DEPLOY_HOOK_URL` を置き、`daily.yml` のジョブに `environment: production` を付ける。同名の Secret をリポジトリの Secret に残さない。WIF は main に限定されるがリポジトリの Secret は全ブランチのワークフローから使えるので、書き込み権限を持つアカウントや PAT の侵害で、別ブランチの `workflow_dispatch` から接続文字列を取得できてしまう。`heartbeat.yml` と `ci.yml` には Environment を付けない。public リポジトリと organization のプランで使えるかは実装前に親が確認する（ADR 0009 確認項目 4）。使えない場合の代替は GCP Secret Manager + main に限定した WIF（ADR 0009）。Environment を付けたジョブの OIDC トークンと WIF の属性条件の関係は要確認（ADR 0009 V-2）。
- 依存の監査（W-9、§10）: `audit.yml` を週 1 の `schedule` で動かす。`permissions: contents: read` だけで、Secrets と Environment を参照しない。
- `pull_request_target` を使わない。PR 用の CI（lint、test）は `pull_request` で、Secrets を参照しない。
- Action はすべて commit SHA 固定。`daily.yml` は `actions/checkout`、`actions/setup-python`、`google-github-actions/auth` だけ。`ci.yml` は加えて `actions/setup-node` と `pnpm/action-setup`。`audit.yml` は `ci.yml` の範囲だけ。`astral-sh/setup-uv` など許可の確認が要る Action は使わない（ADR 0004）。コメントにバージョン。Dependabot（`github-actions` エコシステム、週 1）で更新。
- `schedule` は main のみ。`workflow_dispatch` の入力は `mode`（`daily` / `backfill` / `publish_only`）、`from`、`to`、`base_date` に限り、文字列はバッチ側で pydantic で検証する。
- 未処理例外はエントリの `try / except BaseException` と `sys.excepthook`、`threading.excepthook`、`sys.unraisablehook` で捕まえ、種別だけを出す（M-8、03 §14）。起動の最初に fd 2 を `/dev/null` へ向け、第三者のライブラリと本体はその後で遅延 import する（W-7）。psycopg の例外（接続先、ユーザー名、行の値を含みうる）のメッセージと `diag` を使わない。
- Secrets を `echo` しない。`::add-mask::` は使う機会がないようにする（秘密を出力しない）。
- 設定済みのリポジトリ側の制限（initial_setup.md §1）: Action は SHA 固定必須、許可は GitHub 製 + verified creators + google-github-actions/*、fork PR のワークフローは承認制、main の force push と削除を禁止。

## 10. 依存の管理

- バッチの `requirements.txt`、`requirements-dev.txt`（ハッシュ固定）と BI の `apps/web/pnpm-lock.yaml` をコミットする。Dependabot を `pip`（`/apps/batch`）、`npm`（`/apps/web`）、`github-actions`（`/`）で有効にする。
- CI で `pip-audit --require-hashes -r apps/batch/requirements.txt` と `pnpm audit --audit-level=high`（`apps/web`）を実行し、致命的・高が残った状態でデプロイしない（Vercel のビルドは CI とは別なので、main への merge 前の CI で止める）。`pip-audit` は深刻度で絞れないので、脆弱性が 1 件でもあれば失敗にし、誤検知や修正版のないものは `--ignore-vuln` に理由つきで足す。`--disable-pip` が使えるなら足す（要確認 ADR 0009 V-6）。
- merge 前の CI だけでは、PR のない日に公表された脆弱性を止められない。週 1 の `schedule`（`audit.yml`。§9）で同じ `pip-audit` と `pnpm audit` を流し、失敗を通知する（通知先は 03 §14 の失敗通知と同じ GitHub のメール。Q-12 確定）（W-9）。
- Dependabot の更新（W-9）: `cooldown`（例: 7 日。セキュリティ更新を除く。設定の形とセキュリティ更新の扱いは要確認 ADR 0009 V-6）を設定する。wheel のコードは import 時に接続文字列の下で動くので、公開直後の悪意ある版を merge すると翌日に Secrets の下で実行される。自動 merge を禁止し、人が merge する。Dependabot が pip-compile のハッシュを再生成することを初回の PR で確かめる。再生成しないと分かったら、この節の更新手順を見直す。
- Python の依存は wheel だけを入れる（`--only-binary :all:`）。インストール時にビルドスクリプトを実行しない。S-10 で `daily.yml` の `--require-hashes --only-binary :all:` を検査する。
- 開発でしか要らない依存を本番のロックに入れない。`colorama` は `requirements-dev.in` に置く（経路監査 L-7）。
- 依存を足すときは必要性と保守状況を確かめ、コミットメッセージに理由を書く。初回の依存一覧は 01_tech_stack.md。

## 11. 対象サイトへの配慮

- WP REST API は日次バッチだけ、1 秒以上の間隔、差分取得（03 §4）。`User-Agent` に連絡先（リポジトリ URL）を入れる。
- バッチは WP REST API を日本の IP の中継（`apps/wp-relay`、Vercel の関数、hnd1）経由で読む（ADR 0011。レビュー中）。対象サイトの国外制限は緩めない。中継は経路であり、問い合わせの主体はバッチのまま（NFR-72）。
  - 認証: 共有トークン `WP_RELAY_TOKEN`。置き場は Environment `production` の Secret と Vercel の Production の環境変数だけ（NFR-44）。接続先 `WP_RELAY_URL` も Environment の Secret に置く。未設定なら全拒否（fail closed）。Deployment Protection を認証の手段にしない。
  - 入力: メソッドは GET、パスとクエリは許可リストの完全一致（ADR 0011 §2）。転送先は定数で、入力から作らない。ログイン画面、`wp-admin`、`xmlrpc.php` には届かない。
  - 中継に cron、ヘルスチェック、事前取得、再試行を持たせない。受けた 1 リクエストが WP への最大 1 リクエストになる。
  - ログは `outcome`、`status`、`duration_ms` だけ。トークン、クエリの値、著者の ID、本文を出さない。Vercel の基盤のログの項目と保持期間は未確認（ADR 0011 §5）。
  - 手順はコードで強制できないものを含むので、docs/operations/deploy.md 手順 8.5 と runbook.md §8.6、§9.4、§14 に従う（Git 連携なし、プレビューなし、過去のデプロイの削除、ロールバックの禁止）。
  - §2、§3、§7〜§9、§12、§13 への反映は ADR 0011 の確定のときに行う。
- 対象サイトと本番 BI に能動的な試験（スキャン、負荷試験）をしない。E2E テストはプレビュー環境と、WP REST API のモックに対して行う（07_test_plan.md、2 回目）。
- 対象サイトの WordPress を変更する操作はしない。

## 12. 要件との対応

| 要件 | 設計 |
| --- | --- |
| NFR-20 ログインなし | §2.1 |
| NFR-21 noindex | §2.1、§6 |
| NFR-22 管理機能なし、設定の置き場所 | §2.3（書き込み経路は Actions のみ）、§5、03 §16 |
| NFR-30〜NFR-32 集計値のみ、次元の一覧、取らないもの | §4、02 §4、03 §5 |
| NFR-33 伏せ値 | 02 §2.3、03 §6.1、ADR 0003 |
| NFR-34 公開記事だけ | 03 §4 |
| NFR-35 著者は表示名と URL | 02 §3.1、§4、§7 |
| NFR-36 順位表なし | §4、05_screens.md（2 回目） |
| NFR-37 市まで | 02 §3.4、03 §5.4 G9 |
| NFR-38 参照元はドメインまで | 03 §5、02 §3.4 |
| NFR-39 変更手順 | 02 §8、03 §13 |
| NFR-40 秘密の経路 | §3 |
| NFR-41 WIF | §2.2、ADR 0002 |
| NFR-42 Supabase はサーバー側から | §2.3 |
| NFR-43 RLS、anon は公開ビューの select のみ | §2.3（`internal` スキーマ、grant、スナップショット検査）、02 §6 |
| NFR-44 ログ・通知の規律 | §8、03 §15 |
| NFR-45 Actions の規律 | §9 |
| NFR-91 入力検証、エラー応答、ヘッダ、リンク先 | §6、§7 |
| FR-36 除外 | 初回対象外（§5、ADR 0005 保留） |

## 13. 未確定

- Supabase のアドバイザが出す「security definer view」（`pub_*` が所有者権限で base 表を読む）の警告は、設計レビュー（2026-11-03、§3 判定 3）で承認された。受け入れの記録は docs/operations/（デプロイ工程）に置く。代替（`security_invoker = true` + 内部表に anon の select を許すポリシー）は内部表の列が直接読めるようになるので採らない（ADR 0007）。
- Vercel（依頼者の確認事項、設計レビュー §6）: (a) Hobby プランで Deployment Protection の Standard Protection（本番ドメイン以外のすべてのデプロイ URL の保護）が設定できるか、過去デプロイの保持数と削除の可否（M-6）。(b) fork からの PR でプレビューが作られるか、Preview の環境変数が渡るか（§2.4 の代替で足りるか）。
- GCP（依頼者の確認事項）: WIF の属性条件に `assertion.repository_id` を加える（L-10）。SA が GA4 閲覧者のみで GCP ロールを持たないこと、「サービス アカウント トークン作成者」の削除。
- Supabase（依頼者の確認事項）: Exposed schemas が `public` のみで `internal` を含まないこと、`graphql_public` の無効化。`batch_writer` の有効化とパスワードの設定。
- 実装着手前の確認項目 1〜4 と、仕様の確認 V-1〜V-6（ADR 0009「実装着手前の確認項目」）。TLS の基準は確認項目 1 の結果で第 1 に確定した。psycopg からの接続は 07 A-11 で確かめる。Environment の可否は確認項目 4（親）。
- SQL エディタの履歴などに `alter role` の文が残るか（確認項目 3。ADR 0009 経路監査 L-4）。
- ADR 0009 の残りの未確定（`executemany`、IPv4 の到達など。実装時と 07 A-11）。
- 確定: D-16（0 は伏せない。02 §2.3、M-1）、Q-33（ADR 0003 判断 5）、Q-36（ADR 0003 判断 6）、Q-12（失敗通知は GitHub のメール）、D-17（CSP の `script-src`。2026-11-07、ADR 0010）。
