# 06 セキュリティ

- 状態: 草案
- 更新日: 2026-11-03
- 参照: .claude/rules/security.md（原本）、NFR-20〜NFR-22、NFR-30〜NFR-45、NFR-91、FR-36、ADR 0002、ADR 0003、ADR 0005、ADR 0006、docs/operations/initial_setup.md

## 1. 守る資産と前提

- 守る資産は 3 つ: 訪問者のプライバシー（公開するのは集計値だけ）、秘密情報（GA4 への認証、Supabase の service role キー、Vercel の環境変数、Deploy Hook、除外リスト）、BI データの完全性（第三者が Supabase に書けない、BI が改ざんされない）。
- 前提: ログインなし（NFR-20）、URL を知る人だけが見る形で noindex（NFR-21）、public リポジトリ、無料枠。「運営が見る」と「全員が見る」が同じ。
- BI は静的サイト（ADR 0006）。実行時にサーバー側のコードが利用者の入力を受け取る経路はない。利用者の入力はブラウザ内の状態（期間、フィルタ）と URL のパスだけ。

## 2. 認証・認可

### 2.1 BI の閲覧（ログインなし、noindex）

- 認証はない。すべてのページを誰でも読める。したがって公開ビュー（02 §4）に載るものがそのまま公開範囲になる（§4）。
- noindex（NFR-21）を 3 重に付ける: (1) 全ページの `<meta name="robots" content="noindex, nofollow">`、(2) 応答ヘッダ `X-Robots-Tag: noindex, nofollow`（§6）、(3) `/robots.txt` に `User-agent: *` / `Disallow: /`。ライター別ビューと記事詳細も同じ（特別扱いせず全ページに付ける）。
- Vercel の Deployment Protection（Vercel Authentication）はプレビュー環境に有効にし、本番には付けない（本番はログインなしの決定）。プレビューは本番と同じ公開データしか含まないが、作業中の画面を外に見せない。
- サイトマップは作らない。外部へのリンクは takatsu-connect.com 配下だけ（FR-04、§7）。

### 2.2 GA4 への認証（WIF）

- Workload Identity Federation。サービスアカウント（SA）の JSON 鍵は作らない（NFR-41、ADR 0002）。手順は initial_setup.md §2。
- 属性条件は `assertion.repository == 'takatsu-connect/access-analyzer' && assertion.ref == 'refs/heads/main'`。main 以外のブランチや fork からのトークンでは SA になりすませない。
- SA の権限は GA4 プロパティの閲覧者だけ。GCP プロジェクトのロールは持たない。ローカル確認のために付けた「サービス アカウント トークン作成者」は、WIF 移行後に外す（initial_setup.md §2 前提）。
- トークンは 1 時間有効。バッチの所要時間は通常 2〜4 分、バックフィルで 10 分未満。1 時間を超える設計にしない。
- `id-token: write` は認証するジョブ（バッチ本体）だけに付ける。heartbeat ジョブ（03 §12）には付けない。

### 2.3 Supabase の権限（RLS、公開ビュー、service role の置き場所）

| ロール | 使う場所 | 権限 |
| --- | --- | --- |
| service role | GitHub Actions のバッチだけ。Secrets `SUPABASE_SERVICE_ROLE_KEY` | すべての内部表への読み書き（RLS を通過） |
| anon | Vercel のビルド（サーバー側）。環境変数 `SUPABASE_ANON_KEY`（`NEXT_PUBLIC_` を付けない） | `pub_*` ビューの select のみ |
| authenticated | 使わない | grant なし |
| 運用担当（人） | Supabase ダッシュボード / CLI | スキーマはマイグレーションだけで変える。`excluded_author` への行の追加・削除はローカルの運用スクリプトで行う（ADR 0005） |

- 全表で RLS 有効、ポリシーなし、anon / authenticated への grant なし。既定権限も取り消す（02 §6）。
- 公開ビューは所有者（postgres）の権限で内部表を読む（既定のビュー。`security_invoker` を付けない）。anon は内部表に触れず、ビューの投影だけを読む。各ビューの列は 02 §4・§5 の対応表で「公開してよい列だけ」を確認した。列を足すときは NFR-39 の手順。
- anon キーはブラウザに渡さない（NFR-42）。BI は静的サイトなので、ブラウザから Supabase に接続するコードを持たない。`NEXT_PUBLIC_SUPABASE_*` という名前の環境変数を作らない（CI で名前を検査する。07_test_plan.md、2 回目）。
- anon キーが漏れた場合の影響は「公開ビューを誰でも直接読める」で、BI に出ているものと同じ。影響が小さいからこそ Vercel には anon キーだけを置く。service role キーは Actions Secrets 以外のどこにも置かない。
- Supabase の API 設定で「公開するスキーマ」は `public` のまま（内部表は grant で守る）。`graphql_public` は使わないので無効にする。Realtime、Storage、Auth は使わない。
- 書き込み経路は Actions だけ。BI から Supabase に書く機能はない（NFR-22）。

