# 02 データモデル（Supabase）

- 状態: 確定（2026-11-04。依頼者の確認済み。実装時の確認項目は ADR 0009 にある）
- 更新日: 2026-11-05
- 参照: 05_non_functional.md §4.1（格納と公開の組み合わせ）、NFR-30〜NFR-45、NFR-50〜NFR-52、FR-36（初回対象外）、FR-73、FR-76、ADR 0003、ADR 0005（保留）、ADR 0007、ADR 0009
- 変更履歴:
  - 2026-11-03: 設計レビュー（audits/2026-11-03-design-review.md）の H-1・M-1〜M-8・L-1〜L-10 と Q-36 を反映
  - 2026-11-03: analytics-advisor の画面レビュー（advice/2026-11-03-screens-review.md）と security-auditor の再確認（audits/2026-11-03-design-review-recheck.md）の残りを反映（N-1: 全記事の分布の母集団を除外後にし、`benchmark_curve` と帯の列をビューで計算する（§3.5、§4.1、§5、§9）。N-3: service_role への `internal` スキーマの grant（§6））
  - 2026-11-03: 書き込みを専用ロール `batch_writer` に変更（ADR 0009）。§6 の service_role への grant を取り消し、表ごとの grant とポリシーに置き換え（§1、§6、§8、§9）。バッチの言語を Python に変更（ADR 0004）
  - 2026-11-03: 書き込み経路の監査（以下「経路監査」。docs/security/audits/2026-11-03-write-path-review.md）の W-4、W-8、L-1〜L-3、L-7 を反映（§6 のロールの作成を `nologin` に、接続の上限と既定のタイムアウト、`batch_run` の delete を外す、権限の検査の拡張。§8 のテスト用パスワードを seed から除く。§9）
  - 2026-11-04: 著者の除外（FR-36）を初回対象外に（依頼者の決定、ADR 0005 保留）。`excluded_author`、ビューの `not exists` と §4 の除外の列、除外後と除外込みの区別を外した。分布と帯のビューでの計算は保ち、理由を直した。伏せ値、二次伏せ、階層差分、`internal`、`batch_writer` は変えない
  - 2026-11-05: 構築 1 の実機確認を反映（依頼者の決定）。§6: `pub_*` と public の既定権限から service_role を外した（自動更新可能なビューを通じて内部表へ書けたため）。末尾の検査の範囲を Supabase 管理スキーマを除く形に直した。§3.6: `failed_step` に `preflight` と `period` を足した。§4: ビューの解釈（`post_count` の定義、広告記事の扱い）を定義として書いた。§9: 広告記事とカテゴリの軸の食い違いを未確定に足した

## 1. 方針

- 05 §4.1 の表を「そのまま実装」する。表にない組み合わせの表・列・ビューは作らない（NFR-33）。
- 表は 2 種類に分け、スキーマも分ける（設計レビュー M-7）。
  - 内部表（§3）: スキーマ `internal`。日次バッチ（GitHub Actions、専用ロール `batch_writer`。psycopg で pooler に接続。ADR 0009）だけが読み書きする。anon / authenticated / PUBLIC には `internal` スキーマへの usage を与えず、Supabase の API 設定「Exposed schemas」にも含めない（PostgREST から見えない）。加えて全表で RLS 有効、grant なし。
  - 公開ビュー（§4、名前は `pub_` で始まる）: スキーマ `public`。anon ロールが select できる唯一の対象。BI（Vercel のビルド）はこのビューだけを読む。ビューは所有者（postgres）権限で `internal` の表を読む。伏せ値を適用済みの値だけを置き、生の内訳セルは置かない。
