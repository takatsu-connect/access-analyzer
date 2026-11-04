# 03 データパイプライン

- 状態: レビュー中（2026-11-03）
- 更新日: 2026-11-04
- 参照: FR-70〜FR-76、NFR-01〜NFR-04、NFR-44、NFR-45、NFR-50〜NFR-52、NFR-61、NFR-70〜NFR-72、D-01〜D-03、D-05〜D-09、D-12、D-15、02_data_model.md、ADR 0001、ADR 0002、ADR 0004、ADR 0006、ADR 0007、ADR 0009
- 変更履歴:
  - 2026-11-03: 設計レビュー（audits/2026-11-03-design-review.md）の H-1・M-1〜M-8・L-1〜L-10 と Q-36 を反映
  - 2026-11-03: analytics-advisor の画面レビュー（advice/2026-11-03-screens-review.md）と security-auditor の再確認（audits/2026-11-03-design-review-recheck.md）の残りを反映（N-1: 分布 `benchmark_curve` と帯をバッチで計算せず、公開ビューが可視記事から計算する。§1、§6.2、§7）
  - 2026-11-03: バッチを Python に変更（ADR 0004）。書き込みを psycopg と専用ロール `batch_writer` に変更（ADR 0009）。例外とログの規律を Python と psycopg に合わせて作り直し（§14、§15）。`packages/shared` のパスを `apps/batch` と `apps/web` に変更
  - 2026-11-03: 書き込み経路の監査（以下「経路監査」。docs/security/audits/2026-11-03-write-path-review.md）の W-1〜W-3、W-7、L-5〜L-7 を反映（§14 の起動時の処理と分類の規則、§10 の作り直し、§16 の接続文字列の形式と置き場所）
  - 2026-11-04: 著者の除外（FR-36）を初回対象外に（依頼者の決定、ADR 0005 保留）。`publish_only` は設定変更後の再ビルドとビルド失敗後の再試行のために残し、理由を直した（§2、§8）。§6 の除外の記述を外した

## 1. 全体の流れ

日次バッチ（GitHub Actions、`apps/batch`、Python）は 1 回の実行で次の工程を順に行う。工程名は `batch_run.failed_step` の値と同じ。

| # | 工程 | 入力 | 出力 | 失敗時 |
| --- | --- | --- | --- | --- |
| 0 | preflight | 環境変数、設定値 | `batch_run` に `running` の行。同じ基準日の `success` が既にあれば何もせず終了（二重実行の防止） | validation |
| 1 | wp_fetch | WP REST API（wp/v2） | `wp_author`、`wp_post`、`wp_category`、`wp_tag`、`wp_post_category`、`wp_post_tag` の upsert と削除 | network / validation |
| 2 | period | 基準日 | `period` の移動窓 6 行の日付更新、月行の追加、`is_confirmed` の更新。今回取り直す期間の集合（§3） | ― |
| 3 | ga4_daily | GA4 Data API | `site_daily`、`site_daily_channel`、`site_daily_device`、`article_daily`（直近 7 日ぶん、またはバックフィル範囲） | quota / auth / network |
| 4 | ga4_period | GA4 Data API | 取り直す期間の `site_period`、`site_period_breakdown`、`site_period_heatmap`、`article_period`（landing_sessions、scroll_count、engagement_seconds）、`article_period_breakdown`。確定した月の `site_month_referrer`、`site_month_city`。30 日が経過した記事の `article_referrer_30d` | 同上 |
| 5 | derive | 内部表（メモリ上の生値を含む） | `article_period.pageviews`、`author_period_breakdown`、`article_summary`（帯の列を除く）、`article_milestone`、`author_summary`（帯の列を除く）、`sns_source_unmapped`。分布 `benchmark_curve` と帯はバッチで計算せず、公開ビューが公開記事から計算する（02 §4.1、N-1） | validation |
| 6 | write | 上記 | Supabase への upsert（psycopg、1,000 行単位、全体で 1 トランザクション）。移動窓の古い行の削除 | db |
| 7 | publish | ― | Vercel の Deploy Hook を呼び、BI を再ビルドする（ADR 0006）。`batch_run` を `success` に更新 | network |

工程 1〜5 はメモリ上で完結させ、工程 6 でまとめて 1 トランザクションで書く（§7）。書き込み途中で失敗すればロールバックされ、前回の成功時の状態が残る。公開（工程 7）は書き込みが成功したときだけ行うので、BI に半端なデータが載らない。工程 0 の `batch_run` の `running` と、失敗・成功の記録は、工程 6 とは別の短いトランザクションで書く。

```mermaid
flowchart LR
  WP[WP REST API<br/>wp/v2] -->|差分取得| B
  GA[GA4 Data API<br/>runReport] -->|日別 + 期間別| B
  subgraph B[GitHub Actions 日次バッチ]
    direction TB
    P0[preflight] --> P1[wp_fetch] --> P2[period] --> P3[ga4_daily] --> P4[ga4_period] --> P5[derive<br/>正規化・伏せ値・二次伏せ・分布] --> P6[write] --> P7[publish]
  end
  P6 -->|psycopg, batch_writer| SB[(Supabase<br/>内部表)]
  P7 -->|Deploy Hook| V[Vercel ビルド]
  SB -->|anon: pub_* のみ| V
```

## 2. 実行時刻とトリガー

- `schedule`: `cron: '0 8 * * *'`（UTC 08:00 = JST 17:00、FR-70 の仮置き。Q-13 で T を確定したら合わせる）。GA4 の日次データが揃う JST 15:30 より後、NFR-02 の T = 18:00（仮）より前。
- GitHub の cron は遅延・欠落することがあるため、`cron: '0 9 * * *'`（JST 18:00）にも登録し、preflight で「同じ基準日の success があれば終了」とする。2 回目は保険であり、通常は 1 回目で終わる。
- `workflow_dispatch`: 手動の再実行（FR-70）。入力は `mode`（`daily` / `backfill` / `publish_only`）、`from`、`to`（バックフィル時）。`publish_only` は工程 7（Deploy Hook の呼び出し）だけを行い、設定値や辞書（`ui-text.ts`）の変更後の再ビルド、ビルド失敗後の再試行に使う。データを更新しないので `batch_run` に行を書かない（`pub_meta` の最終更新を変えない。設計レビュー L-7）。
- 定期実行は main ブランチのワークフローだけが動く（NFR-45 (4)。schedule は既定ブランチでしか動かないが、ジョブ側でも `if: github.ref == 'refs/heads/main'` を付ける）。
- 所要時間の見込み: 通常 2〜4 分（GA4 約 30 リクエスト、WP 約 7 リクエスト、書き込み数万行）。`timeout-minutes: 30`。

## 3. 基準日と期間の決め方

