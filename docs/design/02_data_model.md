# 02 データモデル（Supabase）

- 状態: 草案
- 更新日: 2026-11-03
- 参照: 05_non_functional.md §4.1（格納と公開の組み合わせ）、NFR-30〜NFR-45、NFR-50〜NFR-52、FR-36、FR-73、FR-76、ADR 0003、ADR 0005、ADR 0007
- 変更履歴: 2026-11-03: 設計レビュー（audits/2026-11-03-design-review.md）の H-1・M-1〜M-8・L-1〜L-10 と Q-36 を反映

## 1. 方針

- 05 §4.1 の表を「そのまま実装」する。表にない組み合わせの表・列・ビューは作らない（NFR-33）。
- 表は 2 種類に分け、スキーマも分ける（設計レビュー M-7）。
  - 内部表（§3）: スキーマ `internal`。日次バッチ（GitHub Actions、service role）だけが読み書きする。anon / authenticated / PUBLIC には `internal` スキーマへの usage を与えず、Supabase の API 設定「Exposed schemas」にも含めない（PostgREST から見えない）。加えて全表で RLS 有効、grant なし。
  - 公開ビュー（§4、名前は `pub_` で始まる）: スキーマ `public`。anon ロールが select できる唯一の対象。BI（Vercel のビルド）はこのビューだけを読む。ビューは所有者（postgres）権限で `internal` の表を読む。伏せ値を適用済みの値だけを置き、生の内訳セルは置かない。除外著者（FR-36）の記事行・著者行は公開ビューで除く（ADR 0005）。
- 合計・累積は伏せる前の値から計算する。内部表のうち「記事 × 日」「全体 × 日」「読まれていた時間の合計」など 05 §4.1 で「伏せ値なし」とされたものは生値で持ち、それ以外の内訳セルは伏せ処理後の値だけを持つ（内部表にも生の内訳セルは残さない。バッチのメモリ上でだけ生値を扱う）。
- 集計の実行場所は ADR 0007 のとおり。GA4 から期間ごとに取得する集計値と、伏せ値・二次伏せ・分布（M-19）・判定（M-22、M-23、M-24）はバッチ（TypeScript）が計算して表に書く。記事の期間合計から導ける著者・カテゴリ（親・子）・タグ・鮮度区分の合計と公開本数は、公開ビュー（SQL）が計算する。
- 除外（FR-36）の規則（05 §4.1 用語「除外後」、設計レビュー H-1）: 記事の値から合算する集計（著者、カテゴリの親・子、タグ、鮮度区分の合計・記事数・1 本あたりの中央値）はすべて除外後。除外込みは GA4 のサイト全体値（`site_daily`、`site_daily_*`、`site_period`、`site_period_breakdown`、`site_period_heatmap`、`site_month_*`）と公開本数の件数（`pub_posting_monthly`、`pub_posting_period` の `post_count`）だけ。
- シェア数（M-41、FR-61）は初回対象外。表・列・問い合わせを作らない（設計レビュー M-4）。実装するときは NFR-39 の手順で 05 §4.1 に行を追加してから着手する。
- スキーマ変更はマイグレーションファイル（`supabase/migrations/NNNN_*.sql`）で行う（NFR-73、§8）。

## 2. 共通の表現（時刻、期間、伏せ値、キー）

### 2.1 時刻

| 用途 | 型 | 規則 |
| --- | --- | --- |
| 日付キー（GA4 の date、記事の公開日、基準日） | `date` | Asia/Tokyo の暦日。GA4 の `date` 次元はプロパティのタイムゾーン（Asia/Tokyo）で切られているのでそのまま入れる（Q-07 確定、NFR-82） |
| 記事の公開日時・更新日時 | `timestamptz` | WP REST API の `date_gmt` / `modified_gmt` を UTC として保存する。`published_on date` は `date_gmt` を Asia/Tokyo に変換した暦日（サイトのタイムゾーン設定に依存しない） |
| 実行時刻（バッチ、更新） | `timestamptz` | UTC で保存。表示は BI が Asia/Tokyo に変換し「JST」を明示する（NFR-82） |
| 時間帯（M-16） | `smallint` 0〜23 | GA4 の `hour`（Asia/Tokyo） |
| 曜日（M-16） | `smallint` 0〜6 | GA4 の `dayOfWeek`（0 = 日曜） |

### 2.2 期間

05 §4.1 の「移動窓」「月」「確定した暦月」「公開後 30 日時点」を次のように持つ。

- 表 `period` に期間を 1 行ずつ置き、期間別の表は `period_id` で参照する。
- 移動窓は固定の ID 6 つ（`last7`、`prev7`、`last28`、`prev28`、`last90`、`prev90`）で、日付範囲（`start_date`、`end_date`）を毎日のバッチが基準日に合わせて更新する。移動窓の期間別データは「基準日時点の値」だけを持ち、履歴は残さない（履歴を残すと移動窓の日次差分から日別の内訳が復元しやすくなるため。ADR 0003 判断 3）。
- 月は `m2025-10` のような ID で、2025-10 から基準日の属する月まで 1 行ずつ。`is_confirmed` は「月末 + 7 日 ≤ 基準日」のとき true（遅延データの反映を待った、確定した暦月）。基準日の属する月は `end_date = 基準日` の部分期間。前月比・前年同月比は BI が月 ID を計算して引く。
- 確定した暦月だけに許される組み合わせ（参照元ドメイン、市別）は、`is_confirmed = true` の月についてだけ行を作り、以後更新しない（§3.4）。
- 公開後 30 日時点は、記事ごとに 1 回だけ計算して `article_referrer_30d` に置き、`article_summary.referrer_30d_computed_on` で計算済みを示す（§3.4、§3.5）。