- 合計・累積は伏せる前の値から計算する。内部表のうち「記事 × 日」「全体 × 日」「読まれていた時間の合計」など 05 §4.1 で「伏せ値なし」とされたものは生値で持ち、それ以外の内訳セルは伏せ処理後の値だけを持つ（内部表にも生の内訳セルは残さない。バッチのメモリ上でだけ生値を扱う）。
- 集計の実行場所は ADR 0007 のとおり。GA4 から期間ごとに取得する集計値と、伏せ値・二次伏せ・判定（M-22、M-23、M-24）はバッチ（Python）が計算して表に書く。記事の期間合計から導ける著者・カテゴリ（親・子）・タグ・鮮度区分の合計と公開本数、分布（M-19）と帯は、公開ビュー（SQL）が計算する。
- 著者の除外（FR-36）は初回対象外（2026-11-04、依頼者の決定）。除外の表と公開ビューの除外条件を作らない。追加する場合は NFR-39 の手順に従い、ADR 0005（保留）を検討の出発点にする。
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
| sessions | integer | null = 伏せ。著者の記事の生値（伏せる前）を合算してから T と二次伏せを適用 |
| sessions_mask | text | null / `threshold` / `secondary`。階層差分の対策（設計レビュー M-2、03 §6.1 手順 5）: 同じ period_id・axis・bucket で、その著者の記事セル（`article_period_breakdown`）のうち伏せたものがちょうど 1 本のときは、著者セルの値が T 以上でも `secondary` で伏せる（著者の値 − 伏せていない記事の表示値の和 = 伏せた記事の値 になるため）。0 本または 2 本以上なら伏せない |

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

`benchmark_curve`（M-19、M-27）は**内部表ではなく `internal` スキーマのビュー**にする（2026-11-03、再確認 N-1。§4.1 に定義）。バッチは分布を計算しない。理由: 著者の除外は初回対象外だが（2026-11-04、ADR 0005 保留）、追加するときに母集団の条件を DB 側の 1 か所に足すだけで済み、バッチに除外リストを読ませずに済む（ADR 0003 判断 4 追記）。帯（`band_7d`、`band_30d`、著者の `band_30d`）も同じ曲線から公開ビューが計算し、曲線と帯の計算場所を揃える。

`article_summary`（M-20〜M-24 の記事ごとの判定。基準日ごとに全置換。帯の列は持たない）

| 列 | 型 | 制約・意味 |
| --- | --- | --- |
| post_id | integer | PK、FK → wp_post on delete cascade |
| base_date | date | not null |
| age_days | integer | not null。基準日 − published_on + 1（公開日を 1 日目） |
| freshness | text | not null。`new`（1〜30 日）/ `mid`（31〜90 日）/ `long`（91 日以上）（M-21） |
| pv_7d | integer | null。公開後 7 日間の累積（age_days ≥ 7 のときだけ）（M-20） |
| pv_30d | integer | null。公開後 30 日間の累積（age_days ≥ 30 のときだけ） |
| pv_total | integer | not null。公開以降の累積 |
| （band_7d、band_30d） | ― | 内部表には置かない。公開ビュー `pub_article_summary` が `internal.benchmark_curve`（ビュー）から計算する（§4.1。N-1） |
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
| （band_30d） | ― | 内部表には置かない。公開ビュー `pub_author_summary` が own_median_30d と `internal.benchmark_curve`(all, 30) を比べて計算する（§4.1。FR-31 (b)） |

### 3.6 運用表（実行記録、未対応参照元）

`batch_run`（FR-76）

| 列 | 型 | 制約・意味 |
| --- | --- | --- |
| run_id | bigint | PK、generated always as identity |
| started_at | timestamptz | not null |
| finished_at | timestamptz | null |
| base_date | date | not null |
| mode | text | not null。`daily` / `backfill` / `manual` |
| status | text | not null。`running` / `success` / `failed` |
| failed_step | text | null。失敗した工程名（`preflight` / `wp_fetch` / `period` / `ga4_daily` / `ga4_period` / `derive` / `write` / `publish`。03 §1 の工程名と同じ） |
| error_kind | text | null。エラーの種別だけ（`quota` / `auth` / `network` / `validation` / `db` / `unknown`）。メッセージ本文は入れない（NFR-44） |
| mask_threshold | smallint | not null。実行時の T |
| counts | jsonb | not null default '{}'。件数と所要時間だけ。キーは固定（ga4_requests、ga4_tokens、ga4_tokens_remaining_day、ga4_tokens_remaining_hour、wp_requests、posts_upserted、posts_deleted、rows_written、duration_ms）で値はすべて数値。バッチ側は固定キー・数値のみの pydantic モデル（`extra="forbid"`、`strict=True`）で書き、DB にも `check` 制約（immutable 関数 `internal.counts_is_numeric(jsonb)`: すべての値が `jsonb_typeof = 'number'` で、キーが上の一覧に含まれる）を置く（設計レビュー L-6）。API の応答や行データは入れない |
| github_run_id | text | null。Actions の run ID（ログを辿るため。秘密ではない） |

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
- `_mask` 列は出さない（§2.3）。

