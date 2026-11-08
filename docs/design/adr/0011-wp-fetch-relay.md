# ADR 0011: WP REST API の取得を日本の IP の中継経由にする

- 状態: レビュー中
- 更新日: 2026-11-09
- 関係: 00_architecture.md §2〜§6、03_data_pipeline.md §4・§14〜§16、06_security.md §2.4・§3・§7〜§9・§11、07_test_plan.md、ADR 0004、ADR 0009、FR-30、NFR-35、NFR-44、NFR-45、NFR-72、.claude/rules/security.md、docs/security/audits/2026-11-09-wp-relay-adr-review.md
- 変更履歴:
  - 2026-11-09: 新規（草案）
  - 2026-11-09: 監査（docs/security/audits/2026-11-09-wp-relay-adr-review.md）の M-1〜M-4 と、L-1〜L-5、L-7 を反映。L-6 は応答ヘッダを足さず、§8 に前提を書いた

## 文脈

- 対象サイトは XServer で、依頼者の設定により国外からの API アクセスを禁止している。ログインへのブルートフォース対策なので、この制限は緩めない（依頼者の決定）。
- GitHub Actions（海外 IP）の日次バッチは、backfill の wp_fetch の最初の `GET /posts` で約 1 秒で失敗した（kind=network。再試行対象外の 4xx か 3xx。状態コードはログに出さない設計なので値は未確認）。preflight は通過しており、DB への経路に問題はない。
- 2026-11-09 の試験: Vercel の関数（regions: hnd1）から `/wp-json/wp/v2/posts` への GET が 200 で、`X-WP-Total` があった。User-Agent はバッチと同じ。手元の日本の IP からは `/posts`、`/categories`、`/tags`、`/users/<id>` がすべて 200。
- Vercel プロジェクト `takatsu-connect-wp-relay`（Small Piece チーム、Pro）は作成済みで空。BI 本体とは別プロジェクトにする（BI はデータが空の間ビルドが失敗してデプロイできない。環境変数も分離できる）。
- 依頼者の決定は「国外制限を保ち、WP の取得だけ日本の IP を経由する」。

事実票（確認日 2026-11-09、出典 Vercel Docs。依頼者が確認）:

- Functions の request / response の本文の上限は 4.5 MB。超えると 413 `FUNCTION_PAYLOAD_TOO_LARGE`。streaming の応答には response の上限は適用されない（docs/functions/limitations）。
- 上限時間は `maxDuration` で設定する。超えると 504 `FUNCTION_INVOCATION_TIMEOUT`（同上）。Pro の標準の最大は 800 秒（docs/networking/bring-your-own-cloud の記述）。
- リージョンは `vercel.json` の `regions` か、`functions` の項目ごとの `regions` で指定する（docs/project-configuration/vercel-json）。
- Standard Protection は production ドメイン以外を保護する。production ドメインは保護されない。production も保護する All Deployments という範囲がある（docs/deployment-protection）。プラン条件は未確認。
- Vercel の Fixed IP や hnd1 の出口 IP が固定かは未確認（試験では 1 回通っただけ）。

## 選択肢

| 案 | 内容 | 評価 |
| --- | --- | --- |
| A（採用） | Vercel の関数（hnd1）に、許可リスト方式の読み取り専用の中継を置く | 国外制限を保てる。プロジェクトは作成済みで、試験で 200 を確認済み。常駐するサーバーがない。公開の入口が 1 つ増えるので、認証と許可リストで絞る。出口 IP が日本であることの保証は未確認（§8） |
| B | XServer の国外制限を解除する、または API だけ除外する | 依頼者の決定に反する。ブルートフォース対策を弱める。不採用 |
| C | WP REST API を使わず、公開ページの HTML を取得して解析する | 海外 IP からは同じ制限に当たる可能性があり（HTML への制限の有無は未確認）、仮に届いても著者・カテゴリ・`content.protected` の取得が HTML の構造に依存する。ページの取得は対象サイトの負荷も増やす。security.md の「WP REST API が公開している範囲が BI の範囲」とも合わせにくい。不採用 |
| D | 日本に置いたセルフホストランナーで Actions を動かす | public リポジトリでは、fork の PR などから持ち込まれたコードがランナーの上で動く経路を作りやすく、依頼者の環境が危険にさらされる。常時稼働の機材と更新の運用も増える。不採用 |