### 2.3 伏せ値と二次伏せ

- 伏せ値を適用する列は、`<指標名> integer`（伏せたときは null）と `<指標名>_mask text`（null = 伏せていない、`threshold` = T 未満で伏せた、`secondary` = 二次伏せ）の 2 列で表す。
- 公開ビューには `<指標名>` だけを出し、`_mask` 列は出さない。二次伏せかどうかを公開すると「伏せたセルのうち 1 つは T 以上」と分かり、合計との差から値を狭められるため。画面では一次伏せ・二次伏せの区別なく「—」と表示し、セルの近くに「伏せ値」と添える（確定、2026-11-03、Q-33。理由は ADR 0003 判断 5。表示の規則は 05_screens.md §2.3）。
- しきい値 T = 5（NFR-33）は設定値 `MASK_THRESHOLD` で、バッチが実行記録（`batch_run.mask_threshold`）に残す。
- 参照元ドメイン・市別の各行の伏せ値は「T 未満の行を格納しない」で表す（ホスト名・市名そのものが識別性を持つため、値だけ伏せて名前を残さない）。
- 0 の扱い（GA4 が行を返さない区分）: 0 として格納し、伏せない（D-16 確定、2026-11-03、設計レビュー M-1）。二次伏せで追加して伏せるセルは「伏せていない、値が T 以上のセルのうち最小」で、0 と T 未満のセルは候補にしない。該当がなければ追加しない（03 §6.1、ADR 0003 判断 2）。
- 階層差分（設計レビュー M-2）: 著者 × 内訳軸 のセルは、同じ bucket で伏せた記事セルがちょうど 1 本のときは著者セルも伏せる（`_mask = secondary`）。§3.3 `author_period_breakdown`、03 §6.1 手順 5。

### 2.4 キーと命名

- 記事のキーは WordPress の投稿 ID（`post_id integer`）。GA4 の pagePath から取り出した数値と突き合わせる（02_metrics.md §3、03_data_pipeline.md §5.1）。
- 著者のキーは `author_slug text`（NFR-35。WordPress のユーザー ID は格納しない）。
- カテゴリ・タグのキーは WordPress の term ID。
- 列名は snake_case。読まれた回数は `pageviews`、訪問回数は `sessions`、読んだ人の数は `active_users`、読まれていた時間の合計は `engagement_seconds`。
- 削除・非公開化された記事は `wp_post` の行を削除し、`on delete cascade` で記事に関する行をすべて消す（NFR-52）。

## 3. 内部表（anon から読めない）

すべて `internal` スキーマ（設計レビュー M-7。以下の表名は `internal.` を省く）。すべて RLS 有効、anon / authenticated への grant なし。`updated_at timestamptz not null default now()` は全表に付け、以下では省く。

### 3.1 WordPress 由来の次元表

`wp_author`

| 列 | 型 | 制約・意味 |
| --- | --- | --- |
| author_slug | text | PK。著者ページ URL の slug。画面には文字列として出さない（NFR-35） |
| display_name | text | not null。表示名（`users/<id>` の `name`） |
| author_url | text | not null。著者ページ URL（`users/<id>` の `link`）。takatsu-connect.com 配下であることをバッチが検証する |
| first_seen_on | date | not null。初めて取り込んだ基準日 |

`wp_post`

| 列 | 型 | 制約・意味 |
| --- | --- | --- |
| post_id | integer | PK。WordPress の投稿 ID |
| title | text | not null。`title.rendered` を HTML エンティティ復号して保存 |
| post_url | text | not null。`link`。takatsu-connect.com 配下であることを検証（FR-04） |
| author_slug | text | not null、FK → wp_author |
| published_at | timestamptz | not null。`date_gmt` |
| published_on | date | not null。`published_at` の Asia/Tokyo 暦日。M-18 の「1 日目」 |
| modified_at | timestamptz | not null。`modified_gmt`。差分取得の基準（D-03） |
| is_ad | boolean | not null default false。広告カテゴリ（設定値 `AD_CATEGORY_ID` = 188）に属する（Q-08） |
| first_seen_on | date | not null |

`wp_category`

| 列 | 型 | 制約・意味 |
| --- | --- | --- |
| category_id | integer | PK |
| name | text | not null |
| parent_id | integer | null、FK → wp_category。null なら親カテゴリ（記事 / イベント / マップ / 広告） |
| path | text | not null。「親 > 子」。同名の子を区別する（03 §3.2） |

`wp_tag`: `tag_id integer PK`、`name text not null`。

`wp_post_category`: `post_id integer FK → wp_post on delete cascade`、`category_id integer FK → wp_category`、PK (post_id, category_id)。
`wp_post_tag`: `post_id`、`tag_id`、同様。

### 3.2 GA4 由来の日別表

`site_daily`（05 §4.1 行 1: 全体 × 日。伏せ値なし）

| 列 | 型 | 制約・意味 |
| --- | --- | --- |
| day | date | PK |
| pageviews | integer | not null。screenPageViews（M-01） |
| sessions | integer | not null。sessions（M-02） |

`site_daily_channel`（行 2: 全体 × 日 × 流入チャネル。伏せ値あり、二次伏せあり）