### 2.4 Vercel

- 環境変数: `SUPABASE_URL`、`SUPABASE_ANON_KEY` の 2 つだけ。Production と Preview に同じ値（データは公開ビューだけ）。
- Git 連携: main への push で本番をビルド。fork からの PR はプレビューをビルドしない設定にする（Vercel の Git 設定で確認。確認できなければ Preview の環境変数を空にして、プレビューはビルドだけ通す）。
- Deploy Hook の URL は Actions Secrets `VERCEL_DEPLOY_HOOK_URL` にだけ置く。漏れた場合の影響は「第三者が再ビルドを起こせる」（Hobby のデプロイ 1 日 100 回の消費）。漏れたら Vercel 側で Hook を作り直す。
- Vercel のアカウント所有者は docs/operations/ に記録する（NFR-60）。

## 3. 秘密情報の管理

| 秘密 | 置き場所 | 置かない場所 | 漏れたときの対処 |
| --- | --- | --- | --- |
| GCP_WORKLOAD_IDENTITY_PROVIDER、GCP_SERVICE_ACCOUNT | Actions Secrets | YAML、文書 | 秘密ではないが公開 YAML に埋め込まない。属性条件があるので単体では使えない |
| GA4_PROPERTY_ID | Actions Secrets | 文書、ログ | 単体では読めないが、文書に書かない（NFR-40） |
| SUPABASE_SERVICE_ROLE_KEY | Actions Secrets | Vercel、ローカル以外のどこか | Supabase で JWT シークレットをローテーション → Secrets を更新 |
| SUPABASE_ANON_KEY | Vercel 環境変数（サーバー / ビルド）、Actions には不要 | `NEXT_PUBLIC_*`、クライアントのバンドル | 影響は公開ビューの直接読み出しのみ。ローテーションは任意 |
| VERCEL_DEPLOY_HOOK_URL | Actions Secrets | ― | Hook を再作成 |
| 通知先（Q-12） | Actions Secrets | ― | 再発行 |
| 除外リスト（`excluded_author` の内容） | Supabase の内部表 | リポジトリ、ログ、通知、Issue、コミットメッセージ、文書 | 置き場所は 1 つ。漏れたら Q-30 の文面に沿って本人に説明する |
| ローカルの鍵（開発者の `.env`、`credentials/`） | `.gitignore` 済みのパス | 別の場所 | ローテーション |

- `.env.example` には名前だけを書く（03 §16 の表の名前）。
- 秘密を含みうる値はログ、エラーメッセージ、コミットメッセージ、Issue（beads を含む）、文書に書かない（NFR-44）。
- 秘密が git 履歴に入ったら、履歴を消す前に無効化と再発行をする。
- 設定ファイルで秘密を読むのは `packages/shared/src/env.ts` の 1 か所に限り、zod で必須・形式を検証する。検証に失敗したときのメッセージは変数名だけ（値を出さない）。

## 4. 公開範囲（データ）

- 公開するのは 02 §4 の `pub_*` ビューの列だけ。すべて集計値（NFR-30）。次元は NFR-31 の一覧（記事、著者の表示名、カテゴリ、タグ、日付・曜日・時間帯、デバイス、流入チャネル、参照元ドメイン、都道府県と市）に収まる。
- 取得も格納もしないもの（NFR-32）: ユーザー ID、クライアント ID、完全な参照 URL（pageReferrer、pageLocation）、サイト内検索語、フォーム送信（件数を含む）、IP、市より細かい地域、リアルタイム。GA4 への問い合わせは 03 §5.4 の 18 種に限る。
- 伏せ値（NFR-33、ADR 0003）: バッチが格納時に適用。公開ビューには伏せ済みの値だけ。二次伏せの区別を公開しない。
- 著者は表示名と著者ページ URL（slug）だけ（NFR-35）。アバターは使わない。slug は画面に文字列として出さない（リンクの href だけ）。
- 順位表・著者の数値並べ替えは作らない（NFR-36）。公開ビューに著者を並べ替えるための列（合計など）は `pub_author_period` に存在するが、これは FR-31 の本人向け表示に要るもので、BI がこれを使って著者一覧を数値で並べないことを 05_screens.md と 07_test_plan.md（2 回目）で縛る。
- 比較の相手は前期間・全体の分布・自分の過去の 3 つ（NFR-95）。公開ビューに他の著者との比較値は置かない。