- 基準日 = 実行時刻を Asia/Tokyo に変換した日付の前日（NFR-02）。環境変数 `BASE_DATE` で上書きできる（再実行・試験用）。
- 移動窓: `last7` = [基準日 − 6, 基準日]、`prev7` = [基準日 − 13, 基準日 − 7]。28、90 も同様。
- 月: 2025-10 から基準日の属する月まで。基準日の属する月の `end_date` は基準日。
- 今回「取り直す期間」= 移動窓 6 つ + 基準日の属する月 + 前月（`is_confirmed` がまだ false のとき。月末 + 7 日 ≤ 基準日 で true になり、その実行で最後に取り直して以後は触らない）。それ以前の月は変えない。
- 確定した月の参照元ドメイン・市別（§4.1 行 5）は、その月が `is_confirmed` になった実行で 1 回だけ取得する。行がない確定月があれば（失敗で飛んだ場合）同じ実行で補う。
- 公開後 30 日時点（§4.1 行 10）: `published_on + 29`（30 日目）+ 7 日 ≤ 基準日 かつ `article_summary.referrer_30d_computed_on` が null の記事を対象にする。

## 4. WP REST API からの取得（差分取得、D-03）

事実（親が確認）: `modified` / `modified_gmt` がある、`per_page` 上限 100、`X-WP-Total` / `X-WP-TotalPages` で総数とページ数、`_fields` でネストしたフィールドを指定できる。WP 5.7 以降の `modified_after` パラメータが使えるかは最初の実装で 1 回確認し、使えなければ `orderby=modified&order=desc` で `modified_gmt` が前回実行時刻より新しいものを読み切る。

| 順 | リクエスト | 目的 | 回数 / 日 |
| --- | --- | --- | --- |
| 1 | `GET /wp-json/wp/v2/categories?per_page=100&_fields=id,name,parent` | カテゴリ（二階層、同名の子を `path` で区別） | 1（100 を超えればページング） |
| 2 | `GET /wp-json/wp/v2/tags?per_page=100&_fields=id,name` | タグ | 1〜2 |
| 3 | `GET /wp-json/wp/v2/posts?status=publish&per_page=100&modified_after=<前回成功の started_at − 1 日>&_fields=id,date_gmt,modified_gmt,link,title.rendered,author,categories,tags,content.protected` | 追加・更新された記事 | 1（通常 0〜5 件） |
| 4 | `GET /wp-json/wp/v2/posts?status=publish&per_page=100&_fields=id&page=1..N` | 公開記事の ID 一覧（削除・非公開化の検出） | 3（225 本） |
| 5 | `GET /wp-json/wp/v2/users/<id>?_fields=name,slug,link` | 3 で現れた、まだ slug に解決していない author ID | 0〜数回 |
| 6 | 週 1 回（日曜）: `posts?_fields=id,author` 3 回 + 全著者の `users/<id>` | 表示名・URL の変更を反映 | 週 24 回 |

- 間隔: リクエスト間に 1 秒以上空ける（NFR-72）。`User-Agent` に BI の名前とリポジトリ URL を入れる。失敗は 3 回まで指数バックオフで再試行し、それでも失敗したら `wp_fetch` で失敗にする。
- 処理: `content.protected = true` の記事は取り込まない。既に `wp_post` にあって、今回 (a) ID 一覧にない、または (b) `content.protected = true` になった記事は `wp_post` から削除する（cascade で記事に関する行がすべて消える。FR-72、NFR-34、NFR-52）。
- 著者: `author`（数値 ID）は `users/<id>` で slug・表示名・URL に解決してから捨てる。ID → slug の対応はメモリにだけ持ち、Supabase には置かない（NFR-35）。
- 検証: `link` と著者 `link` が `https://takatsu-connect.com/` で始まることを確認する（FR-04、NFR-91）。違えば validation で失敗にする。
- 初回（バックフィル）は 3 の `modified_after` を付けずに全件を取る（3 回）。
- 固定ページ（`/wp-json/wp/v2/pages`）は Q-17 が未確定のため取得しない。「記事以外」にまとまる。

## 5. GA4 Data API からの取得

- クライアント: `google-analytics-data`（`google.analytics.data_v1beta`）の `BetaAnalyticsDataClient`。認証は google-github-actions/auth が書く資格情報ファイル（`GOOGLE_APPLICATION_CREDENTIALS`）を Application Default Credentials として拾う（ADR 0002）。プロパティは `properties/${GA4_PROPERTY_ID}`。
- `runReport`（Python の `run_report`）の規則: `dateRanges` は 1 リクエストに最大 4 つ入れられるので、取り直す期間を 4 つずつまとめる。`limit` は既定 10,000 行、最大 250,000 行（2026-11-03 に公式リファレンスで確認）。行数が 10,000 を超えうる問い合わせ（pagePath × 日）は `limit = 100000` を指定し、`rowCount` が上回れば `offset` でページングする。`returnPropertyQuota: true` を常に付け、`propertyQuota.tokensPerDay.remaining` と `tokensPerHour.remaining`、`tokensPerProjectPerHour.remaining` を `batch_run.counts` に件数として記録する。
- 同時実行はしない（逐次。同時リクエストの割当 10 を使わない）。リクエスト間に 200 ms 空ける。429 / `RESOURCE_EXHAUSTED` は 60 秒待って 1 回だけ再試行し、だめなら `quota` で失敗にする。
- 取得する次元・指標は 03_data_sources.md §2.4 の範囲に限る。`pageReferrer`、`pageLocation`、`pageTitle`、ユーザー系、検索語、`customEvent:*`（D-15 の結論により page_type も）は使わない。

### 5.1 pagePath の正規化（D-05）と page_type（D-15）

規則（`apps/batch/src/takatsu_batch/page_path.py`、単体テスト付き）:

1. 小文字化し、前後の空白を除く。
2. クエリ文字列とフラグメントは pagePath には含まれない（GA4 の仕様。`pagePathPlusQueryString` は使わない）。含まれていれば `?` 以降を捨てる。
3. 末尾にスラッシュがなければ付ける。連続するスラッシュは 1 つにする。
4. `^/(\d+)/$` に一致すれば記事 ID。`wp_post` にある ID なら「記事」、なければ「削除済み・未知の記事」（記事単位では格納しない。02_metrics.md §3）。
5. 一致しなければ「記事以外」（トップ `/`、`/category/...`、`/tag/...`、`/author/...`、固定ページ、検索結果、404）。記事単位では格納しない。全体の値は全体の問い合わせ（pagePath なし）から取るので、分類はここでは不要。
6. `/<数字>/<何か>/`（ページ分割 `/4812/2/`、`/4812/amp/`、`/4812/feed/` など）は「記事以外」とする。該当する pagePath が実測で現れるかは未確定（D-05 の残り。親が GA4 で確認し、現れるなら規則 4 を `^/(\d+)/(?:\d+/)?$` に広げるかを決める）。

`/?p=<ID>` 形式は pagePath では `/` になり区別できないが、WordPress は `?p=` をパーマリンクに 301 で転送し GA4 は転送後の URL を記録するため、無視できると見る。