| ビュー | 元の表 | 列 | 対応する 05 §4.1 の行 / 用途 |
| --- | --- | --- | --- |
| pub_meta | batch_run | base_date、finished_at（最後の success）、mask_threshold、is_stale（基準日が前日より古い）、last_status | FR-02、NFR-90 |
| pub_batch_run | batch_run | run_id、started_at、finished_at、base_date、mode、status、failed_step、error_kind（直近 30 件） | FR-02、FR-76 |
| pub_period | period | period_id、kind、start_date、end_date、is_confirmed | FR-01 |
| pub_author | wp_author | author_slug、display_name、author_url | FR-30、NFR-35 |
| pub_post | wp_post + wp_author + article_summary | post_id、title、post_url、author_slug、display_name、published_on、is_ad、age_days、freshness | FR-20〜FR-25、FR-32 |
| pub_category | wp_category | category_id、name、parent_id、path | FR-40 |
| pub_tag | wp_tag | tag_id、name | FR-42 |
| pub_post_category | wp_post_category | post_id、category_id | 記事の属性 |
| pub_post_tag | wp_post_tag | post_id、tag_id | 記事の属性 |
| pub_site_daily | site_daily | day、pageviews、sessions | 行 1。FR-11 |
| pub_site_daily_channel | site_daily_channel | day、channel、sessions | 行 2。FR-11 の内訳 |
| pub_site_daily_device | site_daily_device | day、device、pageviews、sessions | 行 2。FR-14 |
| pub_site_period | period + site_daily + site_period | period_id、pageviews（Σ site_daily）、sessions（Σ）、active_users、engagement_seconds、days（期間の日数）。share_count は置かない（M-4、初回対象外） | 行 3・4。FR-10 |
| pub_site_period_breakdown | site_period_breakdown | period_id、axis、bucket、value | 行 4・6、Q-36。FR-13（SNS、channel）、FR-14（device_pv、device_sessions）、FR-15（地元）、FR-16 |
| pub_site_period_heatmap | site_period_heatmap | period_id、dow、hour、pageviews | 行 4。FR-12。二次伏せ適用済み（L-1） |
| pub_site_period_freshness | article_period + wp_post + article_summary | period_id、freshness、post_count、pageviews | 行 11（M-25 の全体の鮮度 3 区分、派生値）。FR-10 折りたたみ。主カードの `pub_site_period.pageviews`（GA4 のサイト全体値。記事以外のページを含む）とは一致しないことを画面で注記する（FR-10） |
| pub_site_month_referrer | site_month_referrer | period_id、rank、source_domain、sessions | 行 5。FR-13 |
| pub_site_month_city | site_month_city | period_id、rank、region、city、sessions | 行 5。FR-15 |
| pub_article_daily | article_daily | post_id、day、pageviews | 行 7。FR-23 (2) |
| pub_article_cumulative | article_daily + wp_post | post_id、n（1〜90）、cumulative_pv（窓関数で累積） | M-18。FR-23 (3) |
| pub_article_period | article_period | post_id、period_id、pageviews、landing_sessions、scroll_count、engagement_seconds | 行 8。FR-20〜FR-24、FR-32 |
| pub_article_period_breakdown | article_period_breakdown | post_id、period_id、axis、bucket、sessions | 行 9。FR-23 (6)(7)、FR-32 の主な経路 |
| pub_article_referrer_30d | article_referrer_30d | post_id、rank、source_domain、sessions | 行 10。FR-23 (6) |
| pub_article_summary | article_summary + article_daily（N 日目の累積）+ benchmark_curve（ビュー、§4.1） | post_id、age_days、freshness、pv_7d、pv_30d、pv_total、band_7d、band_30d（**ビューで計算**。公開記事の曲線との比較。N-1）、is_recent_hot、is_revival、is_evergreen_365、referrer_30d_computed_on | M-20〜M-23。FR-21、FR-23、FR-25、FR-34。列集合は変わらない |
| pub_article_milestone | article_milestone | post_id、milestone、reached_on | M-23。FR-23 (4)、FR-31 (d) |
| pub_author_period | wp_post + article_period + article_summary | author_slug、period_id、post_count（期間内に公開）、pageviews（Σ、伏せる前の値から）、long_post_count、long_pageviews（freshness = long の本数と期間内 PV。M-25。「著者 × 鮮度区分」の派生値、行 13。L-3） | 行 11・13。FR-31 (a)(c) |
| pub_author_period_breakdown | author_period_breakdown | author_slug、period_id、axis、bucket、sessions | 行 12。FR-33 |
| pub_author_category_period | wp_post + wp_post_category + article_period | author_slug、category_id、period_id、post_count、pageviews | 行 13。FR-33 のカテゴリ構成 |
| pub_author_summary | author_summary + benchmark_curve（ビュー、§4.1） | author_slug、own_median_30d、eligible_count、band_30d（**ビューで計算**。own_median_30d と曲線 (all, 30) の比較。N-1） | M-24。FR-31 (b)（(e) を統合）、FR-23 (5)。列集合は変わらない |
| pub_category_period | wp_category + wp_post + wp_post_category + article_period + article_summary | category_id、period_id、pageviews、post_count_total（カテゴリに属する記事数）、post_count_published（期間内に公開）、median_30d_pv（期間内に公開し 30 日経過した記事の pv_30d の中央値、`percentile_cont(0.5)`）、published_post_count_30d（その母数） | 行 11。FR-40、FR-41、FR-52 |
| pub_tag_period | wp_tag + wp_post_tag + article_period | tag_id、period_id、pageviews、post_count | 行 11。FR-42 |
| pub_posting_monthly | wp_post | month（date、月初）、post_count | M-30。FR-50 |
| pub_posting_period | wp_post + period | period_id、post_count。author_count は置かない（FR-51 の主表示は本数のみ。除外を追加したときに、全体の著者数と `pub_author` の件数の差で除外著者の人数が分かる経路を先に作らないため。設計レビュー M-5） | M-30、M-31。FR-51 の主表示（本数のみ） |
| pub_benchmark_curve | benchmark_curve（`internal` のビュー。article_daily + wp_post + wp_post_category + wp_category + article_summary から計算。§4.1） | scope、n、p25、p50、p75、population_size、population_window | M-19、M-27。FR-17、FR-21、FR-23。列集合は変わらない |