## 5. 除外リストの扱い

ADR 0005 の決定を実装する。

- 置き場所: Supabase の内部表 `excluded_author(author_slug, excluded_at)`。RLS 有効、anon の grant なし、どの公開ビューにもこの表の列を出さない。NFR-40 の経路に含める。
- 効き方: 記事行・著者行を出す公開ビュー（`pub_post`、`pub_author`、`pub_article_*`、`pub_author_*`、`pub_post_category`、`pub_post_tag`）は `not exists (select 1 from excluded_author ...)` で除外する。子カテゴリとタグの合計・記事数も除外後（`pub_category_period` の子行、`pub_tag_period`）。全体と親カテゴリの合計は除外込み（FR-36、ADR 0003 判断 4）。
- 「存在しない」と同じ応答: BI は静的生成時に `pub_post` と `pub_author` にある ID / slug だけをページにする（`dynamicParams = false`）。除外著者の記事 ID や slug を URL に指定すると、Next.js の 404（存在しない記事・著者と同じページ）になる。クライアント側のフィルタや一覧も `pub_*` だけを元にするので、除外著者は現れない（FR-06、FR-23、FR-30）。
- 画面: 「非表示」の表示や列は置かない。「一部の記事は本人の希望により個別には表示していません」を全画面共通の説明文に常に入れる（NFR-99）。
- 変更の手順: 運用担当がローカルで `pnpm --filter batch run exclude-author -- --slug <slug>`（`.env` の service role キーを使う）を実行し、続けて `workflow_dispatch` の `publish_only` で再ビルドする（NFR-11）。コマンドの引数に著者名を入れない（slug のみ）。シェルの履歴に残るのが気になる場合は対話入力にする。削除（解除）も同じスクリプトの `--remove`。
- 記録: 誰を、いつ、誰の申し出で除外したかの台帳はリポジトリ外（依頼者が指定する非公開の場所。Q-30 と運用手順）。リポジトリ内の運用手順には台帳の置き場所と更新手順だけを書く（NFR-73）。Issue・コミットメッセージに著者名・slug を書かない（NFR-44）。
- 読み出し: 運用担当は Supabase ダッシュボードの Table Editor で `excluded_author` を見てよい（スキーマは変えない）。

## 6. 応答ヘッダ

Next.js の `headers()`（`next.config`）で全パスに付ける（NFR-91）。

| ヘッダ | 値 | 備考 |
| --- | --- | --- |
| Content-Security-Policy | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'` | 外部スクリプト・外部接続なし（Supabase にはブラウザから接続しない）。`style-src 'unsafe-inline'` はグラフライブラリの都合で必要なら許し、不要なら外す（2 回目で確定）。Next.js のインラインスクリプトに nonce が要る場合は実装で確認 |
| X-Content-Type-Options | `nosniff` | |
| Referrer-Policy | `strict-origin-when-cross-origin` | takatsu-connect.com への遷移で BI の URL パスを送らない |
| X-Frame-Options | `DENY` | CSP の frame-ancestors と二重 |
| X-Robots-Tag | `noindex, nofollow` | NFR-21 |
| Permissions-Policy | `camera=(), microphone=(), geolocation=()` | 使わない機能を閉じる |
| Strict-Transport-Security | Vercel が付ける既定に従う | |

## 7. 入力の検証