D-15（カスタム次元 `page_type`）: 使わない。理由は (1) 判定は規則 4 で足り、`customEvent:page_type` を次元に足すと行が分割されて pagePath 問い合わせのトークンが増える、(2) 03_data_sources.md §2.4 の取得する次元を増やす必要がある、(3) `page_type = post` でも pagePath が記事 ID でない行（転送前の URL など）の扱いを別に決めることになる。規則 4 を正とする。実装の検証は、バッチに診断の問い合わせを入れずに行う: 初回バックフィルの後、運用担当が GA4 の UI（探索レポート）で「page_type = post の表示回数の合計」を 1 回確認し、`site_daily` から `article_daily` の合計を引いた「記事以外」の値と比べる。差が 1% を超えたら Issue にする（件数だけを書く）。バッチのコードは `customEvent:*` を一切使わない（設計レビュー L-2。§5 本文と 06 §4 の「使わない」と矛盾しないようにした）。

### 5.2 SNS 参照元の正規化（D-02）

規則（`apps/batch/src/takatsu_batch/sns_source.py`、単体テスト付き）。`sessionSource` を小文字化し、次の順で判定する。

| 区分 | 完全一致 | 後方一致（`.` を含むドメインの末尾） |
| --- | --- | --- |
| instagram | `l.instagram.com`、`instagram.com`、`ig`、`instagram` | `.instagram.com` |
| facebook | `facebook.com`、`lm.facebook.com`、`l.facebook.com`、`m.facebook.com`、`facebook`、`fb` | `.facebook.com` |
| x | `t.co`、`twitter.com`、`x.com`、`twitter` | `.twitter.com`、`.x.com` |
| line | `line.me`、`lin.ee`、`line`、`timeline.line.me` | `.line.me` |
| other | 上のいずれにも当たらないもの（`threads`、`threads.net` を含む） | ― |

- LINE の値は 2026-11-03 の実測に現れないが、現れたときに拾えるよう規則に入れる。注記（M-11「LINE は実際より少なく見えることがあります」）は維持する。
- 対応づけられなかった Organic Social の参照元は `sns_source_unmapped` に upsert する（ドメイン名を Actions のログには出さない。NFR-44）。運用担当が月 1 回この表を見て、必要なら規則に追加し、コミットで記録する（規則は公開してよい設定。NFR-22 (1)）。
- 流入チャネル（M-10）の正規化: `Organic Search` → `search`、`Organic Social` → `social`、`Direct` → `direct`、`Referral` → `referral`、それ以外（AI Assistant、Email、Organic Video、Unassigned、Paid 系、Cross-network、Display、Affiliates、Audio、SMS、Mobile Push Notifications）→ `other`。「その他」に含めた区分の一覧は画面の注記に出す（05_screens.md、2 回目）。

### 5.3 ユーザー数の期間取得（D-06）

- `activeUsers` は期間単位でだけ取る（日別の合計はしない）。取り直す期間（最大 8 つ）を 4 つずつ `dateRanges` にまとめ、次元なしで `activeUsers` と `userEngagementDuration` を同時に取る（1 期間集合あたり 2 リクエスト）。
- `newVsReturning × activeUsers` も同じまとめ方で 2 リクエスト。`new` / `returning` 以外（空、`(not set)`）は `unknown` に入れる。
- 日別のユーザー数は取得も格納もしない（確定、2026-11-03、Q-35 の (b)）。FR-11 の日別推移で切り替えられるのは読まれた回数と訪問回数の 2 つだけで、読んだ人の数は KPI カード（FR-10）の期間値にだけ出す。05 §4.1 の表は変えない。
- 月ごとの値は `period` の月行ごとに持つので、FR-01 の月別と前年同月も同じ表から引ける。

### 5.4 問い合わせの一覧

「期間集合」= 取り直す期間（通常 8 つ、4 つずつ 2 リクエスト）。「直近 7 日」= `dateRanges: [{startDate: 基準日 − 6, endDate: 基準日}]`。日次の回数は通常日。

| # | 次元 | 指標 | フィルタ | 期間 | 格納先 | 回数 / 日 |
| --- | --- | --- | --- | --- | --- | --- |
| G1 | date | screenPageViews、sessions | ― | 直近 7 日 | site_daily | 1 |
| G2 | date、sessionDefaultChannelGroup | sessions | ― | 直近 7 日 | site_daily_channel | 1 |
| G3 | date、deviceCategory | screenPageViews、sessions | ― | 直近 7 日 | site_daily_device | 1 |
| G4 | date、pagePath | screenPageViews | ― | 直近 7 日 | article_daily | 1（約 2,000 行） |
| G5 | （なし） | activeUsers、userEngagementDuration | ― | 期間集合 | site_period | 2 |
| G6 | newVsReturning | activeUsers | ― | 期間集合 | site_period_breakdown(new_returning) | 2 |
| G7 | sessionSource | sessions | sessionDefaultChannelGroup = Organic Social | 期間集合 | site_period_breakdown(sns) | 2 |
| G8 | dayOfWeek、hour | screenPageViews | ― | 期間集合 | site_period_heatmap | 2 |
| G9 | country、region、city | sessions | ― | 期間集合 | site_period_breakdown(local) に 3 区分へ畳んで格納。確定月は site_month_city（上位 10、Japan、T 以上） | 2 |
| G10 | landingPage | sessions | ― | 期間集合 | article_period.landing_sessions | 2 |
| G11 | pagePath | userEngagementDuration | ― | 期間集合 | article_period.engagement_seconds | 2 |
| G12 | pagePath | eventCount | eventName = scroll | 期間集合 | article_period.scroll_count | 2 |
| G13 | landingPage、sessionDefaultChannelGroup | sessions | ― | 期間集合 | article_period_breakdown(channel)、author_period_breakdown(channel) | 2 |
| G14 | landingPage、sessionSource | sessions | sessionDefaultChannelGroup = Organic Social | 期間集合 | article_period_breakdown(sns)、author_period_breakdown(sns) | 2 |
| G15 | landingPage、deviceCategory | sessions | ― | 期間集合 | article_period_breakdown(device) | 2 |
| G16 | sessionSource | sessions | sessionDefaultChannelGroup = Referral | 確定した月 | site_month_referrer（上位 10、T 以上） | 月 1 |
| G17 | sessionSource | sessions | landingPage = `/<ID>/` かつ sessionDefaultChannelGroup = Referral | 記事の公開日〜30 日目 | article_referrer_30d（上位 3、T 以上） | 記事 1 本につき 1。1 日 0〜2 |
| G18 | （初回対象外） | ― | ― | ― | シェア数（M-41、FR-61）。問い合わせを作らない。実装するときは NFR-39 で 05 §4.1 に行を追加してから `pagePath × eventCount（eventName = AddToAnyShare）` を追加する（設計レビュー M-4） | 0 |
| G19 | sessionDefaultChannelGroup | sessions | ― | 期間集合 | site_period_breakdown(channel)（5 区分に正規化、§5.2。Q-36） | 2 |
| G20 | deviceCategory | screenPageViews、sessions | ― | 期間集合 | site_period_breakdown(device_pv、device_sessions)（Q-36） | 2 |

問い合わせは G1〜G17、G19、G20 の 19 種に限る（G18 は初回対象外）。06 §4 の「問い合わせの種類」はこの一覧を指す。