著者別の公開本数（FR-51 の一覧）は `pub_author_period.post_count` を名前順で使う（BI は `post_count ≥ 1` の著者だけを載せる。05 §8）。親カテゴリの軸の集計で「子に属する記事は親にも属する」として数えるため、`pub_category_period` の親カテゴリ行は親または配下の子に属する記事を distinct で数える。

列の定義（2026-11-05、実装に合わせて確定）:

- `pub_author_category_period.post_count` と `pub_tag_period.post_count`: その著者とカテゴリ、またはそのタグに属する記事の数。期間内に公開した数ではない（期間ごとに同じ値になる）。
- `pub_author_period.long_post_count`: その著者の `freshness = long` の記事の数。基準日時点の区分で数え、期間によらない。`long_pageviews` は、それらの記事の期間内の読まれた回数の合計。
- `pub_author_category_period` のカテゴリは、記事に直接付いたカテゴリだけを数える。親への繰り上げはしない（`pub_category_period` の親カテゴリ行とは数え方が違う）。
- 広告記事（`is_ad = true`）: 分布（`internal.benchmark_curve`、§4.1）の母集団からだけ除く。著者、カテゴリ、タグ、鮮度区分の合計と本数、公開本数には含める。一覧からの除外（FR-20、FR-22、FR-25）は BI が `is_ad` で行う。カテゴリの軸との関係は §9 の未確定を参照。

### 4.1 分布と帯の計算（`internal.benchmark_curve` ビュー。N-1）

全記事の分布（M-19、M-27）の母集団は公開記事（広告を除く）で、バッチではなく DB 側で計算する。著者の除外は初回対象外だが（2026-11-04、ADR 0005 保留）、計算の場所はビューのままにする。追加するときに母集団の条件を DB 側の 1 か所に足すだけで済み、バッチに除外リストを読ませずに済むため（経緯と代替案は ADR 0003 判断 4 追記）。定義は 03 §6.2 と同じ。公開ビューの列集合（§4 の表、I-DB-16 のスナップショット）は変わらない。