## 決定

案 A を採用する。

### 1. 中継の置き場

- `apps/wp-relay/` に置く。言語は BI と同じ TypeScript（バッチは Python、BI は TypeScript という既存の決定に沿い、Vercel で動かすものは TypeScript にそろえる）。
- 構成: `apps/wp-relay/api/relay.ts`（関数は 1 つ）、`vercel.json`、`tests/`、`package.json`、ロックファイル。
- 実行時の依存はゼロにする（標準の `fetch`、`crypto`、`URL` だけ）。開発時の依存は型検査とテストに要るものに限る。
- `vercel.json` の `regions` を `["hnd1"]` に固定する。`maxDuration` は 25 秒（§4）。
- Vercel のプロジェクトは `takatsu-connect-wp-relay`。BI とは環境変数を共有しない。Supabase の接続情報も GA4 の認証も持たせない。
- `apps/wp-relay/api/` には `relay.ts` 以外のファイルを置かない（別の関数として公開されないようにする。Vercel の動作は未確認なので、デプロイ後に関数が 1 つであることを確かめる）。

**デプロイ（M-2）**: Vercel プロジェクトに Git 連携を付けない。main のチェックアウトから CLI で production だけをデプロイし、プレビューを作らない。fork や未 merge のブランチのコードが Vercel の上で動く経路をなくすため。Ignored Build Step は設定の誤りで経路が開くので採らない。Standard Protection はその次の層として有効にする。

手順（本番を変える操作なので、実行は依頼者の確認のあと。本文は docs/operations/）:

1. プロジェクトの Git 連携がないことを確かめる。付いていれば外す（現状の有無は未確認）。
2. `main` に切り替えて最新にし、`git status` で未コミットの変更がないことを確かめる。
3. `apps/wp-relay` で、対象プロジェクトに `vercel link` する。作られる `.vercel/` がリポジトリに入らないことを確かめる。
4. `apps/wp-relay` で `vercel deploy --prod` を実行する。`--prod` なしの `vercel` や `vercel deploy` は使わない（プレビューができる）。
5. デプロイの一覧で、production のデプロイだけがあり、プレビューがないことを確かめる。

CLI の引数と `vercel link` の挙動は事実票になく未確認。実行の前に確かめる。Actions からはデプロイしない（Vercel のデプロイ用の秘密を GitHub に増やさない）。

### 2. 受け付けるもの

入口は `GET /api/relay` の 1 つ。転送先の WP のパスはヘッダ `X-WP-Path` で渡す。クエリには WP に渡すパラメータだけを置く。ルーティングの機能に依存せず、1 つの関数で検証を完結させるため。

**メソッド**: GET だけ。ほかは 405。

**パス**（`X-WP-Path` の完全一致。`/posts` のあとの `/` や `..`、エンコードされた文字は許さない）とクエリのキー（表にないキーは 400。同じキーの重複も 400。**必須のキーが欠けても 400**。`_fields` なしだと WP が全項目を返しうるため。M-1）:

| パス | 必須のキー | 任意のキー |
| --- | --- | --- |
| `/posts` | `status`、`_fields`、`per_page`、`page` | `modified_after`、`include` |
| `/categories` | `_fields`、`per_page`、`page` | なし |
| `/tags` | `_fields`、`per_page`、`page` | なし |
| `/users/<id>`（`<id>` は `^[1-9][0-9]{0,9}$`） | `_fields` | なし |

`per_page` と `page` は、一覧の取得がすべて `get_pages` を通り、常に送られるので必須にした。

**値の検証**（wp_fetch.py の実際の呼び出しに合わせる）:

| キー | 許可する値 |
| --- | --- |
| `status` | `publish` のみ |
| `_fields` | パスごとに完全一致。`/posts`: `id,date_gmt,modified_gmt,link,title.rendered,author,categories,tags,content.protected`、`id`、`id,author`。`/categories`: `id,name,parent`。`/tags`: `id,name`。`/users/<id>`: `name,slug,link`（§9） |
| `per_page` | `^[0-9]{1,3}$` で 1〜100 |
| `page` | `^[0-9]{1,2}$` で 1〜50（`_MAX_PAGES`） |
| `modified_after` | `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`（`tz.format_utc` の出力） |
| `include` | `^[1-9][0-9]{0,9}(,[1-9][0-9]{0,9}){0,99}$`（1〜100 個の ID） |

`_fields` を完全一致にするので、バッチの `_*_FIELDS` を変えるときは中継も同時に変える。突き合わせは `contracts/constants.json` に定数を置き、07 S-16 と同じ形で両方のテストから検査する。

**バッチの正規のリクエストとの突き合わせ**（wp_fetch.py の呼び出しの読み取り。実機では未実行）。`per_page`（`WP_PER_PAGE` = 100）と `page`（1〜`_MAX_PAGES`）は `get_pages` が足す。

| 呼び出し | パス | 送るキー | `_fields` の値 | 許可リスト |
| --- | --- | --- | --- | --- |
| `_fetch_posts`（差分あり） | `/posts` | `status`、`_fields`、`modified_after`、`per_page`、`page` | `_POST_FIELDS` | 通る |
| `_fetch_posts`（全件） | `/posts` | `status`、`_fields`、`per_page`、`page` | `_POST_FIELDS` | 通る |
| `_fetch_posts_by_id` | `/posts` | `status`、`_fields`、`include`（100 個まで）、`per_page`、`page` | `_POST_FIELDS` | 通る |
| `_fetch_id_list`（`with_author=False`） | `/posts` | `status`、`_fields`、`per_page`、`page` | `_ID_FIELDS`（`id`） | 通る |
| `_fetch_id_list`（`with_author=True`） | `/posts` | `status`、`_fields`、`per_page`、`page` | `_ID_AUTHOR_FIELDS`（`id,author`） | 通る |
| カテゴリの取得 | `/categories` | `_fields`、`per_page`、`page` | `_CATEGORY_FIELDS` | 通る |
| タグの取得 | `/tags` | `_fields`、`per_page`、`page` | `_TAG_FIELDS` | 通る |
| `_fetch_author` | `/users/<id>` | `_fields` のみ（`client.get` で直接呼ぶので `per_page` と `page` はない） | `_USER_FIELDS` | 通る |

03 §4 に代替として書かれた `orderby` と `order` は、wp_fetch.py の呼び出しに現れないので許可しない。

**転送**:

- 転送先は定数 `https://takatsu-connect.com/wp-json/wp/v2` に検証済みのパスを連結したものだけ。ホストとスキームを環境変数や入力から作らない（SSRF 防止）。
- クエリは受信した文字列を流用せず、検証済みの組から組み立て直す。
- `fetch` は `redirect: "manual"` で、リダイレクトを追わない。3xx はそのままの状態コードで返す（§4）。バッチも `follow_redirects=False` で、3xx は失敗になる。
- 受信したヘッダは WP に転送しない。`Authorization`、Cookie、`X-Forwarded-For` を WP に渡さない。`User-Agent` は中継の定数で、バッチの `WP_USER_AGENT` と同じ値（`contracts/constants.json` で突き合わせる）。
- 中継の中で再試行しない。再試行はバッチだけが行う（§7）。

### 3. 認証