| 列 | 型 | 制約・意味 |
| --- | --- | --- |
| day | date | PK の一部 |
| channel | text | PK の一部。`search` / `social` / `direct` / `referral` / `other`（M-10 の 5 区分） |
| sessions | integer | null = 伏せ |
| sessions_mask | text | null / `threshold` / `secondary` |

`site_daily_device`（行 2: 全体 × 日 × デバイス。伏せ値あり、二次伏せあり）

| 列 | 型 | 制約・意味 |
| --- | --- | --- |
| day | date | PK の一部 |
| device | text | PK の一部。`mobile` / `desktop` / `tablet` |
| pageviews | integer | null = 伏せ |
| pageviews_mask | text | |
| sessions | integer | null = 伏せ |
| sessions_mask | text | |

`article_daily`（行 7: 記事 × 日。伏せ値なし、ADR 0003 判断 1）

| 列 | 型 | 制約・意味 |
| --- | --- | --- |
| post_id | integer | PK の一部、FK → wp_post on delete cascade |
| day | date | PK の一部 |
| pageviews | integer | not null。pagePath を記事 ID に正規化して合算した screenPageViews |

記事以外のページと削除済み記事の pagePath は記事単位では格納しない（02_metrics.md §3）。全体の値は `site_daily` が持つ。

### 3.3 GA4 由来の期間別表

`period`

| 列 | 型 | 制約・意味 |
| --- | --- | --- |
| period_id | text | PK。`last7` / `prev7` / `last28` / `prev28` / `last90` / `prev90` / `mYYYY-MM` |
| kind | text | not null。`window` / `month` |
| start_date | date | not null |
| end_date | date | not null。基準日の属する月は基準日 |
| base_date | date | not null。この行を最後に計算した基準日 |
| is_confirmed | boolean | not null。月のみ true になりうる（月末 + 7 日 ≤ 基準日）。移動窓は常に false |

`site_period`（行 3・4 の一部: 全体 × 期間）

| 列 | 型 | 制約・意味 |
| --- | --- | --- |
| period_id | text | PK、FK → period |
| engagement_seconds | bigint | not null。userEngagementDuration の合計（M-06 の分子。伏せ値なし） |
| active_users | integer | null = 伏せ。期間単位で取得した activeUsers（M-03、D-06） |
| active_users_mask | text | |

読まれた回数・訪問回数の期間合計は `site_daily` から公開ビューが合計する（別表に持たない）。シェア数（`share_count`、M-41）の列は置かない（初回対象外。設計レビュー M-4。FR-61 を実装するときは NFR-39 で 05 §4.1 に行を追加してから列を足す）。

`site_period_breakdown`（行 4: 全体 × 期間 × SNS 種別 / 初めて・また来た、行 6: 地元の読者の目安、Q-36: 全体 × 期間 × 流入チャネル / デバイス。いずれも二次伏せあり）

| 列 | 型 | 制約・意味 |
| --- | --- | --- |
| period_id | text | PK の一部、FK → period |
| axis | text | PK の一部。`sns`（M-11、値は sessions）/ `new_returning`（M-15、値は activeUsers）/ `local`（M-14 の 3 区分、値は sessions）/ `channel`（M-10 の 5 区分、値は sessions。FR-13）/ `device_pv`（M-13 の 3 区分、値は screenPageViews。FR-14）/ `device_sessions`（M-13 の 3 区分、値は sessions。FR-14）。`channel` と `device_*` は Q-36 の確定（2026-11-03）で追加。期間ごとに GA4 から直接取る（03 §5.4 G19・G20）。日別表 `site_daily_channel` / `site_daily_device` の合算では伏せ値の分だけ過小になるため、合算しない |
| bucket | text | PK の一部。sns: `instagram` / `facebook` / `x` / `line` / `other`。new_returning: `new` / `returning` / `unknown`。local: `kawasaki` / `japan_other` / `unknown`。channel: `search` / `social` / `direct` / `referral` / `other`。device_pv / device_sessions: `mobile` / `desktop` / `tablet` |
| value | integer | null = 伏せ |
| value_mask | text | |

`site_period_heatmap`（行 4: 全体 × 期間 × 曜日 × 時間帯。伏せ値あり、二次伏せあり。168 セルを 1 つの排他的区分として 03 §6.1 と同じアルゴリズムを適用する。設計 1 回目の「伏せたセルが 1 つだけになることは実質ない」は 90 日窓や月では成立しないため撤回した。設計レビュー L-1、ADR 0003 判断 2）

| 列 | 型 | 制約・意味 |
| --- | --- | --- |
| period_id | text | PK の一部 |
| dow | smallint | PK の一部。0〜6 |
| hour | smallint | PK の一部。0〜23 |
| pageviews | integer | null = 伏せ |
| pageviews_mask | text | |

1 日あたり平均（FR-12 の既定）は BI が `period` の日付範囲からその曜日の出現回数を数えて割る。

`article_period`（行 8: 記事 × 期間。pageviews は伏せ値なし、他は伏せ値あり）

| 列 | 型 | 制約・意味 |
| --- | --- | --- |
| post_id | integer | PK の一部、FK → wp_post on delete cascade |
| period_id | text | PK の一部、FK → period |
| pageviews | integer | not null。`article_daily` の期間合計（伏せない。05 §4.1「記事の期間合計」） |
| landing_sessions | integer | null = 伏せ。sessions × landingPage（M-17） |
| landing_sessions_mask | text | |
| scroll_count | integer | null = 伏せ。eventCount（eventName = scroll、M-09 の分子） |
| scroll_count_mask | text | |
| engagement_seconds | integer | null = 伏せ。userEngagementDuration × pagePath（M-06 の分子） |
| engagement_seconds_mask | text | |