- G9 の 3 区分: `country = Japan かつ city = Kawasaki` → `kawasaki`、`country = Japan かつ city がそれ以外（(not set) 以外）` → `japan_other`、`country ≠ Japan` または `city` が `(not set)` / 空 → `unknown`（M-14 は「国内」の分母に不明を含めるため、国外も `unknown` に入れる。国外を分けて出す要件はない）。移動窓では市別の行を格納しない（取得はするが 3 区分に畳んでから捨てる）。
- G13・G14 の landingPage は記事 ID に正規化し、記事以外の landingPage は捨てる。著者別は、同じ応答から著者ごとに記事の生値を合算してから伏せる（新たな問い合わせは不要）。
- 著者別の SNS（FR-33）も G14 から。カテゴリ・タグ × 内訳軸 は格納しない（05 §4.1）。

## 6. 集計と伏せ値

### 6.1 伏せ値と二次伏せのアルゴリズム

`apps/batch/src/takatsu_batch/mask.py`（単体テスト付き。入力はバケット名と生値の配列、出力は値と `_mask`）。

1. 排他的な区分のすべてのバケットを揃える。GA4 が返さなかったバケットは 0 として格納し、伏せない（0 は個人に結び付かない。D-16 確定、設計レビュー M-1）。
2. `1 ≤ 値 < T` のセルを `threshold` で伏せる（値を null にする）。0 は伏せない。
3. 二次伏せ: 伏せたセルがちょうど 1 つのとき、伏せていないセルのうち **値が T 以上で最小のもの**（同値なら固定の区分順で先のもの）を `secondary` で伏せる。0 と T 未満のセルは候補にしない（候補に入れると、伏せた 2 セルの和 = 合計 − 表示の和 がそのまま伏せた値になり、二次伏せが無効になる。設計レビュー M-1）。該当するセルがなければ追加しない（その場合は区分の合計自体が T 未満であり、記事では合計の `landing_sessions` が伏せられ、サイト全体では現実に起きない）。伏せたセルが 0 または 2 以上のときは何もしない。
4. 曜日 × 時間帯（168 セル）も 1 つの排他的区分として手順 1〜3 を適用する（設計レビュー L-1。復元される値はサイト全体の時間帯 PV で識別性は低いが、アルゴリズムを共通にするコストは小さい）。排他的でない集計（参照元ドメインの上位 N、市別の上位 N、記事 × 期間の単独値）は手順 2 だけ。上位 N は「T 未満の行を落としてから上位 N を取る」。
5. 階層差分（著者 × 内訳軸、設計レビュー M-2）: `author_period_breakdown` の各セル（period_id、axis、bucket）について、同じ period_id・axis・bucket で、その著者の記事セル（`article_period_breakdown`、手順 1〜3 の適用後）のうち伏せたもの（`threshold` または `secondary`）がちょうど 1 本のときは、著者セルを `secondary` で伏せる（値が T 以上でも）。0 本または 2 本以上のときは手順 1〜3 の結果のまま。著者セルへの手順 3 の二次伏せは、手順 5 の後にもう一度判定する（手順 5 で伏せた結果、区分内で伏せたセルが 1 つだけになったら手順 3 を適用する）。入れ子の区分（SNS ⊂ 流入チャネル social、初めて / また来た ⊂ 読んだ人の数、地元 3 区分 ⊂ 訪問回数）は区分内の二次伏せで足りる。

適用先は 05 §4.1 のとおり。合計・累積（記事の期間合計、M-18 の累積、著者・カテゴリ（親・子）・タグ・鮮度区分の合計、公開本数、全体の読まれていた時間の合計、著者 × カテゴリ、著者 × 鮮度区分）は手順 1 の前の生値から計算する。

### 6.2 派生指標の計算

派生指標のうち累積（M-18）、判定（M-22、M-23）、自分の過去との比較の基準値（M-24）はバッチ（Python）が `article_daily` と `wp_post` から計算する。全記事の分布（M-19、M-27）と帯（band）は `internal.benchmark_curve` ビューと公開ビューが公開記事から計算し、バッチは計算しない（02 §4.1、ADR 0003 判断 4。最終確認 低-1 で文言を修正）。計算式は 02_metrics.md §4.3。

- `article_period.pageviews` = 期間内の `article_daily.pageviews` の合計。
- 累積（M-18）: 公開日を 1 日目として n = 1〜90 の累積。公開前の日に PV があっても（公開日時より前のプレビューなど）累積には含めない。公開ビュー `pub_article_cumulative` は同じ定義を SQL の窓関数で出す。
- 分布（M-19、M-27、`benchmark_curve`）: **バッチは計算しない**（2026-11-03、再確認 N-1）。`internal.benchmark_curve` ビューが公開記事（広告を除く）から計算する（02 §4.1）。定義はビューに移しても変えない: 母集団 = 直近 12 か月（基準日 − 365 日以降）に公開、広告でない、age_days ≥ n の記事。30 本未満なら全期間に広げる（`population_window = all`）。それでも 30 本未満なら n の行を作らない。分位点は `percentile_cont`（線形補間）。`scope = cat:<id>` は、子カテゴリのうち母集団が 30 本以上のものだけ。`population_size` は母集団の件数。著者の除外は初回対象外だが（2026-11-04、ADR 0005 保留）、計算の場所はビューのままにする。追加するときに母集団の条件を DB 側の 1 か所に足すだけで済み、バッチに除外リストを読ませずに済むため（経緯と代替案は ADR 0003 判断 4 追記）。`apps/batch/tests/support/reference.py` の `quantiles()` はビューの結果と突き合わせる参照実装（07 U-07、I-DB-17）。
- 帯（band）: **バッチは計算しない**。公開ビュー `pub_article_summary` が `band_7d`（`pv_7d` を曲線 (all, 7) の p25 / p75 と比べる。age_days ≥ 7 のときだけ）と `band_30d`（N = min(age_days, 30) 日目の累積を曲線 (all, N) と比べる。「◯日目」として同じ日数の帯と比べる。M-20）を、`pub_author_summary` が `band_30d`（`own_median_30d` を曲線 (all, 30) と比べる）を計算する。p75 と等しいときも p25 と等しいときも `middle`。age_days < 3、曲線の行がない、値が null のときは null。`apps/batch/tests/support/reference.py` の `band()` は参照実装（07 U-08、I-DB-17）。
- M-22: `is_recent_hot` = age_days ≥ 15 かつ 直近 7 日の PV ≥ 20 かつ 直近 7 日 PV ≥ 2 × (その前 28 日の PV ÷ 4)。`is_revival` = `is_recent_hot` かつ age_days ≥ 91。表示件数の上限（各著者 5、全体 10）は BI 側で `is_recent_hot` の記事を直近 7 日 PV の多い順に切る。
- M-23: 節目（500、1,000、5,000、10,000）を初めて超えた日 = 累積がその値以上になった最初の `day`。`is_evergreen_365` = age_days ≥ 365 かつ 直近 28 日の PV ≥ 20。
- M-24: 著者の記事のうち 直近 12 か月公開・age_days ≥ 30 の `pv_30d` の中央値。該当 5 本未満なら null。
- 削除された記事は `wp_post` から消えているので、どの計算にも入らない。