- production ドメインは Standard Protection で保護されない。All Deployments はプラン条件が未確認で、バッチから通すには別の仕組みも要る。よって Deployment Protection を認証の手段にせず、**中継の中で共有トークンを必ず検査する**。プレビューの URL を閉じるために、Standard Protection は有効にする。
- 形式: `Authorization: Bearer <token>`。クエリには置かない。トークンは 32 バイト以上の暗号学的乱数（例: 16 進 64 文字）。
- 比較: 受信した値と期待値をそれぞれ SHA-256 にしてから `crypto.timingSafeEqual` で比べる（長さの違いで分岐しないため）。
- 検査の順序: (1) トークン、(2) メソッド、(3) パスとクエリ。(1) に失敗すれば 401 で本文は空にし、メソッドや値の検証結果、設定の状態を未認証の相手に返さない。
- 環境変数が未設定または空なら、(1) の失敗として 401 で全拒否する（fail closed。L-3）。ログの `outcome` だけを `misconfigured` にする。バッチは 401 で再試行せずに止まる。設定の誤りは待っても直らないので、それでよい。
- トークンは Production の環境だけに設定する。プレビューは作らない（§1）。
- トークンの置き場: GitHub の Environment `production` の Secret `WP_RELAY_TOKEN` と、Vercel の `takatsu-connect-wp-relay` の環境変数 `WP_RELAY_TOKEN`（Production）だけ。文書、ログ、`.env.example` の値、YAML に書かない。`.env.example` には項目名だけを書く。
- ローテーションの要点（年 1 回、運用担当の退任時、漏えいの疑いがあるとき。手順の本文は docs/operations/）:
  1. 新しいトークンを生成する。バッチの実行時刻（JST 17:00 ごろ）を避ける。
  2. Vercel の環境変数を更新し、§1 の手順で再デプロイする。
  3. **旧トークンを持つ過去のデプロイを削除する（M-3）。** 環境変数を変えたときに過去のデプロイの値がどうなるかは未確認なので、削除で確実にする。残っているのが新しいデプロイだけであることを、デプロイの一覧で確かめる。
  4. GitHub の Environment の Secret を更新する。
  5. `workflow_dispatch` のバッチの成功で確かめる。旧トークンの検証のために WP へ問い合わせない（まだ有効なら要求が WP に届くため。確認は Vercel の設定とデプロイの一覧で行う）。
  - 漏えいのときは 2 と 3 を先に行い、失敗するバッチが出ても無効化を優先する。
  - ロールバックで過去のデプロイへ戻さない。戻す必要があれば、main の修正を §1 の手順で新しくデプロイする。
- 漏えい時の影響: 公開済みの記事メタデータを許可リストの範囲で読める。ログインなどの許可リスト外のパスには届かないので、国外制限の目的（ブルートフォース対策）は崩れない。
- **M-4 の受け入れ**: 中継に状態もレート制限も持たせず、悪用の検知の仕組みも足さない。漏れても得られるのは公開済みの情報の読み取りだけで、許可リストの外には届かないため。残る影響は次の 2 つで、これを受け入れる。
  - WP への負荷: トークンを持つ相手は 1 秒の間隔を守らず、並列に WP を読める。
  - Vercel の費用: 実行回数と実行時間を消費される。未認証の大量要求も、WP には届かないが関数の実行回数を増やす。
- 中継の停止手順:
  - **中継を止める**: Vercel の環境変数 `WP_RELAY_TOKEN` を消して再デプロイする。fail closed で全拒否になる（401）。漏えいのときは、過去のデプロイも削除する（環境変数との関係が未確認のため）。
  - **バッチの呼び出しだけを止める**: GitHub の Secret `WP_RELAY_TOKEN` を消す。`WP_RELAY_URL` だけが残るのでバッチは起動時の検証で失敗し、中継を呼ばない。第三者が持つトークンは無効にならないので、漏えいの対処にはならない。
- Vercel Firewall のレート制限を `/api/relay` に掛けられるか、費用の上限や通知を設定できるかは未確認。デプロイ工程で確かめ、使えるなら設定する。
- 定期点検で Vercel の使用量を見る。バッチが成功している日の実行回数の目安（1 日数十回）を運用手順に書く。

### 4. 応答

上流の応答から返すのは、状態コード、本文、`X-WP-Total`、`X-WP-TotalPages` だけ。