`article_period_breakdown`（行 9: 記事 × 期間 × 内訳軸 1 つ。二次伏せあり）

| 列 | 型 | 制約・意味 |
| --- | --- | --- |
| post_id | integer | PK の一部、FK → wp_post on delete cascade |
| period_id | text | PK の一部 |
| axis | text | PK の一部。`channel`（M-10）/ `sns`（M-11）/ `device`（M-13）。値はいずれも landingPage 基準の sessions |
| bucket | text | PK の一部。channel: 5 区分、sns: 5 区分、device: 3 区分 |
| sessions | integer | null = 伏せ |
| sessions_mask | text | |

`author_period_breakdown`（行 12: 著者 × 期間 × 内訳軸 1 つ。二次伏せあり）

| 列 | 型 | 制約・意味 |
| --- | --- | --- |
| author_slug | text | PK の一部、FK → wp_author on delete cascade |
| period_id | text | PK の一部 |
| axis | text | PK の一部。`channel` / `sns`（デバイスは格納しない。05 §4.1） |
| bucket | text | PK の一部 |
| sessions | integer | null = 伏せ。著者の記事の生値（伏せる前）を合算してから T と二次伏せを適用。除外後（FR-36 の除外著者は行自体を公開ビューで除く） |
| sessions_mask | text | null / `threshold` / `secondary`。階層差分の対策（設計レビュー M-2、03 §6.1 手順 5）: 同じ period_id・axis・bucket で、その著者の記事セル（`article_period_breakdown`）のうち伏せたものがちょうど 1 本のときは、著者セルの値が T 以上でも `secondary` で伏せる（著者の値 − 可視記事の表示値の和 = 伏せた記事の値 になるため）。0 本または 2 本以上なら伏せない |

著者 × 期間 シェア数（`author_period_share`、M-41）の表は作らない（初回対象外。設計レビュー M-4）。

### 3.4 確定した暦月・公開後 30 日時点の表

`site_month_referrer`（行 5: 全体 × 確定した暦月 × 参照元ドメイン上位 10）

| 列 | 型 | 制約・意味 |
| --- | --- | --- |
| period_id | text | PK の一部、FK → period。`kind = 'month'` かつ `is_confirmed = true` の月のみ（check はビューとバッチで保証） |
| rank | smallint | PK の一部。1〜10 |
| source_domain | text | not null。sessionSource（Referral に限定）。小文字化 |
| sessions | integer | not null。T 以上の行だけを格納する（T 未満の行は格納しない = 伏せ値の適用） |

`site_month_city`（行 5: 全体 × 確定した暦月 × 市別上位 10）

| 列 | 型 | 制約・意味 |
| --- | --- | --- |
| period_id | text | PK の一部 |
| rank | smallint | PK の一部。1〜10 |
| country | text | not null。`Japan` に限定（M-14「国内」） |
| region | text | not null。都道府県 |
| city | text | not null。市（`(not set)` は上位に含めない。「不明」は 3 区分の `unknown` で扱う） |
| sessions | integer | not null。T 以上の行だけ |

`article_referrer_30d`（行 10: 記事 × 公開後 30 日時点 × 参照元ドメイン上位 3）

| 列 | 型 | 制約・意味 |
| --- | --- | --- |
| post_id | integer | PK の一部、FK → wp_post on delete cascade |
| rank | smallint | PK の一部。1〜3 |
| source_domain | text | not null |
| sessions | integer | not null。T 以上の行だけ |
| computed_on | date | not null。計算した基準日。以後更新しない |

### 3.5 派生表（バッチが計算）

`benchmark_curve`（M-19、M-27。基準日ごとに全置換）

| 列 | 型 | 制約・意味 |
| --- | --- | --- |
| scope | text | PK の一部。`all` または `cat:<category_id>`（母集団 30 本以上の子カテゴリだけ） |
| n | smallint | PK の一部。1〜90 |
| p25 | numeric | not null |
| p50 | numeric | not null |
| p75 | numeric | not null |
| population_size | integer | not null。30 以上 |
| population_window | text | not null。`12m`（直近 12 か月に公開）/ `all`（全期間に広げた） |
| base_date | date | not null |

母集団が 30 本未満のときは行を作らない（BI は行がなければ「まだ比較できません」）。広告カテゴリの記事は母集団に含めない。

`article_summary`（M-20〜M-24 の記事ごとの判定。基準日ごとに全置換）

| 列 | 型 | 制約・意味 |
| --- | --- | --- |
| post_id | integer | PK、FK → wp_post on delete cascade |
| base_date | date | not null |
| age_days | integer | not null。基準日 − published_on + 1（公開日を 1 日目） |
| freshness | text | not null。`new`（1〜30 日）/ `mid`（31〜90 日）/ `long`（91 日以上）（M-21） |
| pv_7d | integer | null。公開後 7 日間の累積（age_days ≥ 7 のときだけ）（M-20） |
| pv_30d | integer | null。公開後 30 日間の累積（age_days ≥ 30 のときだけ） |
| pv_total | integer | not null。公開以降の累積 |
| band_7d | text | null。`upper` / `middle` / `lower`。pv_7d と benchmark_curve(all, 7) の比較。age_days < 3 や曲線がないときは null |
| band_30d | text | null。同、N = 30。30 日未経過の記事は現時点の累積と同じ日数の帯で比べた値 |
| is_recent_hot | boolean | not null。M-22「最近読まれている」 |
| is_revival | boolean | not null。M-22「久しぶりに読まれた」 |
| is_evergreen_365 | boolean | not null。M-23「1 年たっても読まれています」 |
| referrer_30d_computed_on | date | null。`article_referrer_30d` を計算した日（0 行でも日付を入れる） |