### 6.3 遅延データと伏せ値（D-08）

- 直近 7 日の日別値と、移動窓・当月・未確定の前月の期間値は毎回まるごと再計算し、同じキーに upsert する。前回の伏せ判定は参照しない（「一度伏せたら伏せ続ける」などの状態は持たない）。
- GA4 の値は遅延データで増える方向にしか変わらないため、再取得で変わる判定は「伏せ → 表示」が主で、「表示 → 伏せ」は移動窓がずれたことによる別のセルの判定である。移動窓の日次差分で日別の内訳が復元されうる点は、粗い排他的区分に限って許容した（ADR 0003 判断 3）。識別性の高い次元は確定した値だけを 1 回格納するので、再取得で変わらない。
- 遅延の最大 7 日を超えて値が変わっても、それ以前の日別値は取り直さない（FR-71 の範囲）。月は `is_confirmed` 後に触らないので、7 日以降の遅延は月の値に反映されない。これは「確定した暦月」の定義（05 §4.1）に沿う。

## 7. 格納

- psycopg で `internal.<表>` に `insert ... on conflict (<PK>) do update` を `cursor.executemany` で流す。1,000 行ずつ。`period` を先に書く（FK のため）。列名とキーは表ごとの固定の定義から組み立て、利用者の入力を SQL に埋め込まない（値はすべてパラメータで渡す）。
- 接続（ADR 0009）: `psycopg.connect(url, prepare_threshold=None, connect_timeout=10)`。接続先は shared pooler の session mode（`SUPABASE_BATCH_DB_URL`）、ロールは `batch_writer`。工程ごとに開いて閉じ、GA4 と WP を待つ間は接続を持たない。同時に開くのは 1 本だけ。
- トランザクション: 工程 6 全体を `with conn.transaction():` の 1 つにまとめ、先頭で `set local statement_timeout = '120s'` を実行する。例外で抜ければロールバックする。
- 全置換する表（`article_summary`、`author_summary`、`article_milestone`）は、同じ基準日で `delete` → `insert` ではなく、upsert のあと「今回のキー集合にない行を delete」とする（同じトランザクションの中なので、BI のビルドから空の状態は見えない）。`benchmark_curve` はビューなので書き込みはない（02 §4.1）。`truncate` は使わない（`batch_writer` に truncate の grant を付けない。最終確認 低-2）。
- 移動窓（`period.kind = window`）の期間別行は upsert で上書きされる（キーが固定 ID なので古い日付範囲の行は残らない）。記事が増減した分は「今回のキー集合にない行を delete」で揃える。
- 書き込み件数は `batch_run.counts` に残す。行の内容はログに出さない。

## 8. 公開（キャッシュ更新）

- 工程 7 で Vercel の Deploy Hook（Environment の Secret `VERCEL_DEPLOY_HOOK_URL`。§16）を `httpx.post` で呼ぶ。応答本文を読まず、URL と応答をログに出さない（設計レビュー L-8）。`httpx` の例外は URL を含みうるので §14 の扱いで種別だけにする（失敗は `error_kind = network`）。Vercel がリポジトリの main をビルドし、ビルド時に `pub_*` ビューを anon キーで読んで全ページを静的生成する（ADR 0006）。
- ビルドが失敗したときは前回のデプロイが残り、`pub_meta.base_date` は進んでいるが画面は古いままになる。Vercel のビルド失敗通知（メール）を運用担当が受ける。BI の FR-02 表示はビルド時の `pub_meta` を埋め込むので、画面の「◯月◯日までのデータ」はその画面が生成された時点の値になる。
- 設定変更後の再ビルドやビルド失敗後の再試行は、`workflow_dispatch` の `publish_only` で Deploy Hook だけを呼ぶ（NFR-11）。`publish_only` は `batch_run` に行を書かない（§2、設計レビュー L-7）。

## 9. 直近 7 日の再取得と再実行

- 毎回、基準日から過去 7 日（基準日を含む 7 日）の日別値を取り直して上書きする（FR-71、NFR-03）。
- 再実行（手動、または 2 本目の cron）は同じ基準日で同じ結果になる（冪等）。`BASE_DATE` を過去日にして実行すると、その日を基準日とした移動窓を上書きするので、通常は使わない（試験用）。
- 失敗した翌日は、前日ぶんも「直近 7 日」に含まれるので日別値は自動で埋まる。期間値も移動窓なので自動で追いつく。欠けうるのは (a) `is_confirmed` になった月の参照元・市別、(b) 30 日が経過した記事の参照元上位 3、で、いずれも「行がない対象を次回に補う」規則（§3）で埋まる。

## 10. 初回バックフィル

`workflow_dispatch` で `mode = backfill`、`from = 2025-10-08`（設定値 `BACKFILL_START`、FR-75）、`to = 基準日`。手順:

1. wp_fetch を全件で実行（3 リクエスト + 著者 21 人）。
2. ga4_daily を 90 日ずつに分割して実行（G1〜G4 を 5 回ずつ。G4 は 90 日 × 300 pagePath ≈ 27,000 行 → `limit = 100000` で 1 リクエスト）。
3. period: 2025-10 以降のすべての月行を作る。
4. ga4_period を「移動窓 6 + 全月（14）」= 20 期間 = 4 つずつ 5 集合で実行（G5〜G15 の各 11 種 × 5 = 55 リクエスト。G13・G14 は 1 期間で 300 記事 × 5 区分 = 1,500 行なので 4 期間で 6,000 行、既定の 10,000 行に収まる）。
5. 確定した全月について G16（14 リクエスト）、G9 の確定月ぶんは手順 4 の応答から上位 10 を取る。
6. 30 日が経過した全記事について G17（約 220 リクエスト）。
7. derive、write、publish。

- 冪等なので失敗したら最初からやり直してよい。長くなる場合は `--phase` で手順 2、4、6 を別々に実行できるようにする。
- 割当: §11 のとおり 1 回で収まる見込みだが、`tokensPerProjectPerHour.remaining` が 2,000 を下回ったら処理を止めて `quota` で終了し、1 時間後に再実行する（G17 が最も多いので、手順 6 は記事 50 本ごとに残量を確認する）。
- 所要時間: リクエスト約 300 × (応答 1 秒 + 間隔 0.2 秒) ≈ 6〜8 分。`timeout-minutes: 60`。
- 2025-11 の不連続な値（03_data_sources.md §2.6）はそのまま取り込む（理由は確認しない）。
- 接続文字列の漏えい後の作り直し（06 §3、W-2）にも `backfill` を使う。工程 0 の二重実行の防止（同じ基準日の `success` があれば終了）は `daily` だけに効かせ、`backfill` を止めない。`backfill` の upsert は攻撃者が足した行を消さないこと、GA4 から取り直せない期間の値は戻らないことが未解決（§17）。

## 11. GA4 の割当の見積もり（D-01）

事実（2026-11-03、親が確認）: Core トークン 1 日 200,000、1 時間 40,000、1 プロジェクト × プロパティ 1 時間 14,000。ほとんどのリクエストは 10 トークン以下。