- ほかの上流ヘッダ（`Set-Cookie`、`Server`、`Link`、`Location` など）は返さない。
- 中継が付けるのは固定の `Cache-Control: no-store`、`X-Content-Type-Options: nosniff`、`Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`、`Referrer-Policy: no-referrer` だけ（L-4）。Vercel が基盤として付けるヘッダは制御の対象外。
- `X-WP-Total` と `X-WP-TotalPages` は `^[0-9]{1,10}$` に合うときだけ返す。
- 本文を返すのは 2xx のときだけ。2xx 以外は状態コードと空の本文にする。バッチは 2xx 以外の本文を読まず（`raise_for_status`）、上流のエラーページやエラー JSON を中継の外に出す必要がないため。
- 本文の解釈はしない。JSON の検証はこれまでどおりバッチ（pydantic）が行う。
- キャッシュしない。CDN にも関数の中にも持たない。

状態コードの一覧:

| 状況 | 状態コード | バッチの動き（既存のまま） |
| --- | --- | --- |
| 上流の 2xx | そのまま | 成功 |
| 上流の 3xx、4xx | そのまま（429 を除く 4xx と 3xx は再試行しない） | 即失敗 |
| 上流の 429、500、502、503、504 | そのまま | 再試行 |
| トークンの不一致・欠落、トークンの環境変数がない | 401 | 即失敗 |
| GET 以外（トークンの検査のあと） | 405 | ― |
| パス、キー、値の検証に失敗、必須のキーの欠落 | 400 | 即失敗 |
| 本文が 4 MB を超えた | 413 | 即失敗 |
| 上流に接続できない | 502 | 再試行 |
| 上流の応答待ちが 20 秒を超えた | 504 | 再試行 |

エラーの本文は空で、スタックトレース、内部の URL を出さない。

**大きさと時間の見込み**:

- 本文は読みながら数え、4 MB を超えた時点で打ち切って 413 を返す（4.5 MB の上限より手前で、種別の分かる形で止める）。`Content-Length` は信用しない。streaming の応答は使わない。
- `per_page=100` の 1 ページが 4.5 MB を超えるのは、1 件あたり約 45 KB を超えるとき。`_fields` は本文（`content.rendered`）を含まないので、1 件は多くても数 KB 以下と見込む。**実測値はない**（未確認）。最初の実機確認で最大の応答の大きさを 1 回だけ確かめる。超えた場合は `WP_PER_PAGE` を下げれば対応できる。
- 時間は、上流の待ちを 20 秒（応答ヘッダまでではなく本文の読み終わりまで）、`maxDuration` を 25 秒とし、バッチの `timeout=30.0` より短くする。バッチが先に切れて中継の結果を受け取れない状況を避けるため。

### 5. ログ

- 1 リクエスト 1 行で `outcome`（`ok`、`upstream_status`、`unauthorized`、`invalid`、`too_large`、`upstream_unreachable`、`upstream_timeout`、`misconfigured`）、`status`、`duration_ms` だけを出す。件数はこの行の数で数える。
- トークン、クエリの値、パスの ID、上流の本文やヘッダ、受信ヘッダは出さない。
- 検証に失敗した値もログと応答に出さない。
- Vercel の基盤が残すアクセスログの項目と保持期間は未確認。URL にはクエリの値（`publish`、記事 ID、更新日時）が載りうるが、どれも公開情報か秘密を含まない値で、トークンはヘッダなので URL に載らない。
- 著者の数値 ID は、`X-WP-Path` で中継に渡り、中継から WP への URL になる（L-2）。中継のログには出さない。Vercel の基盤が外向きの fetch の URL を記録するかは未確認で、記録するなら保持期間と受け入れの理由をこの節に書く（NFR-35 との関係）。

### 6. バッチ側の変更

- 環境変数を 2 つ足す: `WP_RELAY_URL`（中継のオリジン）と `WP_RELAY_TOKEN`（`SecretStr`）。どちらも `env.py` で読み、`_present` の扱い（空文字は未設定）に合わせる。`daily` と `backfill` のステップだけに渡す。`publish_only` には渡さない。URL も公開の YAML に書かず Environment の Secret に置く。
- 検証（失敗は `BatchValidationError`、値をメッセージに入れない）:
  - 片方だけの設定は拒否する。
  - `WP_RELAY_URL` は `https`。ホスト以外（ユーザー情報、クエリ、フラグメント、パス）を持たない。例外として、ホストが `localhost` か `127.0.0.1` に完全一致するときだけ `http` を許す（結合テスト用。`localhost.example.com` は通さない）。