- `internal.benchmark_curve`（`internal` スキーマのビュー。anon からは見えない）: 公開記事の n 日目累積（`pub_article_cumulative` と同じ窓関数の定義を共通の内部ビュー `internal.article_cumulative` に置き、両方から参照する）に対して、`scope` と `n` ごとに `percentile_cont(array[0.25, 0.5, 0.75]) within group (order by cumulative_pv)` を取る。母集団の条件: `wp_post.is_ad = false`、`article_summary.age_days ≥ n`、`published_on ≥ base_date − 365`（`population_window = '12m'`）。12 か月の母集団が 30 本未満の (scope, n) は全期間（`population_window = 'all'`）で計算し、それでも 30 本未満なら行を出さない。`scope = 'all'` と、`wp_post_category` × `wp_category`（`parent_id is not null`）から作る `scope = 'cat:' || category_id`（母集団 30 本以上の子カテゴリだけ）。`population_size` は母集団の件数（07 I-DB-05）。`base_date` は `article_summary.base_date`（`pub_meta` と同じ基準日）。
- `pub_benchmark_curve` = `select scope, n, p25, p50, p75, population_size, population_window from internal.benchmark_curve`。
- `pub_article_summary` の `band_7d` / `band_30d`: `article_summary` に `internal.article_cumulative`（n = 7 と n = least(age_days, 30) の累積）と `internal.benchmark_curve`（scope = all、同じ n）を left join し、`case when 値 > p75 then 'upper' when 値 < p25 then 'lower' else 'middle' end`。`age_days < 3`、曲線の行がない、累積が null のときは null。`band_7d` は `age_days ≥ 7` のときだけ（pv_7d と曲線 (all, 7) の比較）。
- `pub_author_summary` の `band_30d`: `author_summary.own_median_30d` と `internal.benchmark_curve`（all, 30）の同じ `case`。own_median_30d が null、曲線の行がないときは null。
- 関数は作らない（`case` 式をビュー内に書く。06 §2.3、L-4 の方針）。
- 性能: 記事 225 本 × n 90 ≒ 2 万行の累積に対する分位計算 + 子カテゴリ分で、ビルド時に各ビューを 1 回読むだけ。実装時に `explain analyze` で確認する（07 I-DB-17。ローカルの 1,000 本のフィクスチャで 2 秒以内を目安）。重ければ ADR 0003 判断 4 追記の (c)（`internal` のマテリアライズドビューをバッチが refresh）に切り替えるが、母集団の定義は変えない。

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
| 著者 / カテゴリ / タグ × 期間 の合計、全体の鮮度 3 区分（M-25） | （ビューで計算） | pub_author_period、pub_category_period、pub_tag_period、pub_site_period_freshness | なし | |
| 著者 × 期間 × 内訳軸 1 つ | author_period_breakdown | pub_author_period_breakdown | 適用 + 二次 + 階層差分（M-2） | |
| 著者 × カテゴリ、著者 × 鮮度区分（派生値） | （ビューで計算） | pub_author_category_period、pub_author_period（long_post_count、long_pageviews） | なし | 行 13（L-3） |
| 全記事の分布（M-19、M-27）と帯（M-20、FR-31 (b)） | （ビューで計算。§4.1） | pub_benchmark_curve、pub_article_summary（band_7d、band_30d）、pub_author_summary（band_30d） | なし | 母集団は公開記事（広告を除く）。中央値・四分位は公開値だけから再現できる値 |
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
-- service_role も外す。Supabase の既定では postgres が public に作るものに service_role の全権限が付く。
-- 単純なビューは自動更新可能で所有者権限で動くので、残すと pub_* を通じて内部表へ書き込める（2026-11-05 にローカルで確認）
alter default privileges for role postgres in schema public revoke all on tables from service_role;
alter default privileges for role postgres in schema public revoke all on sequences from service_role;
alter default privileges for role postgres in schema public revoke all on functions from service_role;
```

各表（`internal` スキーマ）の作成直後に

```sql
alter table internal.<表> enable row level security;
revoke all on internal.<表> from anon, authenticated;
```

バッチが使うロールは `batch_writer`（ADR 0009）。`service_role` には `internal` の権限を与えない（2026-11-03。前回の再確認 N-3 の grant を取り消す。バッチが PostgREST を使わなくなり、service role キーを使う場所がなくなったため）。

マイグレーション 0001 の上の `revoke` に続けて次を置く。パスワードはマイグレーションに書かない。有効にするときは docs/operations/ の手順で `alter role batch_writer login password '...'` を実行する（保存済みスニペットに残さない。経路監査 L-1）。実行するまでは `nologin` なので接続できない。

```sql
-- ロールはクラスタ全体のオブジェクトなので、再適用に備えて存在を確認する
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'batch_writer') then
    create role batch_writer nologin noinherit nobypassrls;
  end if;
end
$$;