`article_milestone`（M-23 の節目）: `post_id`、`milestone integer`（500 / 1000 / 5000 / 10000）、`reached_on date`、PK (post_id, milestone)。到達日は `article_daily` の累積から求める。

`author_summary`（M-24、FR-31 (b)。基準日ごとに全置換）

| 列 | 型 | 制約・意味 |
| --- | --- | --- |
| author_slug | text | PK、FK → wp_author on delete cascade |
| base_date | date | not null |
| own_median_30d | integer | null。直近 12 か月に公開し 30 日以上経過した自分の記事の pv_30d の中央値。該当 5 本未満なら null（M-24） |
| eligible_count | integer | not null |
| band_30d | text | null。own_median_30d と benchmark_curve(all, 30) の比較（FR-31 (b)） |

### 3.6 運用表（実行記録、除外リスト、未対応参照元）

`batch_run`（FR-76）

| 列 | 型 | 制約・意味 |
| --- | --- | --- |
| run_id | bigint | PK、generated always as identity |
| started_at | timestamptz | not null |
| finished_at | timestamptz | null |
| base_date | date | not null |
| mode | text | not null。`daily` / `backfill` / `manual` |
| status | text | not null。`running` / `success` / `failed` |
| failed_step | text | null。失敗した工程名（`wp_fetch` / `ga4_daily` / `ga4_period` / `derive` / `write` / `publish`） |
| error_kind | text | null。エラーの種別だけ（`quota` / `auth` / `network` / `validation` / `db` / `unknown`）。メッセージ本文は入れない（NFR-44） |
| mask_threshold | smallint | not null。実行時の T |
| counts | jsonb | not null default '{}'。件数と所要時間だけ。キーは固定（ga4_requests、ga4_tokens、ga4_tokens_remaining_day、ga4_tokens_remaining_hour、wp_requests、posts_upserted、posts_deleted、rows_written、duration_ms）で値はすべて数値。バッチ側は固定キー・数値のみの zod スキーマで書き、DB にも `check` 制約（immutable 関数 `internal.counts_is_numeric(jsonb)`: すべての値が `jsonb_typeof = 'number'` で、キーが上の一覧に含まれる）を置く（設計レビュー L-6）。API の応答や行データは入れない |
| github_run_id | text | null。Actions の run ID（ログを辿るため。秘密ではない） |

`excluded_author`（FR-36、D-10、ADR 0005。秘密情報として扱う、NFR-40）

| 列 | 型 | 制約・意味 |
| --- | --- | --- |
| author_slug | text | PK。FK は付けない（著者行が消えても除外を維持する） |
| excluded_at | timestamptz | not null default now() |

申し出の経緯（誰が、いつ、誰の申し出で）はこの表に入れない。台帳はリポジトリ外（NFR-73、ADR 0005）。

`sns_source_unmapped`（D-02 の運用補助。公開しない）

| 列 | 型 | 制約・意味 |
| --- | --- | --- |
| source | text | PK。M-11 の 5 区分に対応づけられなかった Organic Social の sessionSource（小文字） |
| first_seen_on | date | not null |
| last_seen_on | date | not null |
| last_sessions | integer | not null。直近に見た期間の sessions |

## 4. 公開ビュー（anon が select できる）

- すべて `public` スキーマ、名前は `pub_` で始まる。`public` スキーマには公開ビュー以外のオブジェクトを置かない。これ以外のオブジェクトを anon に grant しない。
- ビューは既定（`security_invoker` を付けない）で作る。Postgres のビューは既定で所有者（postgres）の権限で base 表（`internal` スキーマ）を読むため、anon は内部表に直接触れずにビューの投影だけを読める。所有者権限のビューは base 表の RLS を通らないので、実効的な守りは grant と `internal` スキーマの非公開である（06 §2.3）。security.md「`security definer` の関数やビューは、公開してよい列だけを返すことを確かめてから使う」に該当し、各ビューの列を §5 の対応表で確認する（ADR 0007）。Supabase のアドバイザが出す「security definer view」の警告は意図したものとして受け入れる（06 §13）。
- 「除外」= `where not exists (select 1 from internal.excluded_author e where e.author_slug = <行の著者 slug>)`。記事行は `wp_post.author_slug` で判定する。
- 除外の有無を示す列はどのビューにも置かない（NFR-43）。
- `_mask` 列は出さない（§2.3）。