- 両方とも未設定のときは、今と同じく `SITE_ORIGIN` に直接接続し、`Authorization` も `X-WP-Path` も送らない。`WpClient` の変更はキーワード引数の追加（既定は `None`）にして、偽の WP を使う既存のテストは URL も呼び出し方も変えずに通るようにする。
- 中継を指定したときは、`_send_once` だけが変わる。`GET {WP_RELAY_URL}/api/relay` に、`X-WP-Path: <path>` と `Authorization: Bearer <token>` を付けて送る。`params`、`User-Agent`、`follow_redirects=False`、`timeout=30.0` は同じ。
- 再試行（`_RETRY_STATUS`、`WP_MAX_RETRIES`、指数バックオフ）、1 秒の間隔、ページング、応答の検証は変えない。
- 本番で中継の設定を忘れた場合は、直接接続になり国外制限で失敗する（現状と同じ失敗）。直接接続へ自動で切り替える動きは作らない。中継の失敗時も直接接続に戻さない。

### 7. 対象サイトへの配慮

security.md の「WP REST API への問い合わせは日次バッチだけ」との整合は、次のように取る。

- 中継は経路であり、問い合わせの主体はバッチのまま。トークンを持つのはバッチだけで、BI の画面、ブラウザ、ビルドから呼ばない。トークンが漏れた場合はこの前提が崩れる（§3 の M-4 の受け入れと停止手順）。
- 中継に cron、ヘルスチェック、事前取得、再試行を持たせない。受けた 1 リクエストが WP への最大 1 リクエストになる。
- 間隔（1 秒以上、NFR-72）と差分取得は正規のバッチの側で保たれる。バッチは直列に呼ぶ。
- 中継の自動テストは偽の上流で行い、本物の WP に接続しない。デプロイ後の確認はバッチの実行（07 A-11）で行い、確認のためだけの問い合わせを定期的に流さない。
- 許可リストにより、ログイン画面や `wp-admin`、`xmlrpc.php` など、国外制限で守っている経路には中継から届かない。

### 8. 出口 IP が海外に振られた場合

- hnd1 の出口 IP が日本であり続ける保証は未確認（試験は 1 回）。Fixed IP の可否も未確認。この ADR では固定 IP を前提にしない。
- 上流の拒否は 3xx や 4xx の状態コードのまま中継を通り、バッチは再試行せずに `wp_fetch` の失敗（kind=network）で終わる。直接接続や別経路に切り替えない。
- 取得結果はメモリにあり、書き込みは write の工程なので、wp_fetch の失敗では DB は変わらない（03 §1）。記事の差分は「前回成功の started_at − 1 日」から取るので、次に成功した実行で追いつく。BI は前回のデータのまま。
- 拒否が 200 の別の本文で返ると、一覧は `X-WP-TotalPages` がないので `BatchValidationError` で止まる。ヘッダのある空の一覧については、件数の検査と一度に消える記事の上限（03 §4）で止まる（拒否の返り方は未確認）。
- **検知は通常の失敗メール（03 §14）で足りる**とする。新しい監視は足さない。理由: 日次の処理であり、1 日の失敗は翌日に回復する。原因の切り分けは中継のログの `outcome` と `status` で行う（バッチのログは kind までで、公開リポジトリのログに状態の詳細を増やさない）。中継の 401 と上流の 401 は状態コードでは区別できないので、切り分けは `outcome` に頼る。Vercel のログの保持期間は未確認で、失敗の翌日に見て材料が残っていることが前提になる。短いと分かったら、固定の列挙値の応答ヘッダ（`X-Relay-Outcome`）を足すことを検討する（L-6）。
- 失敗が続くときの判断材料（運用手順に書く）: Vercel のログで上流の状態コードを確かめる。連続して上流の拒否になるなら、固定の日本の IP を持つ経路を別の ADR で検討する。

### 9. /users/<id> の slug