- 静的サイトなので、サーバーが実行時に利用者の入力を処理することはない。検証はビルド時とクライアント側で行う。
- ビルド時: `generateStaticParams` は `pub_post.post_id`（整数）と `pub_author.author_slug`（`^[a-z0-9-]+$`）だけからパスを作る。`dynamicParams = false`。
- クライアント側: URL のクエリ（期間、フィルタ、選択）は許可リストで検証する（期間は `last7` / `last28` / `last90` / `mYYYY-MM` の形、カテゴリ・タグは埋め込んだ一覧にある ID、著者は埋め込んだ一覧にある slug）。許可されない値は既定値（直近 28 日、フィルタなし）に戻し、エラーを出さない。
- 文字列を問い合わせに埋め込む箇所はない（ビルド時の Supabase 読み出しは supabase-js のパラメータ化された API を使い、フィルタ値は上記の検証済みの値だけ）。
- 外部リンクは `pub_post.post_url`、`pub_author.author_url` の値だけを使い、バッチが `https://takatsu-connect.com/` 配下であることを検証済み（03 §4）。BI 側でも描画前に同じ検証をし、違えばリンクにしない。
- エラー画面（404、500）は固定文。スタックトレース、内部 URL、SQL を出さない（Next.js の production ビルドの既定）。

## 8. ログと通知の規律

- 03 §15 のとおり。出すのは件数・所要時間・エラーの種別だけ。ロガーの関数を限定し、任意のオブジェクトを出せないようにする。
- 失敗通知（FR-74）の文面: ワークフロー名、基準日、失敗した工程、エラーの種別、Actions の run URL。API の応答・行データ・秘密を含めない。
- `batch_run` も同じ規律（02 §3.6）。`pub_batch_run` に出すのは状態と工程名と種別だけ。
- Vercel の Runtime Logs は静的サイトなのでほぼ発生しない。ビルドログにデータを出さない（ビルド時の読み出しは件数だけを `console.log` する）。

## 9. GitHub Actions の規律

NFR-45 と security.md「GitHub Actions」をワークフローの形に落とす。詳細な YAML はデプロイ工程（devops-engineer）。

- ワークフロー先頭で `permissions: contents: read`。バッチジョブに `id-token: write` を追加。heartbeat ジョブだけ `contents: write`（03 §12）。
- `pull_request_target` を使わない。PR 用の CI（lint、test）は `pull_request` で、Secrets を参照しない。
- サードパーティ Action は commit SHA 固定（`actions/checkout`、`actions/setup-node`、`pnpm/action-setup`、`google-github-actions/auth`）。コメントにバージョン。Dependabot（`github-actions` エコシステム、週 1）で更新。
- `schedule` は main のみ。`workflow_dispatch` の入力は `mode`、`from`、`to`、`base_date` に限り、文字列はバッチ側で zod で検証する。
- Secrets を `echo` しない。`::add-mask::` は使う機会がないようにする（秘密を出力しない）。
- 設定済みのリポジトリ側の制限（initial_setup.md §1）: Action は SHA 固定必須、許可は GitHub 製 + verified creators + google-github-actions/*、fork PR のワークフローは承認制、main の force push と削除を禁止。

## 10. 依存の管理

- pnpm のロックファイルをコミットする。Dependabot を `npm`（ルート）と `github-actions` で有効にする。
- CI で `pnpm audit --audit-level=high` を実行し、致命的・高が残った状態でデプロイしない（Vercel のビルドは CI とは別なので、main への merge 前の CI で止める）。
- 依存を足すときは必要性と保守状況を確かめ、コミットメッセージに理由を書く。初回の依存一覧は 01_tech_stack.md。

## 11. 対象サイトへの配慮

- WP REST API は日次バッチだけ、1 秒以上の間隔、差分取得（03 §4）。`User-Agent` に連絡先（リポジトリ URL）を入れる。
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
| NFR-43 RLS、anon は公開ビューの select のみ、除外の実装 | §2.3、§5、02 §6 |
| NFR-44 ログ・通知の規律 | §8、03 §15 |
| NFR-45 Actions の規律 | §9 |
| NFR-91 入力検証、エラー応答、ヘッダ、リンク先 | §6、§7 |
| FR-36 除外 | §5、ADR 0005 |

## 13. 未確定

- Supabase のアドバイザが出す「security definer view」（`pub_*` が所有者権限で base 表を読む）の警告を意図したものとして受け入れることを、security-auditor の設計レビューで確認する。代替（`security_invoker = true` + 内部表に anon の select を許すポリシー）は内部表の列が直接読めるようになるので採らない（ADR 0007）。
- CSP の `style-src 'unsafe-inline'` と Next.js のインラインスクリプトの扱いは、グラフライブラリの選定（2 回目）後に確定する。
- Vercel の Git 連携で fork からの PR のプレビューを止める設定の有無（devops-engineer が確認）。
- Q-12（通知先）、Q-30（除外の窓口・文面と台帳の置き場所）。
- D-16（0 の伏せ扱い。02 §9）、Q-33（二次伏せの表示文言）。