| ビュー | 元の表 | 列 | 除外 | 対応する 05 §4.1 の行 / 用途 |
| --- | --- | --- | --- | --- |
| pub_meta | batch_run | base_date、finished_at（最後の success）、mask_threshold、is_stale（基準日が前日より古い）、last_status | ― | FR-02、NFR-90 |
| pub_batch_run | batch_run | run_id、started_at、finished_at、base_date、mode、status、failed_step、error_kind（直近 30 件） | ― | FR-02、FR-76 |
| pub_period | period | period_id、kind、start_date、end_date、is_confirmed | ― | FR-01 |
| pub_author | wp_author | author_slug、display_name、author_url | 除外 | FR-30、NFR-35 |
| pub_post | wp_post + wp_author + article_summary | post_id、title、post_url、author_slug、display_name、published_on、is_ad、age_days、freshness | 除外 | FR-20〜FR-25、FR-32 |
| pub_category | wp_category | category_id、name、parent_id、path | ― | FR-40 |
| pub_tag | wp_tag | tag_id、name | ― | FR-42 |
| pub_post_category | wp_post_category | post_id、category_id | 除外 | 記事の属性 |
| pub_post_tag | wp_post_tag | post_id、tag_id | 除外 | 記事の属性 |
| pub_site_daily | site_daily | day、pageviews、sessions | ― | 行 1。FR-11 |
| pub_site_daily_channel | site_daily_channel | day、channel、sessions | ― | 行 2。FR-11 の内訳 |
| pub_site_daily_device | site_daily_device | day、device、pageviews、sessions | ― | 行 2。FR-14 |
| pub_site_period | period + site_daily + site_period | period_id、pageviews（Σ site_daily）、sessions（Σ）、active_users、engagement_seconds、days（期間の日数）。share_count は置かない（M-4、初回対象外） | ― | 行 3・4。FR-10 |
| pub_site_period_breakdown | site_period_breakdown | period_id、axis、bucket、value | ― | 行 4・6、Q-36。FR-13（SNS、channel）、FR-14（device_pv、device_sessions）、FR-15（地元）、FR-16 |
| pub_site_period_heatmap | site_period_heatmap | period_id、dow、hour、pageviews | ― | 行 4。FR-12。二次伏せ適用済み（L-1） |
| pub_site_period_freshness | article_period + wp_post + article_summary | period_id、freshness、post_count、pageviews | 除外後（記事の値から合算する集計。H-1） | 行 11（M-25 の全体の鮮度 3 区分、派生値）。FR-10 折りたたみ。主カードの `pub_site_period.pageviews`（除外込み）とは一致しないことを画面で注記する（FR-10） |
| pub_site_month_referrer | site_month_referrer | period_id、rank、source_domain、sessions | ― | 行 5。FR-13 |
| pub_site_month_city | site_month_city | period_id、rank、region、city、sessions | ― | 行 5。FR-15 |
| pub_article_daily | article_daily | post_id、day、pageviews | 除外 | 行 7。FR-23 (2) |
| pub_article_cumulative | article_daily + wp_post | post_id、n（1〜90）、cumulative_pv（窓関数で累積） | 除外 | M-18。FR-23 (3) |
| pub_article_period | article_period | post_id、period_id、pageviews、landing_sessions、scroll_count、engagement_seconds | 除外 | 行 8。FR-20〜FR-24、FR-32 |
| pub_article_period_breakdown | article_period_breakdown | post_id、period_id、axis、bucket、sessions | 除外 | 行 9。FR-23 (6)(7)、FR-32 の主な経路 |
| pub_article_referrer_30d | article_referrer_30d | post_id、rank、source_domain、sessions | 除外 | 行 10。FR-23 (6) |
| pub_article_summary | article_summary | post_id、age_days、freshness、pv_7d、pv_30d、pv_total、band_7d、band_30d、is_recent_hot、is_revival、is_evergreen_365、referrer_30d_computed_on | 除外 | M-20〜M-23。FR-21、FR-23、FR-25、FR-34 |
| pub_article_milestone | article_milestone | post_id、milestone、reached_on | 除外 | M-23。FR-23 (4)、FR-31 (d) |
| pub_author_period | wp_post + article_period + article_summary | author_slug、period_id、post_count（期間内に公開）、pageviews（Σ、伏せる前の値から）、long_post_count、long_pageviews（freshness = long の本数と期間内 PV。M-25。「著者 × 鮮度区分」の派生値、行 13。L-3） | 除外 | 行 11・13。FR-31 (a)(c) |
| pub_author_period_breakdown | author_period_breakdown | author_slug、period_id、axis、bucket、sessions | 除外 | 行 12。FR-33 |
| pub_author_category_period | wp_post + wp_post_category + article_period | author_slug、category_id、period_id、post_count、pageviews | 除外 | 行 13。FR-33 のカテゴリ構成 |
| pub_author_summary | author_summary | author_slug、own_median_30d、eligible_count、band_30d | 除外 | M-24。FR-31 (b)(e)、FR-23 (5) |
| pub_category_period | wp_category + wp_post + wp_post_category + article_period + article_summary | category_id、period_id、pageviews、post_count_total（カテゴリに属する記事数）、post_count_published（期間内に公開）、median_30d_pv（期間内に公開し 30 日経過した記事の pv_30d の中央値、`percentile_cont(0.5)`）、published_post_count_30d（その母数） | 除外後（親カテゴリ行・子カテゴリ行とも。FR-40、FR-41、ADR 0003 判断 4。H-1 で親も除外後に変更） | 行 11。FR-40、FR-41、FR-52 |
| pub_tag_period | wp_tag + wp_post_tag + article_period | tag_id、period_id、pageviews、post_count | 除外後（FR-42） | 行 11。FR-42 |
| pub_posting_monthly | wp_post | month（date、月初）、post_count（除外込み） | なし（全体。WordPress で公開済みの件数） | M-30。FR-50 |
| pub_posting_period | wp_post + period | period_id、post_count（除外込みの全体）。author_count は置かない（全体の著者数と `pub_author` の件数の差で除外著者の人数が分かるため。設計レビュー M-5） | なし（全体） | M-30、M-31。FR-51 の主表示（本数のみ） |
| pub_benchmark_curve | benchmark_curve | scope、n、p25、p50、p75、population_size、population_window | ― | M-19、M-27。FR-17、FR-21、FR-23 |