- **`_fields` から slug を外せない。** wp_fetch.py では、`_WpUser.slug` が必須項目で、`AuthorRow` のキー（`authors[user.slug]`）と `PostRow.author_slug` に使われ、書き込みの対象になる行に入る。したがって「バッチは slug を保存しない」は成り立たない。`_USER_FIELDS` は `name,slug,link` のままとし、中継の許可値もこれに合わせる。
- 中継は `/users/<id>` の本文を素通しするだけで、slug をログに出さず保存もしない。公開の REST API がもともと返す値なので、中継によって新しく開示される情報はない。
- slug の扱いは要件で判断済みで、新しい逸脱ではない（監査 L-1）。NFR-35 は「表示名と著者ページの URL（slug）」とし、「slug は WordPress では多くの場合ログイン名と同じため、著者ページへのリンク先にだけ使い、画面に文字列として出さない」としている。FR-30 も「著者 slug はサイト上で公開されており守りにならず」としている。
- 監査で確認された現状: slug は `internal.wp_author.author_slug` の主キーで、`public.pub_author` が anon に公開している。BI では文字として出さず href に使う。ページのデータと S-02e の `<option value>` にも載る。
- security.md の「表示名と著者ページの URL だけ」「ログイン名は保存もしない」には slug の断り書きがなく、slug がログイン名と同じ場合に字面では食い違う。規則に断り書きを足すかは依頼者が決める。対象サイトの slug がログイン名と同じかは依頼者に確認中（未確認の事項）。

## 結果

良い点:

- 国外制限を保ったまま、バッチが WP を読める。
- 対象サイトの変更はなく、構成の追加は関数 1 つ。常駐するサーバーがない。
- 許可リストにより、中継ができることは「バッチが今読んでいるものを読む」だけに限られる。

受け入れる点:

- インターネットに公開の入口が 1 つ増え、秘密（`WP_RELAY_TOKEN`）も 1 つ増える。ローテーションの運用が増える。
- バッチの `_fields` やパラメータを変えるときは、中継の許可リストも同時に直す。合っていなければ 400 で失敗する（安全な側に倒れる）。
- 出口 IP の国に依存する。外れた日はバッチが失敗する。
- Vercel Pro のチームのプロジェクトで動く。呼び出しは 1 日数十回の見込みだが、追加の費用が発生するかは未確認。

- トークンが漏れた場合の WP への負荷と Vercel の費用（§3 の M-4 の受け入れ）。
- 手元からの CLI のデプロイになる。main との一致は手順で守る。

security-auditor のレビューを受け（docs/security/audits/2026-11-09-wp-relay-adr-review.md。致命的・高は 0 件）、中の指摘を反映した。構築後に、実装の差分の監査を受ける（公開の入口、認証、`.github/workflows/` の変更に当たるため）。

## 影響する設計文書

この ADR では編集しない。確定のときに次を直す。