-- if not exists は既存のロールの属性を直さないので揃える（W-8）。
-- super、createdb、createrole、replication、bypassrls は変更に強い権限が要る可能性があるので alter せず、末尾の検査で確かめる
alter role batch_writer nologin noinherit;
-- 既定のタイムアウトと接続の上限（経路監査 L-3、ADR 0009）
alter role batch_writer connection limit 2;
alter role batch_writer set statement_timeout = '120s';

grant usage on schema internal to batch_writer;

-- service_role には internal の権限を与えない
revoke all on schema internal from service_role;
alter default privileges for role postgres in schema internal revoke all on tables from service_role;
alter default privileges for role postgres in schema internal revoke all on sequences from service_role;
alter default privileges for role postgres in schema internal revoke all on functions from service_role;
```

`batch_writer` の権限は表の名前を列挙して与える。`grant ... on all tables in schema internal` と `alter default privileges ... to batch_writer` は使わない（バッチに要らない `internal.article_cumulative`、`internal.benchmark_curve` のビューや、後から足す表まで届いてしまう）。§3.1〜§3.5 と `sns_source_unmapped` の各表の作成直後に、上の `enable row level security` と `revoke` に続けて次を置く。

```sql
grant select, insert, update, delete on internal.<表> to batch_writer;
create policy batch_writer_all on internal.<表> for all to batch_writer using (true) with check (true);
```

`batch_run` は delete を外す（経路監査 L-2。保持期間の削除がなく、バッチが痕跡を消せないようにする）。

```sql
grant select, insert, update on internal.batch_run to batch_writer;
create policy batch_writer_all on internal.batch_run for all to batch_writer using (true) with check (true);
```

シーケンスの grant は最初は置かない。`generated always as identity` のシーケンスは grant なしで動く可能性がある（経路監査 L-2。要確認 ADR 0009 V-4）ので、I-DB-18 (4) の insert が失敗したときだけ `grant usage on sequence internal.<シーケンス> to batch_writer;` を足す。`batch_run.counts` の check 制約が使う関数は、実行時に書き込むロールの EXECUTE 権限が要るので `grant execute on function internal.counts_is_numeric(jsonb) to batch_writer;` を足す（§3.6。上の `revoke execute ... from public` で閉じているため。07 I-DB-18 の insert で確かめる）。これ以外の関数は `internal` に置かない（§4.1 のビューも `case` 式で書く）。

RLS の扱い（ADR 0009 判断 4）:

- 内部表の RLS は有効のまま。`batch_writer` は `bypassrls` を持たないので、ポリシーがないと読み書きできない。そこで許可する表ごとに `batch_writer_all` を作る。
- 公開ビューは所有者（postgres）の権限で内部表を読む。表の所有者は RLS を通過する（`force row level security` は使わない）。cascade の削除も表の所有者の権限で動く。
- anon は `internal` への usage もポリシーも grant もないので何も読めない。
- `batch_writer` には `public` の表・ビューへの grant を与えない。`public` スキーマの usage が PUBLIC 経由で残っていても、`pub_*` の select は anon にだけ与えるので読めない。

Supabase の既定権限（新しいスキーマや `postgres` 以外の所有者で作られるオブジェクトの扱い）の正確な内容は外部の事実として未確認。実装時に `supabase start` のローカル環境で `information_schema.role_table_grants` と `has_schema_privilege` を確認し、07 I-DB-01、I-DB-18 で検査する。足りないときに広い grant（`to public`、`to anon`、`all tables in schema`）で直さない。

各公開ビュー（`public` スキーマ）の作成直後に

```sql
grant select on public.pub_<名前> to anon;
```

すべての公開ビューを作った後で、既定権限に頼らず次を置く（ビューの名前を列挙する）。`pub_*` に残る権限は、所有者（postgres）と anon の select だけになる。

```sql
revoke all on public.pub_<名前>, ... from public, authenticated, service_role;
```

- `authenticated` ロールは使わない（ログインなし）。grant も与えない。
- `service_role` にも `pub_*` の権限を与えない。BI は anon で読み、バッチは `batch_writer` で内部表に書くので、使う場面がない。
- 接続文字列 `SUPABASE_BATCH_DB_URL` は main だけを許可した GitHub Environment の Secret だけに置く（06 §3、§9）。service role キーはどこにも置かない。Vercel には anon キーだけを置き、ビルド時に `pub_*` を読む。
- Supabase の API 設定「Exposed schemas」は `public` のみ（`internal` を含めない）。この設定はダッシュボードで行うため、初期設定手順（docs/operations/）に書き、受入（07 §8）で確認する。
- マイグレーションの最後に次を検査する SQL を置き、CI（07 §4 I-DB-01、I-DB-15、I-DB-16、I-DB-18）でも同じ検査を行う。
  1. Supabase 管理スキーマ（下記）を除いて、`information_schema.role_table_grants` で anon / authenticated / PUBLIC に grant があるのは `public.pub_%` の anon の `SELECT` だけ。関数（`information_schema.routine_privileges`）・シーケンスへの grant がない。public の表とビューには、所有者と anon の `SELECT` 以外の権限がない（`pg_class.relacl`。service_role を含む）。`postgres` の既定権限（`pg_default_acl`）で public と `internal` に所有者以外の grantee がない。
  2. Supabase 管理スキーマを除いて、anon / authenticated / PUBLIC が `public` 以外のスキーマ（`internal` を含む）に usage を持たない（`has_schema_privilege`、`nspacl`）。
  3. `pub_*` の列名に `_mask` を含むものがない。
  4. `pub_*` の列集合（ビュー名、列名、型）が §5 の対応表から作ったスナップショット（`tests/snapshots/pub-columns.json`）と一致する。差分があればスナップショットの更新と NFR-39 の手順を要求する。
  5. `batch_writer` の権限が許可の範囲に収まる（W-8。下の検査）。

Supabase 管理スキーマ: `pg_catalog`、`information_schema`、`auth`、`extensions`、`graphql`、`graphql_public`、`realtime`、`storage`、`supabase_functions`。これらには基盤が anon / authenticated / PUBLIC に権限を与えており（2026-11-05 にローカルで確認。`storage` の表への select / insert / update / delete を含む）、本プロジェクトは変更しない。検査 1〜2 は `supabase/checks/anon_privileges.sql` にこの除外リストつきで置き、マイグレーション末尾に同じ本文を写す。07 I-DB-15 は anon と authenticated が usage を持つスキーマの集合が「管理スキーマ + `public`」と完全に一致することも確かめ、スキーマが増えたら失敗させる。本番で管理スキーマの一覧が違い、一覧の外に anon などの権限があれば、本番への適用時に末尾の検査で失敗する。これは意図どおりで、そのスキーマを確かめてから一覧を直す。検査を弱めて通さない。

`batch_writer` の権限の検査（W-8）は、違反を 1 行ずつ返す select として `supabase/checks/batch_writer_privileges.sql` に置く。0 行なら合格。同じ select をマイグレーション末尾に `do` ブロックで包んで写し（1 行でもあれば `raise exception`）、07 I-DB-18 でファイルを実行して 2 か所の本文の一致も確かめる。A-11 では本番の SQL エディタで同じファイルの内容を実行する。これで、本番の手変更や既定権限で広がった権限に気づける。検査する内容:

- 表の grant: `information_schema.role_table_grants` が許可リスト（§3.1〜§3.6 の表。`batch_run` は delete なし）に一致する（I-DB-18 (1)）。
- スキーマ: すべてのスキーマについて `has_schema_privilege('batch_writer', <スキーマ>, 'USAGE')` と `'CREATE'` を見る。CREATE はどこにもない。USAGE の許可は `internal` と、PUBLIC 経由であることを `nspacl` で確かめた `public` だけ。`pg_catalog` と `information_schema` は PostgreSQL の既定で PUBLIC が USAGE を持つので USAGE の判定から除く。ほかに PUBLIC 経由の USAGE が見つかったら、ローカルの結果を確かめて可否を決める（Supabase の既定権限は未確認）。`public` の CREATE が PUBLIC に残っていれば `revoke create on schema public from public` をマイグレーションに足す。広げる方向で直さない。
- 関数とシーケンス: `information_schema.routine_privileges` と `role_usage_grants` で、`batch_writer` を grantee にするものが `internal.counts_is_numeric` と必要なシーケンスだけ。
- ロールの所属: `pg_auth_members` で `batch_writer` が member の行が 0 件。
- ロールの属性: `pg_roles` で `rolbypassrls`、`rolsuper`、`rolcreaterole`、`rolcreatedb`、`rolreplication`、`rolinherit` がすべて false、`rolconnlimit` が 2。ログインの可否は検査に含めない（手順の前後で変わるため）。

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
| article_summary、author_summary、article_milestone | 数千行 | 毎日全置換。`benchmark_curve` はビュー（§4.1）で容量を持たない |
| batch_run | 365 行 / 年 | |

合計は数年で 100 MB 未満。Supabase Free の 500 MB に収まる（NFR-60）。GA4 の再計算コストは 03 §11。

## 8. マイグレーションの運用

- `supabase/migrations/NNNN_<内容>.sql` に置き、Supabase CLI（`supabase db push`）で適用する。適用は運用担当がローカルから行い、手順は docs/operations/（デプロイ工程）に書く。ダッシュボードでの手変更はしない（NFR-73）。
- マイグレーション 0001: `internal` スキーマの作成と usage の取り消し、既定権限の取り消し、`batch_writer` ロールの作成と usage の grant（§6、ADR 0009）、拡張（不要）、`period`、WordPress 次元表。0002: GA4 日別・期間別表。0003: 確定月・30 日時点・派生表（`article_summary`、`author_summary`、`article_milestone`。帯の列なし）。0004: 運用表（`batch_run`、`sns_source_unmapped`）。0005: `internal.article_cumulative`・`internal.benchmark_curve` ビュー（§4.1。`batch_writer` に grant しない）、公開ビューと grant、権限の検査 SQL。番号は実装時に確定。ロールのパスワードはどのマイグレーションにも seed にも書かない（W-4）。`supabase db reset` の後に `alter role batch_writer login password ...` を実行する: CI では実行時にランダムな値を生成して使い捨てる。ローカルは `.env` の `LOCAL_BATCH_WRITER_PASSWORD` の値を使う。本番の適用で `supabase/seed/test/` を入れない（`--include-seed` や `sql_paths` を本番に向けない。手順は docs/operations/）。
- ビューの列を変えるときは ADR と security-auditor のレビュー（NFR-39）。05 §4.1 の表を変えずに済む変更（列名の修正など）はレビュー不要だが、§5 の対応表を更新する。

## 9. 未確定

- `wp_post.title` の HTML エンティティ復号と長さ上限（表示側で省略するので DB には全文を置く）は実装で確認。
- Supabase の「Exposed schemas」の設定値はダッシュボード側にあるためマイグレーションで固定できない。初期設定手順で `public` のみとし、受入で確認する（§6）。
- `internal.benchmark_curve` ビュー（§4.1）の計算時間は実装時に `explain analyze` で確認する（07 I-DB-17。目安 2 秒以内）。超えるときは ADR 0003 判断 4 追記の (c) に切り替える。母集団の定義は変えない。
- Supabase の既定権限の正確な内容は未確認（外部の事実）。§6 の grant と revoke をマイグレーションに置き、ローカル環境で確認する（07 I-DB-01、I-DB-18）。
- `batch_writer` のパスワードの設定手順（docs/operations/）。`nologin` で作るので、未設定の間の拒否を pooler の挙動に頼らない（経路監査 L-1）。
- `generated always as identity` のシーケンスの grant の要否、`connection limit` の pooler との相性（ADR 0009 V-4、A-11）。
- 広告記事とカテゴリの軸: FR-40 は「広告カテゴリは別枠で出し、他の軸の合計には含めない」とする。今の `pub_category_period` は記事の `is_ad` で絞らないので、広告カテゴリと他の親カテゴリの両方に属する記事は、他の軸の合計にも入る（2026-11-05 にローカルで確認）。両方に属する記事が実在するかと、直し方は依頼者の判断待ち。

確定した事項（2026-11-03、設計レビューの反映で「未確定」から移動）:

- D-16: 0 は伏せない。二次伏せの候補は T 以上の最小セル（§2.3、設計レビュー M-1）。設定値 `MASK_ZERO` は置かない。
- Q-33: 二次伏せを公開しない。表示は「—」と「伏せ値」の添え書き（§2.3、ADR 0003 判断 5）。
- Q-36: 全体 × 期間 × 流入チャネル / デバイス は `site_period_breakdown` の axis `channel` / `device_pv` / `device_sessions` として期間ごとに格納する（§3.3、ADR 0003 判断 6）。
- M-41（シェア数）: 初回対象外。表・列・問い合わせを作らない（§1、設計レビュー M-4）。
- D-14（全記事の分布の母集団）: 広告を除く公開記事。著者の除外は初回対象外（2026-11-04、ADR 0005 保留）で、除外を追加するときは除外著者の記事を母集団から外す（順位のずれから除外記事の帯や値が分かるため。ADR 0003 判断 4 追記）。計算は公開ビュー側（§4.1）。