著者別の公開本数（FR-51 の一覧）は `pub_author_period.post_count` を名前順で使う。親カテゴリの軸の集計で「子に属する記事は親にも属する」として数えるため、`pub_category_period` の親カテゴリ行は親または配下の子に属する記事を distinct で数える（数え方は維持）。ただし親行も子行と同じく除外後の記事集合から数える（H-1。可視記事の所属と期間合計が公開されるため、親を除外込みにすると 親の合計 − 可視記事の和 で除外著者の記事の値が復元できる）。`pub_site_period_freshness` も同じ理由で除外後。除外込みで出すのは GA4 のサイト全体値（`pub_site_daily*`、`pub_site_period*`、`pub_site_month_*`）と公開本数の件数（`pub_posting_*`）だけ。

## 5. 05 §4.1 の表との対応

| 05 §4.1 の行 | 内部表 | 公開ビュー | 伏せ値 | 備考 |
| --- | --- | --- | --- | --- |
| 全体 × 日: 読まれた回数、訪問回数 | site_daily | pub_site_daily | なし | |
| 全体 × 日 × 流入チャネル / デバイス | site_daily_channel、site_daily_device | pub_site_daily_channel、pub_site_daily_device | 適用 + 二次 | 別表。掛け合わせなし |
| 全体 × 期間: 読まれていた時間の合計 | site_period.engagement_seconds | pub_site_period | なし | |
| 全体 × 期間 × SNS / 曜日 × 時間帯 / 初めて・また来た / 読んだ人の数 | site_period_breakdown（sns、new_returning）、site_period_heatmap、site_period.active_users | pub_site_period_breakdown、pub_site_period_heatmap、pub_site_period | 適用（sns、new_returning、曜日 × 時間帯は二次も。L-1） | |
| 全体 × 期間 × 流入チャネル（sessions）/ デバイス（screenPageViews、sessions）（Q-36、2026-11-03 確定） | site_period_breakdown（channel、device_pv、device_sessions） | pub_site_period_breakdown | 適用 + 二次 | 行 2 の期間値。日別表の合算ではなく GA4 から期間ごとに取る（03 §5.4 G19・G20）。05 §4.1 への行の追加は requirements-analyst が反映 |
| 全体 × 確定した暦月 × 参照元ドメイン / 市別 | site_month_referrer、site_month_city | pub_site_month_referrer、pub_site_month_city | T 未満の行を格納しない | is_confirmed の月だけ |
| 全体 × 期間: 地元の読者の目安 | site_period_breakdown（local） | pub_site_period_breakdown | 適用 + 二次 | |
| 記事 × 日: 読まれた回数 | article_daily | pub_article_daily、pub_article_cumulative | なし | ADR 0003 判断 1 |
| 記事 × 期間: 訪問回数、scroll、読まれていた時間 | article_period | pub_article_period | 適用 | pageviews は伏せない |
| 記事 × 期間 × 内訳軸 1 つ | article_period_breakdown | pub_article_period_breakdown | 適用 + 二次 | |
| 記事 × 公開後 30 日時点 × 参照元ドメイン上位 3 | article_referrer_30d | pub_article_referrer_30d | T 未満の行を格納しない | 1 回だけ計算 |
| 著者 / カテゴリ / タグ × 期間 の合計、全体の鮮度 3 区分（M-25） | （ビューで計算） | pub_author_period、pub_category_period、pub_tag_period、pub_site_period_freshness | なし | すべて除外後（著者、親・子カテゴリ、タグ、鮮度区分。H-1） |
| 著者 × 期間 × 内訳軸 1 つ | author_period_breakdown | pub_author_period_breakdown | 適用 + 二次 + 階層差分（M-2） | |
| 著者 × カテゴリ、著者 × 鮮度区分（派生値、除外後） | （ビューで計算） | pub_author_category_period、pub_author_period（long_post_count、long_pageviews） | なし | 行 13（L-3） |
| シェア数（全体 × 期間、著者 × 期間。M-41） | 表なし | ビューなし | ― | 初回対象外（M-4）。05 §4.1 に行がない。FR-61 を実装するときは NFR-39 で行を追加してから |
| 格納しないもの | 表なし | ビューなし | ― | 記事 × 地域、記事 × 曜日 × 時間帯、カテゴリ × 曜日 × 時間帯（D-12）、内訳軸 2 つ以上、記事 × 日 × 内訳軸、著者 × デバイス、カテゴリ / タグ × 内訳軸、移動窓の参照元ドメイン・市別、個別の訪問・ユーザー・イベント |

## 6. 権限（RLS、grant）

マイグレーション 0001 で次を行い、以後の表も同じ規則で作る（設計レビュー M-7、L-4）。

```sql
-- 内部表のスキーマ。anon / authenticated / PUBLIC には usage を与えない（PostgREST の Exposed schemas にも含めない）
create schema internal;
revoke all on schema internal from public;
revoke all on schema internal from anon, authenticated;

-- 以後 internal / public に作る表・シーケンス・関数に anon / authenticated / PUBLIC への既定の grant が付かないようにする
alter default privileges for role postgres in schema internal revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema internal revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema internal revoke all on functions from anon, authenticated;
alter default privileges for role postgres in schema internal revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
-- 関数の EXECUTE は Postgres 既定で PUBLIC に付き、PostgREST が rpc として公開するため、PUBLIC からも外す（L-4）
alter default privileges for role postgres in schema public revoke execute on functions from public;
```