| 文書 | 節 | 直す内容 |
| --- | --- | --- |
| 00_architecture.md | §2 全体構成図 | 中継を追加。WP → Actions の矢印を中継経由に。Environment の Secrets に `WP_RELAY_URL`、`WP_RELAY_TOKEN`。Vercel のプロジェクトが 2 つになること（BI は Hobby の記述のまま、中継は Pro） |
| 00_architecture.md | §3 コンポーネントと責務 | `apps/wp-relay` の行を追加。日次バッチの持つ秘密に追加 |
| 00_architecture.md | §4 データの流れ | 手順 1 の WP の取得が中継を経由すること |
| 00_architecture.md | §5 信頼境界 | 中継の境界を新設。B1、B6 の通るものを更新 |
| 00_architecture.md | §6 リポジトリ構成 | `apps/wp-relay/` を追加 |
| 01_tech_stack.md | ホスティング、言語の節（節番号は未確認） | 中継の TypeScript と Vercel 関数を追加 |
| 03_data_pipeline.md | §1 の流れと図 | wp_fetch の入力が中継経由であること |
| 03_data_pipeline.md | §4 | 接続先の説明、許可する値との連動。未実装の `orderby` の代替（§4 冒頭）は中継の許可リストにないこと |
| 03_data_pipeline.md | §14 | 中継由来の失敗の扱いと切り分け |
| 03_data_pipeline.md | §15 | 中継のログの規律 |
| 03_data_pipeline.md | §16 | 環境変数の表に `WP_RELAY_URL`、`WP_RELAY_TOKEN`。中継の定数 |
| 06_security.md | §2（§2.4 の後に中継の認証を追加） | 共有トークン、Standard Protection の位置づけ |
| 06_security.md | §3 秘密情報の表 | `WP_RELAY_URL`、`WP_RELAY_TOKEN`、漏えい時の対処 |
| 06_security.md | §7 入力の検証 | 中継の許可リスト |
| 06_security.md | §8 ログと通知の規律 | 中継のログ |
| 06_security.md | §9 GitHub Actions の規律 | `daily.yml` のステップへの Secret の渡し方 |
| 06_security.md | §11 対象サイトへの配慮 | 中継との整合（本 ADR §7） |
| 06_security.md | §12、§13 | 要件との対応、未確定に本 ADR の未確認の事項 |
| 07_test_plan.md | 単体、結合、S-16、A-11（節番号は未確認） | 中継の許可リスト・認証・応答の絞り込みのテスト、バッチの中継あり・なし、定数の突き合わせ、実機確認の経路 |
| traceability.md | 関係する NFR の行 | 中継と ADR 0011 を追加 |
| docs/operations/ | 環境、デプロイ手順、運用手順 | 中継の CLI でのデプロイ、トークンのローテーションと過去のデプロイの削除、中継の停止手順、失敗時の切り分け、実行回数の目安と使用量の点検 |
| .github/dependabot.yml | `updates` | `/apps/wp-relay` を対象に追加（L-5。文書ではないがこの ADR に伴う変更） |
| .github/workflows/audit.yml、ci.yml | 依存の監査、lint、テスト | `apps/wp-relay` を対象に追加（L-5） |

## 未確認の事項

| 項目 | 確かめ方・時期 |
| --- | --- |
| 国外からの拒否の状態コードと本文の形 | 中継の導入後は比較の材料がないので、必要になったときに Vercel のログで確かめる |
| hnd1 の出口 IP が日本であり続けるか、固定か。Fixed IP の可否と条件 | Vercel Docs を依頼者が確認。実運用の成功の継続で観察 |
| All Deployments のプラン条件 | 依頼者が確認。本 ADR の認証はこれに依存しない |
| `/api/relay` の Web 標準ハンドラの書き方（Next.js を使わない Vercel 関数）、`redirect: "manual"` での 3xx の見え方、`api/` の他のファイルの扱い | 実装の前に Vercel Docs を確認し、事実票にする |
| 環境変数を変えたときの過去のデプロイの値、過去のデプロイの削除の方法。結果によらず §3 では削除する | Vercel Docs。デプロイ工程 |
| `takatsu-connect-wp-relay` の Git 連携の有無。`vercel link` と `vercel deploy --prod` の挙動、Standard Protection が実際に有効か | Vercel のプロジェクト設定、Docs。デプロイ工程 |
| Vercel Firewall で `/api/relay` にレート制限を掛けられるか。費用の上限や通知を設定できるか | デプロイ工程で確かめる |
| `WP_RELAY_TOKEN` を Sensitive の種類で登録できるか。チームのメンバーと権限、2 要素認証 | Vercel のチーム設定。依頼者 |
| GitHub の Environment `production` のデプロイ元が main だけか（今回は再確認していない） | GitHub の設定。依頼者 |
| `per_page=100` の応答の実サイズ | 最初の実機確認（07 A-11）で 1 回 |
| Vercel の基盤のログの項目（外向きの fetch の URL を含むか）と保持期間 | Vercel Docs を依頼者が確認 |
| 中継で Vercel Pro の追加費用が発生するか | 依頼者が確認 |
| 対象サイトの slug がログイン名と同じか（公開ビューと BI の href に出ることは監査で確認済みで、NFR-35 の範囲内。§9）。security.md に slug の断り書きを足すか | 依頼者に確認中。WordPress の管理画面で依頼者が確かめる |