| 区分 | リクエスト数 | 1 リクエストの見込みトークン | 小計 |
| --- | --- | --- | --- |
| 通常日: G1〜G3、G5〜G8、G10〜G12、G19、G20（低カーディナリティ） | 21 | 10 | 210 |
| 通常日: G4、G13〜G15（pagePath / landingPage を含む） | 7 | 30（高カーディナリティ次元の加算を見込む） | 210 |
| 通常日: G9（city、約 250 行 × 4 期間） | 2 | 20 | 40 |
| 通常日: G16、G17（月 1、日 0〜2） | 0〜3 | 10 | 30 |
| 通常日 合計 | 約 34 | | 約 490（1 時間 14,000 の 3.5%、1 日 200,000 の 0.25%）。G18 は初回対象外（M-4）、G19・G20 は Q-36 で追加 |
| バックフィル: ga4_daily（90 日ずつ 5 回） | 20 | 30〜100（G4 は 27,000 行） | 1,000 |
| バックフィル: ga4_period（20 期間を 5 集合） | 65 | 10〜30 | 1,400 |
| バックフィル: G16、G17 | 234 | 10 | 2,400 |
| バックフィル 合計 | 約 320 | | 約 5,200（1 時間 14,000 の 37%） |

- 見込みが 5 倍外れても、通常日は 2,500、バックフィルは 26,000 で、1 日 200,000 に収まる。バックフィルが 1 時間 14,000 を超える場合だけ §10 の残量チェックで分割される。
- 実測は `returnPropertyQuota` の値を `batch_run.counts.ga4_tokens` に記録し、初回のバックフィルと最初の 1 週間で見込みと比べる。見込みの 3 倍を超えたら D-01 を開き直す。
- 同時リクエスト 10、サーバーエラー 1 時間 10 は、逐次実行と再試行 1 回の設計で超えない。

## 12. 60 日停止対策（D-07）

public リポジトリの定期実行は 60 日間リポジトリに活動がないと止まる（親が確認）。対策は 2 段。

1. 止めない: 日次ワークフローとは**別のワークフロー** `.github/workflows/heartbeat.yml` を置く（設計レビュー M-3。日次ワークフロー内のジョブに `contents: write` を置くと、そのジョブで動く依存や Action が侵害されたときに main へコードを push でき、翌日のバッチが接続文字列と WIF の下でそれを実行してしまうため）。
   - トリガー: `schedule`（月 1 回、例: 毎月 1 日 03:00 UTC）と `workflow_dispatch`。main のみ。
   - 権限: ワークフロー全体で `permissions: contents: write` のみ。`id-token` は付けない。
   - 中身: `actions/checkout`（GitHub 製、SHA 固定、`sparse-checkout: ops/`、`fetch-depth: 1`）と `git` CLI だけ。main の最新コミット（`git log -1 --format=%ct`）が 45 日以上前なら `ops/heartbeat.txt` に実行日（UTC の日付）を書き、固定メッセージ（「heartbeat: 定期実行の維持」）でコミット・push する。45 日以内なら何もしない。
   - 置かないもの: 依存のインストール（`pip install`、`pnpm install`）、プロジェクトのコード（`apps/`）、サードパーティ Action、Secrets の参照。
   - 日次ワークフロー（`daily.yml`）は `permissions: contents: read` と、バッチジョブだけの `id-token: write`（06 §9）。
   通常は Dependabot や文書更新のコミットで 45 日以内に活動があり、heartbeat はコミットしない。
2. 止まったことに気づく: BI の FR-02 表示は、ビルド時の `pub_meta.base_date` が前日より古ければ「更新が遅れています」と出す。ただし、ワークフローが止まると再ビルドも起きず、画面は最後のビルドの状態で固まる。そこで BI のクライアント側で「今日の日付 − 表示中の基準日 ≥ 3 日」なら同じ注記を出す（JavaScript で現在日付と比較する。データは読まない）。加えて、運用担当が月 1 回 Actions の実行一覧を確認する手順を docs/operations/ に書く（デプロイ工程）。

Supabase Free は 1 週間アクセスがないと一時停止するが、日次バッチが書き込むので止まらない。バッチが 60 日停止で止まれば 1 週間後に Supabase も止まり、復旧は Supabase の再開 → バッチ再実行の順になる（運用手順に書く）。

## 13. カテゴリ別ヒートマップの可否（D-12）

- 実現方法はある: バッチが G8 と同じ問い合わせに `pagePath` の `inListFilter`（カテゴリに属する記事の pagePath、最大 ...）を付けて期間ごとに取り、T を適用して `category_period_heatmap` に格納し、公開ビューで出す。記事 × 曜日 × 時間帯 は格納しないので、05 §4.1 の「格納しないもの」には触れない。ただし「カテゴリ × 曜日 × 時間帯」は現在「格納しないもの」に明記されているため、実現には NFR-39 の手順（05 §4.1 の表の変更、ADR、security-auditor のレビュー）が要る。
- コスト: 子カテゴリ約 20 × 期間 8 ÷ 4 = 40 リクエスト / 日の追加（約 400 トークン）。`inListFilter` の値の上限（記事数が多いカテゴリで 100 本超）に当たる可能性があり、親カテゴリ 4 つに限るのが現実的。
- 結論: 初回では提供しない（要件のとおり優先度 低）。提供するときは親カテゴリ 4 区分に限り、05 §4.1 に「親カテゴリ × 期間 × 曜日 × 時間帯（伏せ値あり）」の行を追加して NFR-39 の手順を踏む。

## 14. 失敗時の扱いと通知

- どの工程で失敗しても `batch_run` を `failed` にし、`failed_step` と `error_kind` だけを記録する。例外のメッセージとスタックは Actions のログにも出さない（NFR-44。エラーの種別に分類できないものは `unknown`）。
- 未処理例外の既定出力を止める（設計レビュー M-8）: Python は未処理例外のメッセージとスタックを stderr に出す。例外のメッセージには次のものが含まれうる（Secrets の自動マスクは値の完全一致にしか効かない）。
  - psycopg の接続エラー（`OperationalError`）: pooler の host、ポート、ユーザー名（`batch_writer.<PROJECT-REF>`）。接続文字列の解析エラーは接続文字列の一部を含みうる（パスワードを含む可能性を前提にする）。
  - psycopg の SQL エラー: 行の値（`diag.message_detail` の `Failing row contains (...)`、`Key (...)=(...)`）、表名、列名、SQL 文の断片（`diag.statement_position` など）。
  - GA4 のエラー（`google.api_core.exceptions`）: `properties/<ID>`。
  - `httpx` のエラー: リクエストの URL（Deploy Hook の URL を含む）。
  - pydantic の `ValidationError`: 入力値。