各表（`internal` スキーマ）の作成直後に

```sql
alter table internal.<表> enable row level security;
revoke all on internal.<表> from anon, authenticated;
```

ポリシーは作らない（service role は RLS を通過する。anon は `internal` への usage もポリシーも grant もないので何も読めない）。各公開ビュー（`public` スキーマ）の作成直後に

```sql
grant select on public.pub_<名前> to anon;
```

- `authenticated` ロールは使わない（ログインなし）。grant も与えない。
- service role キーは GitHub Actions の Secrets だけに置く（06 §2.3）。Vercel には anon キーだけを置き、ビルド時に `pub_*` を読む。
- Supabase の API 設定「Exposed schemas」は `public` のみ（`internal` を含めない）。この設定はダッシュボードで行うため、初期設定手順（docs/operations/）に書き、受入（07 §8）で確認する。
- マイグレーションの最後に次を検査する SQL を置き、CI（07 §4 I-DB-01、I-DB-15、I-DB-16）でも同じ検査を行う。
  1. `information_schema.role_table_grants` で anon / authenticated / PUBLIC に grant があるのは `public.pub_%` の `SELECT` だけ。関数（`information_schema.routine_privileges`）・シーケンスへの grant がない。
  2. anon / authenticated / PUBLIC が `public` 以外のスキーマ（`internal` を含む）に usage を持たない（`has_schema_privilege`）。
  3. `pub_*` の列名に `_mask` を含むものがなく、`excluded_author` に由来する列（`excluded_at` など）を含まない。
  4. `pub_*` の列集合（ビュー名、列名、型）が §5 の対応表から作ったスナップショット（`tests/snapshots/pub-columns.json`）と一致する。差分があればスナップショットの更新と NFR-39 の手順を要求する。

## 7. 容量の見積もり

| 表 | 行数の見込み | 根拠 |
| --- | --- | --- |
| article_daily | 約 110,000 行 / 年 | 記事 300 本 × 365 日（PV のある日だけ行を作るので実際は少ない）。1 行 50 バイト程度 + インデックス → 年 10 MB 程度 |
| site_daily、site_daily_channel、site_daily_device | 365 + 1,825 + 1,095 行 / 年 | 無視できる |
| article_period | 記事 300 × 期間（移動窓 6 + 月 14〜26）≈ 10,000 行 | 月が 1 つ増えるごとに +300 |
| article_period_breakdown | 記事 300 × 期間 20〜30 × バケット 13 ≈ 120,000 行 | 10 MB 程度 |
| author_period_breakdown | 著者 21 × 期間 30 × バケット 10 ≈ 6,000 行 | |
| site_period_heatmap | 期間 30 × 168 ≈ 5,000 行 | |
| site_month_referrer、site_month_city | 月 × 10 | |
| article_referrer_30d | 記事 × ≤ 3 | |
| benchmark_curve、article_summary、author_summary、article_milestone | 数千行 | 毎日全置換 |
| batch_run | 365 行 / 年 | |

合計は数年で 100 MB 未満。Supabase Free の 500 MB に収まる（NFR-60）。GA4 の再計算コストは 03 §11。

## 8. マイグレーションの運用

- `supabase/migrations/NNNN_<内容>.sql` に置き、Supabase CLI（`supabase db push`）で適用する。適用は運用担当がローカルから行い、手順は docs/operations/（デプロイ工程）に書く。ダッシュボードでの手変更はしない（NFR-73）。
- マイグレーション 0001: `internal` スキーマの作成と usage の取り消し、既定権限の取り消し（§6）、拡張（不要）、`period`、WordPress 次元表。0002: GA4 日別・期間別表。0003: 確定月・30 日時点・派生表。0004: 運用表（`batch_run`、`excluded_author`、`sns_source_unmapped`）。0005: 公開ビューと grant、権限の検査 SQL。番号は実装時に確定。
- ビューの列を変えるときは ADR と security-auditor のレビュー（NFR-39）。05 §4.1 の表を変えずに済む変更（列名の修正など）はレビュー不要だが、§5 の対応表を更新する。

## 9. 未確定

- `wp_post.title` の HTML エンティティ復号と長さ上限（表示側で省略するので DB には全文を置く）は実装で確認。
- 全記事の分布（M-19、M-27 の母集団 `benchmark_curve`）に除外著者の記事を含めるかは要件に規定がない。設計の既定は「含める」（中央値・四分位は合算ではなく、差分で個別の値を復元する経路がない。母集団を減らすと「まだ比較できません」が増える）。ADR 0003 の再レビューで security-auditor に確認する（D-14）。
- Supabase の「Exposed schemas」の設定値はダッシュボード側にあるためマイグレーションで固定できない。初期設定手順で `public` のみとし、受入で確認する（§6）。

確定した事項（2026-11-03、設計レビューの反映で「未確定」から移動）:

- D-16: 0 は伏せない。二次伏せの候補は T 以上の最小セル（§2.3、設計レビュー M-1）。設定値 `MASK_ZERO` は置かない。
- Q-33: 二次伏せを公開しない。表示は「—」と「伏せ値」の添え書き（§2.3、ADR 0003 判断 5）。
- Q-36: 全体 × 期間 × 流入チャネル / デバイス は `site_period_breakdown` の axis `channel` / `device_pv` / `device_sessions` として期間ごとに格納する（§3.3、ADR 0003 判断 6）。
- M-41（シェア数）: 初回対象外。表・列・問い合わせを作らない（§1、設計レビュー M-4）。