- 対策は次の 6 つ。
  1. エントリ（`apps/batch/src/takatsu_batch/__main__.py`）で全工程を `try / except BaseException` で囲み、`errors.classify_error(e) -> ErrorKind` で種別に分類し、`log.log_error(step, kind)`（工程名と種別だけ）を出して `sys.exit(1)` で終える。`SystemExit` は code が int（0 を含む）か `None` ならそのまま通し、それ以外（文字列つきの `sys.exit("...")` など）は `sys.exit(1)` に置き換える。工程の途中の 0 以外の `SystemExit` は失敗として扱う（`batch_run` を `failed`、種別は `unknown`）。例外オブジェクト、メッセージ、スタックをどこにも渡さない。再送出しない。
  2. 分類は例外の型と `sqlstate` だけを見る。`str(e)`、`repr(e)`、`e.args`、`e.diag`、`e.pgconn`、`e.pgresult`、`e.__cause__`、`e.__context__`、`e.__traceback__`、f 文字列への埋め込み、`logging.exception`、`traceback` の関数を使わない。ruff の `banned-api` と S-18 の `ast` のテストで、`except ... as` の束縛名を `classify_error` への受け渡しにだけ使えるようにする（束縛名に関係なく検出する。`errors.py` の中は型の判定と `sqlstate` の参照だけを許す）。
  3. 分類の規則: pydantic の `ValidationError` → `validation`。GA4 の `ResourceExhausted` → `quota`、`PermissionDenied` / `Unauthenticated` → `auth`、`google.api_core.exceptions.RetryError` → `network`、それ以外の `GoogleAPICallError` → `network`。`google.auth.exceptions` の例外（WIF の失敗を判別するため）→ `auth`。`httpx.HTTPError` → `network`。`psycopg.Error` は `sqlstate` で分け、class `28` → `auth`、class `08`・`53`・`57`、および `sqlstate` なしの `OperationalError`（接続の失敗。TLS の検証の失敗を含む）→ `network`、それ以外（`22`、`23`、`42` など）→ `db`。`psycopg.ProgrammingError` で `sqlstate` がないもの（接続文字列の解析エラーを含む）→ `validation`。その他 → `unknown`。CA の失効や交換も `network` になるので、切り分けは手順書に書く（ADR 0009「CA の失効と交換」）。
  4. 起動の最初に、標準ライブラリだけで次を順に行う（W-7）。第三者のライブラリと本体は、この後で関数の中から遅延 import する。第三者の import をフック登録より前に置くと、import 時の例外が既定の表示になるため（isort が import を先頭に寄せるので、`__main__.py` の先頭の import は標準ライブラリだけにする。ruff の `import-outside-top-level` を使うならこの箇所だけ除外する）。
     1. `os.dup2` で fd 2 を `/dev/null` へ向ける。ネイティブのライブラリや致命的エラーの出力は、Python のフックを通らず fd 2 に直接出るため。ログは `sys.stdout` だけに出すので影響しない。
     2. フックを登録する: `sys.excepthook`、`threading.excepthook`、`sys.unraisablehook` を、種別のみを出力して終える関数（unraisable は何も出さない）に置き換える。`warnings.simplefilter("ignore")` を設定する。`faulthandler` を有効にしない。
     3. `logging.disable(logging.CRITICAL)` と `logging.raiseExceptions = False` を設定する。
     4. `os.environ["GRPC_VERBOSITY"] = "NONE"` を設定する（ワークフローの設定に頼らない。gRPC の import より前に設定する。効果は I-B-11 (h) で確かめる）。

     この処理は `__main__.py` だけで行う。`__init__.py` には第三者の import も処理も書かない（`python -m` では先に読まれるため。pytest も import するので、ここで fd 2 を塞がない）。
  5. ライブラリのログを止める: `httpx` は INFO でリクエストの URL をログに出すので、`logging.basicConfig` を呼ばず、ルートロガーに `NullHandler` を付けてレベルを `CRITICAL + 1` にし、`logging.lastResort = None` にする。独自のレベルとハンドラを持つロガーはルートのレベルでは止まらないので、4 の `logging.disable` で止める。
  6. `batch_run` への `failed` の書き込みが失敗しても、そのエラーも出さず終了コードだけで知らせる。接続の失敗や import 時の例外では `batch_run` を `failed` にできない（§2 の Actions の失敗と、次回の行の不在で分かる）。
- 接続の設定（ADR 0009「TLS」）: `sslmode` と `sslrootcert` は `psycopg.connect` のキーワードでコードから渡し、`env.py` が `conninfo_to_dict` の実効値を検査する。接続文字列に TLS の設定を書かない。
- 接続文字列の扱い: `pydantic.SecretStr` で持ち、`psycopg.connect` に渡す直前にだけ `get_secret_value()` を呼ぶ。`repr` に出ない。
- テスト: 07 U-29、U-30、I-B-11（例外時のログに `postgresql://`、`pooler`、`batch_writer`、`Failing row`、`Key (`、`https://`、`properties/`、6 桁以上の数字列、`Traceback` が出ない）。
- 通知（FR-74）: 通知先は Q-12 で未確定。実装は GitHub Actions の `if: failure()` ステップで、通知先に「ワークフロー名、基準日、失敗した工程、種別、Actions の run URL」だけを送る。Q-12 の回答まではワークフロー失敗時の GitHub のメール通知（リポジトリの管理者に届く）で代える。
- BI は前回の成功時のデータで表示を続ける（NFR-90）。失敗した日は Deploy Hook を呼ばないので画面は変わらず、FR-02 の表示が「更新が遅れています」になる（§12 のクライアント側の判定）。

## 15. ログの規律

Actions のログは誰でも読める（public リポジトリ）。出すのは次だけ（NFR-44、security.md「GitHub Actions」）。

- 工程の開始・終了、所要時間。
- 件数: GA4 リクエスト数と消費トークン、WP リクエスト数、取り込んだ記事数、削除した記事数、書き込んだ行数。
- エラーの種別（§14）。
- 出さないもの: API の応答本文、行データ（記事タイトル、著者名、pagePath、参照元ドメイン、市名を含む）、トークン、プロパティ ID、接続文字列とその部品（pooler の host、ユーザー名、PROJECT-REF、パスワード）、SQL 文、SQLSTATE 以外の DB のエラー情報。環境変数の一覧を出す `env` や `printenv` を使わない。`ACTIONS_STEP_DEBUG` は使わない。
- ロガーは `apps/batch/src/takatsu_batch/log.py` に 1 つだけ置き、引数を件数・固定の種別・所要時間に限った関数（`log_count(step: Step, name: CountName, n: int)` など。`Step` と `CountName` は `Literal`）だけを公開する。任意のオブジェクトを出す関数を作らない。出力は `sys.stdout.write`。`print` は ruff の T201 で禁止する。
- pydantic のモデルは `model_config = ConfigDict(hide_input_in_errors=True)` を付けた共通の基底クラスから作る（検証エラーが入力値を含まないようにする。S-18 で検査）。環境変数の検証エラーでは `e.errors(include_input=False)` の `loc` だけを見て、変数名を種別と一緒に出してよい。値は出さない。
- pytest は CI で `--tb=short` を使い、`--showlocals` を使わない。結合テストの接続先はローカルだけなので本番の秘密は出ないが、習慣として揃える。

## 16. 設定値と環境変数

公開してよい設定（リポジトリ内。バッチは `apps/batch/src/takatsu_batch/config.py`、BI は `apps/web/src/lib/config.ts`。変更はコミットで記録。NFR-22 (1)）。下表の `RATIO_MIN_DENOMINATOR` は BI だけ、`SITE_ORIGIN` は両方（`contracts/constants.json` と突き合わせる。07 S-16）、それ以外はバッチだけ。`BENCHMARK_MIN_POPULATION` は `internal.benchmark_curve` の SQL にも現れる（I-DB-17 で一致を確かめる）:

| 名前 | 既定 | 根拠 |
| --- | --- | --- |
| MASK_THRESHOLD | 5 | NFR-33、FR-73 |
| RATIO_MIN_DENOMINATOR | 20 | NFR-96 |
| RECENT_HOT_MIN_PV_7D | 20 | M-22 |
| RECENT_HOT_MIN_AGE_DAYS | 15 | M-22 |
| LONG_AGE_DAYS | 91 | M-21 |
| BENCHMARK_MIN_POPULATION | 30 | M-19 |
| OWN_MEDIAN_MIN_POSTS | 5 | M-24 |
| MILESTONES | 500, 1000, 5000, 10000 | M-23 |
| BACKFILL_START | 2025-10-08 | FR-75、NFR-50 |
| REFETCH_DAYS | 7 | FR-71 |
| CONFIRM_DELAY_DAYS | 7 | 05 §4.1「確定した暦月」 |
| AD_CATEGORY_ID | 188 | Q-08 |
| TOP_N_REFERRER_SITE / TOP_N_CITY / TOP_N_REFERRER_ARTICLE | 10 / 10 / 3 | M-12、M-14 |
| SITE_ORIGIN | https://takatsu-connect.com | FR-04 |
| WP_REQUEST_INTERVAL_MS | 1000 | NFR-72 |

設定値 `MASK_ZERO` は置かない（D-16 確定: 0 は伏せない。切り替え可能にすると「0 を伏せる」設定で二次伏せの候補が崩れるため。設計レビュー M-1）。シェア数（M-41）に関する設定値もない（初回対象外、M-4）。

秘密情報（環境変数。`.env.example` には名前だけ。06 §3）:

| 名前 | 置き場所 | 用途 |
| --- | --- | --- |
| GCP_WORKLOAD_IDENTITY_PROVIDER | Actions Secrets | WIF（initial_setup.md §2） |
| GCP_SERVICE_ACCOUNT | Actions Secrets | 同上 |
| GA4_PROPERTY_ID | Actions Secrets | Data API のプロパティ |
| SUPABASE_URL | Vercel 環境変数のみ | プロジェクト URL（ビルド時に `pub_*` を読む） |
| SUPABASE_BATCH_DB_URL | GitHub Environment（`production`、main のみ）の Secret のみ。`daily` と `backfill` の取得・書き込みのステップだけに渡す | `batch_writer` の接続文字列（shared pooler の session mode。形式は `postgresql://batch_writer.[PROJECT-REF]:[PASSWORD]@[POOLER-HOST]:5432/postgres`。TLS の設定はコードで固定するので含めない。ADR 0009）。読み書きの対象は内部表だけ |
| SUPABASE_ANON_KEY | Vercel 環境変数のみ（`NEXT_PUBLIC_` を付けない） | ビルド時に `pub_*` を読む |
| VERCEL_DEPLOY_HOOK_URL | GitHub Environment（`production`、main のみ）の Secret | 再ビルドの起動 |
| LOCAL_BATCH_WRITER_PASSWORD | ローカルの `.env` だけ（CI は実行時に生成する。本番では使わない） | ローカルの `batch_writer` のパスワード（02 §8） |
| NOTIFY_WEBHOOK_URL など | Actions Secrets | 失敗通知（Q-12 の回答後に名前を決める） |
| BASE_DATE | （任意、workflow_dispatch の入力） | 試験・再実行 |

`env.py` は mode ごとに必須の変数だけを検証する。`publish_only` が必要とするのは `VERCEL_DEPLOY_HOOK_URL` だけで、ワークフローも他の秘密を渡さない。Environment が使えない場合の代替は ADR 0009「接続文字列のブランチへの束縛」。

## 17. 未確定

- ADR 0009 の未確定: pooler の TLS の基準の段階（第 1 か第 2。確認項目 1）、`executemany` の挙動、IPv4 での到達（実装時と 07 A-11）。
- 漏えい後の作り直し（§10、06 §3）: `backfill` の upsert で消えない、攻撃者が足した行をどう消すか。`batch_writer` には truncate がない。GA4 から取り直せない期間があるときに値をどう扱うか。手順は docs/operations/ で決める。
- W-7 の対策が頼るライブラリの挙動（`GRPC_VERBOSITY` の値、fd 2 の塞ぎ方で足りるか）は監査の時点で未確認。07 I-B-11 で確かめる。
- Q-13: 実行時刻 T（仮 17:00 JST、鮮度 18:00）。cron の遅延を踏まえ、1 回目を 16:30 JST に前倒しする案も依頼者に示す。
- Q-12: 失敗通知の宛先。
- D-05 の残り: `/<ID>/<何か>/` の pagePath が実測で現れるか（親が GA4 で確認）。
- D-03 の残り: `modified_after` が対象サイトの WordPress で使えるか（実装時に 1 回確認。使えなければ §4 の代替）。
- 全体 × 日 × 流入チャネルの「二次伏せ」で、日によっては 5 区分のうち 2〜3 区分が伏さる見込み（other、referral が小さい）。日別推移には内訳を描かず、期間の構成（FR-13、FR-14）は Q-36 で確定した期間値（G19、G20）で出すことで表示上の問題を避ける（05_screens.md §3）。
- D-15 の検証（§5.1）を運用担当が GA4 の UI で行う手順は docs/operations/（デプロイ工程）に書く。

確定した事項（2026-11-03、設計 2 回目と設計レビューの反映で「未確定」から移動）:

- Q-35: (b) 日別のユーザー数は取得も格納もしない。FR-11 の切り替えは読まれた回数と訪問回数の 2 つだけ（§5.3）。
- D-09: `AddToAnyShare` のサービス別は取れない（Data API はカスタム次元として登録したイベントパラメータしか次元として返さず、登録済みの 11 個にシェア先に当たるものがない。03_data_sources.md §2.6）。M-41 は合計（全体・著者）のみ。確定。ただし M-41 自体は初回対象外（設計レビュー M-4。G18 を作らない）。
- Q-36: 全体 × 期間 × 流入チャネル / デバイス を `site_period_breakdown` の axis `channel` / `device_pv` / `device_sessions` として期間ごとに GA4 から取る（G19、G20。§5.4、§11）。二次伏せあり。05 §4.1 への行の追加は requirements-analyst が反映、理由は ADR 0003 判断 6。
- D-16: 0 は伏せない。二次伏せの候補は T 以上の最小セル（§6.1 手順 1・3、設計レビュー M-1）。`MASK_ZERO` は置かない。
- Q-33: 二次伏せを公開しない（ADR 0003 判断 5）。
