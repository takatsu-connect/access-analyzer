# 07 テスト計画

- 状態: 草案
- 更新日: 2026-11-03
- 関係: docs/requirements/06_acceptance.md（受入基準）、01_tech_stack.md §7・§8、02_data_model.md、03_data_pipeline.md、04_api.md、05_screens.md、06_security.md、ADR 0003、ADR 0005、ADR 0006、ADR 0008
- 読者: qa-engineer（テストの実装と受入の実施）、backend-engineer / frontend-engineer（単体テストの実装）、devops-engineer（CI の検査）
- 変更履歴:
  - 2026-11-03: 設計レビュー（audits/2026-11-03-design-review.md）の H-1・M-1〜M-8・L-1〜L-10 と Q-36 を反映（U-27〜U-29、I-DB-15・I-DB-16、I-B-11 を追加。I-DB-01・05・07、I-B-09、E-04、S-10・S-14、U-22 を修正）
  - 2026-11-03: analytics-advisor の画面レビュー（advice/2026-11-03-screens-review.md）と security-auditor の再確認（audits/2026-11-03-design-review-recheck.md）の残りを反映（I-DB-17、E-22 を追加。U-07・U-08・U-19・U-24、I-DB-01・I-DB-05、E-08・E-12・E-19、§9・§10 を修正）

## 1. 方針

- 公開範囲に関わる検査（anon の grant、除外、`_mask`、応答ヘッダ、`NEXT_PUBLIC_`、順位の数字、伏せ値の表示）は **CI で自動化し、落ちたらマージできない**。人の目視だけに頼らない。
- 対象サイト（takatsu-connect.com）と本番の BI・本番の Supabase には、テストから一切触れない（NFR-72、06 §1）。WP REST API と GA4 Data API はモック（固定 JSON）で代える。
- テストの正解値は手計算できる小さなフィクスチャ（記事 12 本、著者 4 人、日 60 日）から作り、受入の「照合」（本番 GA4 との比較）は受入時に人が行う（§8）。
- 伏せ値・二次伏せ・派生指標の規則は `packages/shared` に集めてあるので、そこを単体テストで厳密に固め、画面側のテストは「表示の規則」に絞る。
- 受入基準（06_acceptance.md）の各 ID に、少なくとも 1 つのテスト（自動）か手順（手動）を対応させる（§9）。

## 2. テストの種類と環境

| 種類 | 対象 | 実行環境 | 道具 | 実行タイミング |
| --- | --- | --- | --- | --- |
| 単体（U） | `packages/shared`、`apps/batch` の純関数、`apps/web` の部品 | Node.js（jsdom は部品のみ） | Vitest、@testing-library/react | PR ごと、ローカル |
| 結合 DB（I-DB） | マイグレーション、公開ビュー、RLS、grant | Supabase ローカル（`supabase start`、Docker） | Vitest + `postgres`（pg）クライアントで SQL を実行。anon / service role の 2 接続 | PR ごと（CI）、ローカル |
| 結合バッチ（I-B） | `apps/batch` の `daily` / `backfill` / `publish_only` を端から端まで | Supabase ローカル + モックサーバー（GA4、WP、Deploy Hook） | Vitest、`msw`（Node）または固定応答の小さな HTTP サーバー | PR ごと（CI） |
| E2E（E） | ビルドした BI の画面・ヘッダ・404・URL パラメータ | CI 内: フィクスチャを入れた Supabase ローカルに対して `next build` → `next start` → Playwright。加えて Vercel の Preview URL に対するスモーク（ヘッダ、noindex、404、主要画面の存在） | Playwright（Chromium、WebKit、Firefox。モバイルは Pixel 5 / iPhone 12 のエミュレーション） | PR ごと（CI）。Preview スモークはデプロイ後 |
| CI の静的検査（S） | ソース、設定、ワークフロー、依存 | GitHub Actions | ESLint の独自ルール、`grep`、`pnpm audit`、gitleaks、actionlint | PR ごと |
| 手動の受入（A） | 06_acceptance.md の「目視」「照合」 | 本番相当（Preview または初回の本番） | 人 | 初回公開前、要件変更時 |

- CI の Supabase ローカルは `supabase/migrations` を適用し、`supabase/seed/test/*.sql` のフィクスチャを入れる。service role は CI 内のローカル値だけで、本番の鍵を CI に置かない（06 §9）。
- Preview（Vercel）のビルドは **本番の Supabase の anon キー**で `pub_*` を読む（公開データなので新しい露出はない）か、ステージング用の Supabase プロジェクトを使うかは devops が決める（§11）。Preview に対する Playwright は、データの値を検証せず、構造・ヘッダ・404 だけを見る。

## 3. 単体テスト（Vitest、packages/shared と apps/batch）

`packages/shared` は行カバレッジ 90% 以上を目標（公開範囲に関わる関数は 100%）。

| ID | 対象（関数） | 検査 | 受入基準 |
| --- | --- | --- | --- |
| U-01 | `normalizePagePath` | 小文字化、末尾スラッシュ補完、`^/(\d+)/$` で記事 ID、`/`・`/category/…`・`/?p=` は「記事以外」 | 02_metrics §3、D-05 |
| U-02 | `normalizeSnsSource` | D-02 の表（完全一致 + 後方一致）。`l.instagram.com` → instagram、`t.co` → x、`threads` → other、`line.me` → line。未対応は `unmapped` を返す | M-11 |
| U-03 | `mapChannel` | GA4 の 9 区分 → 5 区分（AI Assistant、Email、Paid 系 → other） | M-10 |
| U-04 | `applyMask(values, T)` | T = 5 で 1〜4 が null、0 は 0 のまま（D-16 確定: 0 は伏せない）、5 以上はそのまま。`_mask` が `threshold` | FR-73、NFR-33 |
| U-05 | `applySecondaryMask(record)` | 排他的区分で伏せたセルが 1 つだけなら、伏せていないセルのうち値が T 以上で最小のセルも伏せる（0 と T 未満のセルは候補にしない。D-16 確定）。該当がなければ追加しない（例: `{a: 3, b: 0, c: 0}` → a だけ伏せる）。伏せ 0 個・2 個以上では何もしない。同値のときの決定性（固定の区分順で安定）。曜日 × 時間帯の 168 セルにも同じ関数を適用して同じ結果（L-1） | NFR-33（再確認 N-1、設計レビュー M-1、L-1） |
| U-06 | `cumulative(daily, publishedOn)` | 公開日を 1 日目、N = 1〜90。公開前の日は含めない。欠けた日は 0 | M-18、M-20 |
| U-07 | `quantiles(values)`（参照実装） | p25 / p50 / p75（`percentile_cont` と同じ線形補間）。母集団 30 未満で null。12 か月 → 全期間の拡張。分布はバッチでなく公開ビューが計算する（02 §4.1、N-1）ため、この関数はビューの結果と突き合わせる参照実装（I-DB-17）として `packages/shared` に置く | M-19、M-27 |
| U-08 | `band(value, curve)`（参照実装） | upper / middle / lower の境界（p75 と等しいときは middle、p25 と等しいときは middle）。age < 3 で null。N = min(age, 30) の曲線と比べる（05 §4.2）。ビューの `band_30d` / `band_7d` と突き合わせる参照実装（I-DB-17） | M-19、FR-21 |
| U-09 | `freshness(ageDays)` | 30 / 31〜90 / 91 の境界 | M-21 |
| U-10 | `recentHot / revival` | 公開 15 日以上、直近 7 日 ≥ 20、前 4 週の週平均の 2 倍以上。revival は加えて 91 日以上。境界値（19、20、1.99 倍、2.0 倍） | M-22 |
| U-11 | `milestones(daily)` | 500 / 1,000 / 5,000 / 10,000 の初到達日。同日に 2 つ超えたら両方。evergreen365（365 日以上かつ直近 28 日 ≥ 20） | M-23 |
| U-12 | `ownMedian30d(posts)` | 直近 12 か月・30 日経過の記事の pv30 の中央値。5 本未満は null | M-24 |
| U-13 | `period` 計算（JST） | 基準日から last7 / prev7 / … の start / end、月の `is_confirmed`（月末 + 7 ≤ 基準日）、前月・前年同月の ID。ランナーが UTC でも結果が同じ（`TZ=UTC` で実行） | FR-01、NFR-82、02 §2.2 |
| U-14 | `compare(cur, prev)` | 差。比率は分母 ≥ 20 のときだけ（19 で null、20 で値） | FR-01、NFR-96 |
| U-15 | `share(values, total)` | 構成比の分母は合計列。伏せ値セルは比率 null | NFR-96 |
| U-16 | `tenOf(ratio)` | 「10 人中 6 人」。分母 20 未満は null | M-09 |
| U-17 | `fold6(heatmap168)` | 24 時間 → 6 区分、合計と平均。null を含む区分の扱い（null が 1 つでもあれば区分は null） | NFR-99 |
| U-18 | `parseQuery(search, allow)` | 04 §8 の表の全行。正常値、形式違い、許可リスト外、`sort` の条件（絞り込みなし / 親カテゴリのみ / 子カテゴリ / 著者 / 公開年月）、1 つの不正値が他に影響しない、未知パラメータの除去 | FR-03、FR-24、NFR-91、NFR-98 |
| U-19 | `ui-text.ts` の完全性 | すべての指標 ID（M-01〜M-34、M-41）に label と note がある。05 §2.1 の表のキー（`band.*`、`notes.*`、`absent.*`、`lead.*`、`s01.*`〜`s08.*`）がすべて存在する。禁止語（偏り、下位、読まれなかった、少ない、順位、ランキング、あなた）を含まない。「出ません」で終わる文がない（不在の文言は「〜になると出ます」の形。05 §2.3）。GA4 の API 名は括弧の中にだけ現れる | NFR-97、NFR-99 |
| U-20 | `pub-types.ts` と `supabase gen types` の突き合わせ | 公開ビューの列名・型が一致（I-DB で生成した型と比較） | 01 §4 |
| U-21 | `page-data` の zod スキーマ | 各 `*Data` のサンプルが通る。`null` は伏せ値の列にだけ許される | 04 §3 |
| U-22 | バッチの GA4 リクエスト組み立て | 問い合わせ G1〜G17、G19、G20 の `metrics` / `dimensions` に禁止名（newUsers、totalUsers、engagedSessions、engagementRate、averageSessionDuration、bounceRate、pageReferrer、pageLocation、`customEvent:`）がない。eventName フィルタは scroll だけ（AddToAnyShare は初回対象外。M-4）。地域は country / region / city まで。G19 は sessionDefaultChannelGroup × sessions、G20 は deviceCategory × screenPageViews・sessions で dateRanges が期間集合（Q-36） | M-04〜M-08（廃止）、NFR-32、NFR-37、NFR-38、M-10、M-13 |
| U-23 | バッチの WP リクエスト組み立て | `/wp-json/wp/v2/` 配下だけ。`status` を広げるパラメータがない。`comments` / `users` を呼ばない。`_fields` に author のメール・ID を含めない（author は `_embed` の name / slug / link だけ） | NFR-34、NFR-35、FR-72、M-42（廃止） |
| U-24 | `apps/web` 部品（jsdom） | `MaskedCell`: null → 「—」+「伏せ値」、一次 / 二次の区別なし。`ArticleTable`: 順位の数字を描かない、`sort` 不許可時に並び UI がない、スマホ幅で 4 列。`BandDot`: 入力は `band` の 3 値（または null）だけ。点の x 座標は 3 つの固定値（12.5% / 50% / 87.5%）のいずれかで、数値を渡す口がない。3 区分の文言、母集団なしで「まだ比較できません」。`LineChart`: 前期間の線に `stroke-dasharray` があり、未確定の日の線と色クラスが異なる。`showPrev=false` で前期間の線が出ない（S-03）。固定行が初期描画から埋まる。`HBar`: 前置き（`lead.*`）を描く。すべての部品の出力に `style=` 属性がない | FR-73、NFR-33、NFR-36、NFR-96、NFR-97、NFR-99、ADR 0008 |
| U-25 | `DataStatus` | is_stale または 今日 − 基準日 ≥ 3 で「更新が遅れています」 | FR-02、NFR-90、D-07 |
| U-26 | 外部リンクの再検証 | `https://takatsu-connect.com/` 配下以外はリンクにしない | FR-04、NFR-91 |
| U-27 | `applyAuthorHierarchyMask(authorCells, articleCells)` | 著者 × 内訳軸 の階層差分（03 §6.1 手順 5）。同じ period・axis・bucket で、その著者の記事セルのうち伏せたもの（threshold / secondary）がちょうど 1 本なら、著者セルの値が T 以上でも `secondary` で伏せる。0 本・2 本以上なら変えない。手順 5 の後に区分内の二次伏せ（U-05）を再判定する。フィクスチャ: 記事 3 本のうち 1 本だけ instagram が 4（伏せ）→ 著者の instagram が伏さり、著者の区分内で伏せが 1 つだけになったので次に小さい T 以上のセルも伏さる | NFR-33（設計レビュー M-2）、05 §4.1 行 12 |
| U-28 | `batch_run.counts` の zod スキーマ | 固定キー（02 §3.6 の一覧）・数値のみ。未知のキー、文字列・配列・オブジェクトの値、負数以外の数値以外は `parse` が失敗する。`strict()` で余分なキーを拒否 | NFR-44（設計レビュー L-6） |
| U-29 | `classifyError(e)` と `logError(step, kind)` | supabase-js の PostgrestError → `db`、GA4 の `RESOURCE_EXHAUSTED` → `quota`、`PERMISSION_DENIED` / `UNAUTHENTICATED` → `auth`、fetch の失敗 → `network`、zod → `validation`、その他 → `unknown`。`logError` の出力は `step` と `kind` の 2 語だけで、引数の例外オブジェクトの `message` / `stack` / `cause` の文字列が出力に含まれない | NFR-44（設計レビュー M-8） |

## 4. 結合テスト（Supabase ローカル: マイグレーションと公開ビューの検査）

前提: `supabase start` → `supabase db reset`（全マイグレーション適用 + `seed/test`）。フィクスチャ: 著者 4 人（うち 1 人 `excluded_author` に登録）、記事 12 本（除外著者の記事 3 本。うち 1 本は除外著者だけが属する子カテゴリとタグに属する）、日別 60 日、期間別は last7 / prev7 / last28 / prev28 / m2026-09（確定）/ m2026-10、伏せ値になる小さな値と二次伏せになる組み合わせを含む。

| ID | 検査 | 合格条件 | 受入基準 |
| --- | --- | --- | --- |
| I-DB-01 | anon / authenticated / PUBLIC の権限と service_role の権限 | `information_schema.role_table_grants where grantee in ('anon','authenticated','PUBLIC')` が `public.pub_%` の `SELECT`（anon のみ）だけ。`information_schema.routine_privileges` で同じ grantee に EXECUTE がない（L-4）。シーケンスへの grant がない。`anon` で内部表（`internal.wp_post`、`internal.article_daily`、`internal.excluded_author` など全部）を select すると `permission denied`（スキーマの usage がない）。加えて `service_role` は `has_schema_privilege('service_role','internal','USAGE')` が true で、`internal` の全表に select / insert / update / delete、全シーケンスに usage を持ち、service_role キーでの upsert と delete が成功する（N-3。grant 不足を `to public` などの広い grant で直していないことを、上の anon / authenticated / PUBLIC の条件で同時に確かめる） | NFR-43、NFR-40 |
| I-DB-02 | RLS | `pg_tables` の全表で `rowsecurity = true`。anon で insert / update / delete が拒否される | NFR-43 |
| I-DB-03 | `_mask` 列が出ない | `information_schema.columns` で `table_name like 'pub_%'` の列名に `_mask` を含むものがない | FR-73、NFR-33、02 §2.3 |
| I-DB-04 | 除外著者がどの pub_ にも現れない | `pub_%` ビューを動的に列挙し、`author_slug` 列を持つものは除外 slug の行が 0、`post_id` 列を持つものは除外著者の記事 ID の行が 0。`pub_author` に除外 slug がない。除外の有無を示す列（`is_excluded` など）がどのビューにもない | FR-36、NFR-43 |
| I-DB-05 | 親・子カテゴリ・鮮度区分の合計、分布の母集団 | `pub_category_period` の親行・子行がともに除外後（手計算値。親行の distinct の数え方は維持）。`pub_site_period_freshness` の 3 区分の pageviews・post_count が除外後で、Σ = 可視記事の `pub_article_period.pageviews` の和。`pub_author_period`、`pub_author_category_period` も除外後。除外著者だけの子カテゴリは行がない。`pub_site_period.pageviews`（GA4 のサイト全体値）と `pub_posting_period.post_count` は除外の有無で変わらない（除外を外して再集計した値と等しい）。`pub_posting_period` に `author_count` 列がない（M-5）。**`pub_benchmark_curve` の母集団に除外著者の記事が入らない**（N-1）: 各 (scope, n) 行の `population_size` = 可視記事（`pub_post` にあり `is_ad = false`、`age_days ≥ n`、`population_window` の条件を満たす）の件数。p25 / p50 / p75 が可視記事の値だけから U-07 の参照実装で計算した値と一致し、除外記事を含めて計算した値（フィクスチャで除外記事の値を分位の補間位置に置く）とは異なる | FR-40、FR-10、FR-51、FR-36、FR-17、FR-21、ADR 0003 判断 4（H-1、N-1） |
| I-DB-06 | タグの合計 | `pub_tag_period` が除外後。`pub_tag_period.pageviews` − Σ（`pub_article_period` のそのタグの記事）= 0。除外著者だけのタグは行がない | FR-42 |
| I-DB-07 | 二次伏せ | フィクスチャの「1 セルだけ 5 未満（他に T 以上のセルがある）」の行で、`pub_site_period_breakdown`（axis = sns / local / new_returning / channel / device_pv / device_sessions。Q-36）/ `pub_article_period_breakdown` / `pub_author_period_breakdown` / `pub_site_daily_channel` / `pub_site_daily_device` / `pub_site_period_heatmap`（L-1）に null が 1 つだけの（期間・軸）組がない。「1 セルだけ 5 未満で他は 0」の行は null が 1 つだけでよい（候補なし。M-1）。著者 × 内訳軸 で記事 1 本だけが伏さる組は著者セルも null（M-2） | NFR-33 |
| I-DB-08 | 伏せ値の生値が取れない | 「適用」の組み合わせの列に 1〜4 の値がない（0 は 0 のまま。D-16 確定）。`pub_article_daily.pageviews`、合計・累積列は生値 | FR-73、NFR-33 |
| I-DB-09 | 格納しない組み合わせがない | テーブル・ビュー名と列名に、記事 × 地域、記事 × 曜日 × 時間帯、著者 × デバイス、カテゴリ / タグ × 内訳軸、移動窓の参照元・市別に当たるものがない（名前の許可リストと突き合わせ: 02 §3・§4 の表の名前だけが存在する） | NFR-33、NFR-31、NFR-32 |
| I-DB-10 | 確定月・30 日時点 | `pub_site_month_referrer` / `pub_site_month_city` の period_id がすべて `is_confirmed = true` の月。`pub_article_referrer_30d` は `referrer_30d_computed_on` が入った記事だけ。T 未満の行がない | M-12、M-14、ADR 0003 判断 3 |
| I-DB-11 | ビューの列 = 契約 | 各 `pub_*` の列名と型が `pub-types.ts`（04 §4）と一致（U-20 と同じ生成結果を使う） | 04 §2 |
| I-DB-12 | 著者の列 | `pub_author` と `wp_author` の列が display_name / author_slug / author_url（+ 内部の時刻列）だけ。メール・ログイン名・ユーザー ID・アバターの列がない | NFR-35 |
| I-DB-13 | 削除の反映 | 記事を `wp_post` から削除すると、関連する `article_*` の行が cascade で消え、`pub_*` から消える | FR-72、NFR-52 |
| I-DB-14 | マイグレーションの再適用 | 空の DB に全マイグレーションを順に適用して成功。`supabase db diff` が空（スキーマがすべてファイルにある） | NFR-73 |
| I-DB-15 | スキーマの usage | `has_schema_privilege(r, s, 'USAGE')` が、r ∈ {anon, authenticated, public(PUBLIC)} × s ∈ `public` 以外の全スキーマ（`internal` を含む。`pg_catalog`、`information_schema` は除く）で false。`internal` スキーマに `pub_` で始まるオブジェクトがなく、`public` スキーマに `pub_` 以外の表・ビュー・関数がない。`internal.batch_run.counts` に check 制約があり、文字列値を含む jsonb の insert が失敗する（L-6） | NFR-43（設計レビュー M-7、L-4、L-6） |
| I-DB-16 | 公開ビューの列のスナップショット | `information_schema.columns where table_schema='public' and table_name like 'pub_%'` の（ビュー名、列名、型）の集合が `tests/snapshots/pub-columns.json`（02 §5 の対応表から作る）と完全に一致。列名に `_mask` を含むものがなく、`excluded_at`・`author_count`・`share_count` がない。差分があれば失敗し、スナップショットの更新には NFR-39 の手順（ADR と security-auditor のレビュー）を PR で示す | NFR-43、NFR-39（設計レビュー M-7、M-4、M-5） |
| I-DB-17 | 分布と帯の計算（ビュー） | `pub_benchmark_curve` の各行が、同じフィクスチャから U-07（`quantiles`）で計算した p25 / p50 / p75・`population_size`・`population_window` と一致（12 か月 → 全期間の拡張、30 本未満で行なし、`scope = cat:<id>` は母集団 30 本以上の子カテゴリだけ、広告・除外記事を含めない）。`pub_article_summary.band_7d`（age_days ≥ 7 のときだけ）と `band_30d`（N = min(age_days, 30) 日目の累積と曲線 (all, N) の比較）、`pub_author_summary.band_30d`（own_median_30d と曲線 (all, 30)）が U-08（`band`）の結果と一致。age_days < 3・曲線の行なし・値 null で null。p25 / p75 と等しい値が `middle`。除外著者を 1 人追加すると、曲線・帯・`population_size` が次の select で変わる（バッチの再実行なし）。`explain analyze` で `pub_benchmark_curve` の全行 select がローカルの 1,000 本のフィクスチャで 2 秒以内（超えるなら ADR 0003 判断 4 追記の (c) へ） | M-19、M-20、M-27、FR-21、FR-23 (3)、FR-31 (b)、ADR 0003 判断 4 追記（N-1） |

実装: `packages/db-tests/` に Vitest を置き、`DATABASE_URL`（ローカル）で `pg` 接続。anon の検査は `set role anon` ではなく、anon の JWT を使う PostgREST 経由（supabase-js、ローカルの anon キー）と、`set local role anon` の SQL の両方で行う（PostgREST 層の見落としを防ぐ）。

## 5. 結合テスト（バッチ: GA4 / WP のモック）

| ID | 検査 | 合格条件 | 受入基準 |
| --- | --- | --- | --- |
| I-B-01 | `daily` の端から端 | モック GA4（固定 JSON、問い合わせごと）とモック WP（posts 3 ページ、categories、tags、`_embed` author）に対して実行し、Supabase ローカルの内部表が期待値（手計算）と一致。`batch_run` に success | FR-70、FR-76 |
| I-B-02 | 直近 7 日の再取得 | 2 回目の実行で GA4 モックの直近 7 日の値を変えると上書きされ、8 日以上前は変わらない。伏せ判定が「伏せ → 表示」に変わる | FR-71、NFR-03、D-08 |
| I-B-03 | 記事の削除・protected | 2 回目の WP モックで 1 本を消し、1 本を `content.protected = true` にすると、両方が関連集計とともに消える | FR-72、NFR-34、NFR-52 |
| I-B-04 | 失敗時 | GA4 モックが 500 / 429 を返すと、`batch_run` に failed と `failed_step` / `error_kind` が入り、通知（モックの Webhook）に工程と日時だけが入る（応答本文、行データ、トークンがない）。既存のデータは残る | FR-74、NFR-44、NFR-90 |
| I-B-05 | ログの規律 | 実行ログの全文に、`Bearer`、`eyJ`（JWT）、Supabase の URL、著者名、記事タイトル、API 応答の JSON が含まれない。件数と所要時間だけ | NFR-44、03 §15 |
| I-B-06 | WP への問い合わせ | wp/v2 だけ、差分（`modified_after`）、リクエスト間隔 ≥ 設定値（モックが受信時刻を記録）。1 回の daily で posts の全件取得をしない（2 回目） | NFR-72、FR-72 |
| I-B-07 | 割当の記録 | `returnPropertyQuota` の値を実行記録に残し、1 回の daily のリクエスト数が D-01 の見込み（約 30）の 1.5 倍以内 | NFR-61 |
| I-B-08 | バックフィル | 開始日 2025-10-08〜基準日を分割して実行し、`site_daily` の行数が日数と一致。開始日は環境変数 | FR-75、NFR-50 |
| I-B-09 | publish | 成功時に Deploy Hook（モック URL）が 1 回だけ POST される。失敗時は呼ばれない。`publish_only` は取得をせず Hook だけ呼び、`batch_run` に行を書かない（L-7）。実行ログに Hook の URL と応答本文が含まれない（L-8） | NFR-11、ADR 0005、ADR 0006 |
| I-B-10 | 除外リストの運用スクリプト | `exclude-author add <slug>` で `internal.excluded_author` に入り、`pub_*` から消える（I-DB-04 を再実行）。スクリプトの出力に slug 以外の個人名が出ない | FR-36、D-10 |
| I-B-11 | 未処理例外 | テスト用のフックで (a) 工程の途中で同期の `throw`、(b) 未処理の Promise 拒否、(c) supabase-js が URL を含むエラーを返す、(d) GA4 モックが `properties/123456789` を含むエラー本文を返す、の 4 通りを起こす。いずれも終了コード 1、`batch_run` が `failed` で `error_kind` が分類値（`unknown` を含む）、stdout / stderr の全文に `https://`、`properties/`、`eyJ`、6 桁以上の数字列（`\d{6,}`）、`at ` で始まるスタック行が含まれない | NFR-44（設計レビュー M-8）、03 §14 |

モックの応答は `tests/fixtures/ga4/*.json`、`tests/fixtures/wp/*.json` に置く。本番から写した値は使わず、手で作る（著者名・タイトルは架空）。

## 6. E2E（Playwright、プレビュー環境）

CI 内の `next build`（Supabase ローカルのフィクスチャ）に対して実行する。Preview URL には E-01〜E-05 だけ（スモーク）。

| ID | 検査 | 合格条件 | 受入基準 |
| --- | --- | --- | --- |
| E-01 | 応答ヘッダ | 全画面（S-01〜S-08、404）で `Content-Security-Policy`（`style-src 'self'` を含み `unsafe-inline` を含まない。script-src は実装時の決定どおり）、`X-Content-Type-Options: nosniff`、`Referrer-Policy`、`X-Frame-Options: DENY` / `frame-ancestors 'none'`、`X-Robots-Tag: noindex, nofollow` | NFR-91、NFR-21、06 §6 |
| E-02 | noindex | 全画面の `<meta name="robots">` が noindex, nofollow。`/robots.txt` が `Disallow: /` | NFR-21 |
| E-03 | 404 | 存在しない記事 ID、除外著者の記事 ID、除外著者の slug、不正な形式（`/articles/abc`、`/authors/A%20B`）がすべて同じ状態コード 404 と同じ本文（CommonNotes を含む）。スタックトレース・内部 URL・SQL がない | FR-06、FR-23、FR-30、FR-36、NFR-91 |
| E-04 | 配信される JS と HTML | ビルド出力（`.next/static`、HTML）に `SUPABASE_URL` の値、anon キーの先頭 20 文字、`supabase.co` の文字列が含まれない（CI のビルドではテスト用のダミー値を環境変数に入れ、その値で検索する。L-5）。`NEXT_PUBLIC_` で始まる環境変数がビルド出力に 1 つもない | NFR-42 |
| E-05 | 主要画面の存在 | S-01〜S-08 が 200 で開き、h1 が §1 の問いの文言 | NFR-94 |
| E-06 | 期間切り替えと URL | `?p=last7` などで表示が変わり、URL が同期する。別のコンテキストで同じ URL を開くと同じ表示。`?p=prev28`、`?p=m1999-01`、`?p=<script>` は既定（直近 28 日）になりエラーが出ない | FR-01、FR-06、FR-03、NFR-91 |
| E-07 | 並べ替えの制限 | S-02e で絞り込みなし・親カテゴリのみのとき並び UI がなく、`?sort=pv` を付けても公開日順。著者 / 子カテゴリ / 公開年月で絞ると多い順の UI が出る。少ない順の UI がどこにもない。S-05 は常に並べ替え可 | FR-24、NFR-98 |
| E-08 | 順位の数字がない、0 本の著者がない | S-02a〜S-02e、S-05、S-07b、S-08 の表に連番の列・先頭の数字がない（`^\d+\.?\s` に一致するセルがない）。S-08 のライターの表に本数 0 の行がなく（フィクスチャの「期間内に公開なし」の著者が載らない）、見出しが「この期間に記事を公開したライター（名前の順）」 | NFR-36、FR-51 |
| E-09 | 伏せ値の表示 | フィクスチャで伏せ値になる区分（一次・二次とも）が「—」と「伏せ値」で、両者の DOM が同じクラス・文言。「5 回未満」の文言がない | FR-73、NFR-33、NFR-96 |
| E-10 | 比率の分母 | 分母 19 のフィクスチャで % が出ず差だけ、20 で % が出る | NFR-96、FR-01 |
| E-11 | 色 | 記事・著者の数値要素の computed color が設計トークン（基調色の濃淡とグレー）のいずれかで、赤・緑系の色（hue 0〜20、100〜160）がない。帯の 3 区分が同じ色 | NFR-97 |
| E-12 | 禁止語 | 全画面の本文に「偏り」「下位」「読まれなかった」「順位」「ランキング」「あなた」「鮮度」「（軸）」がない。「出ません」で終わる文がない | NFR-97、NFR-99 |
| E-13 | スマホ幅 | viewport 360 × 740 で、各表が 4 列以下 + 「詳しく」、ヒートマップの列が 6、横スクロールが S-06b 以外で発生しない | NFR-81、NFR-99 |
| E-14 | 共通説明文 | 全画面（404 を含む）に CommonNotes があり、「一部の記事は本人の希望により個別には表示していません」を含む。除外リストが空のフィクスチャでも同じ | NFR-99、FR-36 |
| E-15 | 著者一覧 | S-04 に数字（`\d`）を含むセルがない。リンクの href に slug があり、テキストノードに slug がない。S-05 の本文にも slug が現れない | FR-30、NFR-35 |
| E-16 | 外部リンク | 全画面の `a[href^="http"]` が `https://takatsu-connect.com/` 配下だけ | FR-04、NFR-91 |
| E-17 | 初期表示 | Lighthouse（モバイル、Slow 4G）の LCP ≤ 3.0 秒、HTML サイズ（埋め込み JSON 込み）が 04 §6 の目安以内（S-01 ≤ 120 KB、S-02e ≤ 150 KB、S-03 ≤ 60 KB、未圧縮）。超えたら 04 §6 の案を適用 | NFR-10、NFR-12 |
| E-18 | データ更新の遅れ | フィクスチャの `pub_meta.is_stale = true` で DataStatus に「更新が遅れています」 | FR-02、NFR-90 |
| E-19 | 日別推移 | 切り替えが「読まれた回数」「訪問回数」の 2 つだけ。読んだ人の数の選択肢がない。未確定 3 日が薄いクラスで、前期間の線は点線（`stroke-dasharray`）と別のクラス。公開日の点がフィクスチャの公開日に一致。90 日を選ぶと週別が既定で日別に切り替えられる。固定行が初期表示から埋まり、行頭に「グラフの日付をタップすると」の文がある。S-03 の日別推移に前期間の線がない | FR-11、M-26、Q-35 |
| E-20 | 参照元・市別・リンク元の非連動 | 期間を変えても S-01 のリンク元・市別、S-03 のリンク元の値と「前月までの集計です」「公開後 30 日時点の集計です」の注記が変わらない。30 日未満の記事は「公開後 30 日で集計します」 | FR-13、FR-15、FR-23 |
| E-21 | ブラウザ | E-05〜E-09 を Chromium、WebKit、Firefox で実行 | NFR-80 |
| E-22 | 画面レビューの反映（責めない形） | S-03: 本文に ▲▼ と「前の 28 日と比べて」がなく、「公開からの合計は」がある。h1 が「この記事はどう読まれた？」。`PeriodPicker` が「公開からの読まれ方」「到達のお知らせ」「◯◯さんのこれまでの記事と比べて」の後ろにある。S-05: 「1 人あたり」「真ん中です」（著者の本数の中央値）がなく、(b) の文が「◯◯さんの記事は、公開から 30 日で」で始まり、旧 (e) の文が別行にない。期間内の公開が 0 本のフィクスチャで「新しく公開した記事はありません」が出て「0 本公開し」が出ない。到達がない期間で「到達のお知らせ」の見出しがない。S-02b・S-05 の `BandDot` の点の `cx` が 3 つの固定値のいずれか。S-01: 「読者はどんな人？」の `<details>` が幅 1280 で `open`、360 で閉。各 HBar の節に「〜のうち」の前置きがある。全画面で「〜になると出ます」の形以外の不在文（「〜のため出ません」）がない | FR-23、FR-31、FR-51、NFR-36、NFR-94〜NFR-99（advice/2026-11-03-screens-review.md 高 1〜5、中） |

## 7. CI の検査

`ci.yml`（PR と main への push）。すべて必須チェック。

| ID | 検査 | 実装 | 受入基準 |
| --- | --- | --- | --- |
| S-01 | `NEXT_PUBLIC_SUPABASE` を含む識別子の禁止 | リポジトリ全体（`.env.example`、`vercel.json`、`next.config.*`、ソース）を `grep -r "NEXT_PUBLIC_SUPABASE"` → 1 件でも失敗。加えて ESLint `no-restricted-syntax` で `process.env.NEXT_PUBLIC_*` を `apps/web` の Client Component で禁止 | NFR-42 |
| S-02 | `from('pub_')` 以外のテーブル名の禁止 | ESLint 独自ルール（`apps/web` 内の `.from(` の第 1 引数が文字列リテラルで `pub_` 始まりでなければエラー。変数を渡すのもエラー）。`apps/web/src/data/pub/` 以外で `.from(` を使うのもエラー | ADR 0006、NFR-43 |
| S-03 | `style` prop と `dangerouslySetInnerHTML` の禁止 | `react/forbid-dom-props`（style）、`react/no-danger` | ADR 0008、NFR-91 |
| S-04 | JSX のリテラル日本語の禁止（辞書経由） | `react/jsx-no-literals`（`noStrings`、`ignoreProps`）。例外は `ui-text.ts` | NFR-99、Q-29 |
| S-05 | 禁止語 | `ui-text.ts` と `apps/web` の `grep`（偏り、下位、読まれなかった、順位、ランキング） | NFR-97 |
| S-06 | GA4 / WP の禁止名 | `apps/batch` の `grep`（newUsers、totalUsers、engagedSessions、engagementRate、averageSessionDuration、bounceRate、pageReferrer、pageLocation、`/comments`、`/users`、`realtime`、`runRealtimeReport`） | M-04〜M-08、M-42、NFR-04、NFR-32、NFR-38 |
| S-07 | `console.log` の禁止 | ESLint `no-console`（ロガー経由） | NFR-44 |
| S-08 | 依存の脆弱性 | `pnpm audit --audit-level=high`（失敗で止める。例外は `pnpm audit` の ignore に理由つきで） | 06 §10 |
| S-09 | 秘密の検出 | gitleaks（全履歴は初回、以後は差分）。Supabase の service role の形（`eyJ…` の JWT）、Deploy Hook URL（`api.vercel.com/v1/integrations/deploy/`）、GCP の鍵（`"type": "service_account"`）のパターンを追加 | NFR-40、NFR-41 |
| S-10 | ワークフローの規律 | actionlint。`permissions:` が全ワークフローにあり、`id-token: write` は GCP 認証ジョブだけ、`pull_request_target` がない、`uses:` がすべて 40 桁 SHA（`grep -E 'uses: .+@[0-9a-f]{40}'` と一致しない行があれば失敗）、schedule のジョブに `if: github.ref == 'refs/heads/main'`。heartbeat の分離（M-3）: `contents: write` が現れるのは `heartbeat.yml` だけ（`grep -l 'contents: write' .github/workflows/*` の結果が `heartbeat.yml` のみ）。`heartbeat.yml` の `uses:` が `actions/checkout` だけで、`run:` に `pnpm`・`npm`・`node` がなく、`secrets.` の参照がなく、`id-token` がない。`daily.yml` の最上位 `permissions` が `contents: read` | NFR-45 |
| S-11 | 応答ヘッダ | `next build` → `next start` → 全ルートに対して `curl -I` し、E-01 の値を検査（E2E と二重。Playwright が落ちても単独で分かるように） | NFR-91 |
| S-12 | 型検査と lint | `tsc --noEmit`、ESLint、Prettier | ― |
| S-13 | マイグレーションと公開ビュー | §4 の I-DB-01〜I-DB-16（スキーマの usage、列のスナップショットを含む） | NFR-43 |
| S-14 | ビルド出力の検査 | E-04（`.next/static` と HTML に `SUPABASE_URL` の値と anon キーの先頭 20 文字がない。L-5）と E-17 のサイズ | NFR-42、NFR-10 |
| S-15 | `.env.example` の形 | 各行が `NAME=` だけ（値がない）。本番の名前の一覧（03 §16、06 §3）と一致 | NFR-40 |

- ローカルでも `pnpm check` で S-01〜S-07、S-12 を同じ設定で実行できるようにする。

## 8. 手動の受入（目視・照合）

06_acceptance.md の「照合」「目視」のうち自動化しないもの。初回公開前に 1 回、要件変更時に該当分。証跡は要件 ID・日付・結果・スクリーンショットの要約（行データや秘密情報なし）。

| ID | 手順 | 受入基準 |
| --- | --- | --- |
| A-01 | GA4 標準レポートとの照合: 確定した任意の 7 日間について、全体の表示回数・セッション・ユーザー、上位 10 記事の表示回数、チャネル別、デバイス別、地域別、曜日 × 時間帯、ランディングページ別、scroll、AddToAnyShare を比べる（基準日の 8 日以上前） | M-01〜M-03、M-06、M-09〜M-17、M-41 |
| A-02 | WP REST API との照合: 公開記事数、著者別・カテゴリ別・タグ別の本数、日別公開本数 | M-26、M-30〜M-33 |
| A-03 | 派生指標の手計算: 記事 3 本の累積、母集団の分位、鮮度、最近 / 久しぶり、到達、自分の過去、以前の記事 | M-18〜M-25、M-27、M-34 |
| A-04 | 画面の言葉: 各画面の言葉が 02_metrics.md「画面での名称」と glossary §1 に一致、GA4 名は括弧のみ、注記が各指標にある、見出しが問いの形、比較の相手が添えられている | NFR-94、NFR-95、NFR-99、M-01〜M-03 の名称 |
| A-05 | 性能: Preview を通常の回線（モバイル回線を含む）で開き、主要な数値とグラフが 3 秒以内。同時 10 人程度の通常操作 | NFR-10、NFR-12 |
| A-06 | ブラウザ: Chrome、Safari、Edge、Firefox の最新版と 1 つ前で全画面 | NFR-80 |
| A-07 | 鮮度: 連続 5 営業日、T 時までに前日分が表示されている | NFR-02 |
| A-08 | 運用: 失敗通知の受信（通知先 Q-12）、再実行で復旧、60 日停止対策の確認手順、除外リストの変更と再生成（Preview 相当の環境で） | FR-74、NFR-70、NFR-71、NFR-11、NFR-73 |
| A-09 | 秘密: Google Cloud の鍵一覧に JSON 鍵がない、Vercel / Actions の環境変数以外に受け渡し経路がない、リポジトリ履歴に除外リスト・著者名がない | NFR-40、NFR-41、NFR-44 |
| A-10 | 無料枠: 初回公開後 1 か月の請求 | NFR-60 |

## 9. 受入基準との対応表

06_acceptance.md の ID → テスト ID。「自動」は CI で毎回、「手動」は §8。

| 受入 ID | テスト | 種別 |
| --- | --- | --- |
| M-01〜M-03 | A-01、A-04、U-22、E-19（M-03 が日別推移にない） | 手動 + 自動 |
| M-03、M-15 | U-22（dateRanges）、I-B-01、A-01 | 自動 + 手動 |
| M-04、M-05、M-07、M-08（廃止） | U-22、S-06、I-DB-09 | 自動 |
| M-06 | A-01、U-14（分母 20）、E-10 | 手動 + 自動 |
| M-09 | U-16、U-22、A-01 | 自動 + 手動 |
| M-10 | U-03、A-01、A-04 | 自動 + 手動 |
| M-11、M-12 | U-02、U-05、I-DB-07、I-DB-10、A-01 | 自動 + 手動 |
| M-13、M-14、M-16、M-17 | U-05、U-17、U-22、I-DB-09、I-DB-10、A-01、E-13 | 自動 + 手動 |
| M-18、M-20 | U-06、I-DB-08、A-03 | 自動 + 手動 |
| M-19 | U-07、U-08、I-DB-05（母集団が除外後）、I-DB-17、A-03 | 自動 + 手動 |
| M-21、M-22 | U-09、U-10、E-08、A-03 | 自動 + 手動 |
| M-23 | U-11、A-03 | 自動 + 手動 |
| M-24 | U-12、A-03 | 自動 + 手動 |
| M-25 | I-DB-05（freshness 集計）、A-03 | 自動 + 手動 |
| M-26 | E-19、A-02 | 自動 + 手動 |
| M-27 | U-07、I-DB-05、I-DB-17、A-03 | 自動 + 手動 |
| M-30〜M-33 | I-B-01、A-02、E-08 | 自動 + 手動 |
| M-34 | A-03、E-20（前年なし） | 手動 + 自動 |
| M-41 | 初回対象外（M-4）。U-22 で AddToAnyShare の問い合わせがないことを確認。I-DB-16 で share_count 列がないこと | 自動 |
| M-42（廃止）、M-43 | U-23、S-06、I-DB-09 | 自動 |
| FR-01 | U-13、U-14、E-06、E-10 | 自動 |
| FR-02 | U-25、E-18、E-19 | 自動 |
| FR-03 | U-18、E-06 | 自動 |
| FR-04 | U-26、E-16 | 自動 |
| FR-05 | （Q-19 で要と決まったとき: 表と CSV の一致を U で） | ― |
| FR-06 | E-03、E-06 | 自動 |
| FR-10〜FR-17 | E-05、E-19、E-20、E-22（「読者はどんな人？」の折りたたみ、HBar の前置き）、A-01、A-04 | 自動 + 手動 |
| FR-20〜FR-22 | E-08、E-05、E-22（BandDot の固定位置）、I-DB-17（band_30d = 同じ日数の帯）、A-04（4 列、新着の印、注記） | 自動 + 手動 |
| FR-23 | E-03、E-20、E-22（前期間比なし、公開からの合計、節の順序、h1）、A-03、A-04 | 自動 + 手動 |
| FR-24 | U-18、E-07 | 自動 |
| FR-25 | U-10、E-08 | 自動 |
| FR-30 | E-03、E-15 | 自動 |
| FR-31 | A-03、A-04、E-11（矢印の色）、E-22（参考値なし、(b)(e) の統合、0 本の文、到達の見出し） | 手動 + 自動 |
| FR-32 | E-07、E-13 | 自動 |
| FR-33 | I-DB-07、I-DB-09、A-03 | 自動 + 手動 |
| FR-34 | U-10、E-08 | 自動 |
| FR-35（廃止） | E-08、S-05（順位・ランキングの語）、`grep` で `RANKING` の設定名がない（S-06 に追加） | 自動 |
| FR-36 | I-DB-04〜I-DB-06、I-DB-15、I-DB-16、I-B-10、E-03、E-14、S-09、A-09 | 自動 + 手動 |
| FR-40 | I-DB-05、A-02、A-04 | 自動 + 手動 |
| FR-41 | E-20、A-03 | 自動 + 手動 |
| FR-42 | I-DB-06、E-08 | 自動 |
| FR-50〜FR-52 | A-02、E-08（0 本の著者が載らない）、I-DB-05（author_count がない。M-5）、E-05（S-08 の主表示に「人のライター」がない） | 手動 + 自動 |
| FR-53 | I-B-01 の変種（GA4 モックが空）で S-08 が描ける（E-05 の変種） | 自動 |
| FR-61 | 初回対象外（M-4）。U-22、I-DB-16、E-05（`/reactions` が 404） | 自動 |
| FR-62（廃止）、FR-63 | U-23、S-06、I-DB-09 | 自動 |
| FR-70 | I-B-01、S-10（schedule）、A-07 | 自動 + 手動 |
| FR-71 | I-B-02 | 自動 |
| FR-72 | I-B-03、I-B-06、U-23 | 自動 |
| FR-73 | U-04、U-05、I-DB-03、I-DB-07、I-DB-08、E-09 | 自動 |
| FR-74 | I-B-04、A-08 | 自動 + 手動 |
| FR-75 | I-B-08 | 自動 |
| FR-76 | I-B-01、I-B-05、E-18 | 自動 |
| NFR-01、NFR-02 | S-10、A-07 | 自動 + 手動 |
| NFR-03 | I-B-02 | 自動 |
| NFR-04 | S-06、U-22 | 自動 |
| NFR-10、NFR-12 | E-17、A-05 | 自動 + 手動 |
| NFR-11 | I-B-09、A-08 | 自動 + 手動 |
| NFR-20 | E-05（ログイン画面がない）、S-02（認証コードがない: `grep -r "auth\." apps/web` が 0） | 自動 |
| NFR-21 | E-01、E-02 | 自動 |
| NFR-22 | S-06（RANKING）、A-09、I-DB-01 | 自動 + 手動 |
| NFR-30〜NFR-32 | I-DB-09、U-22、U-23 | 自動 |
| NFR-33 | U-04、U-05、U-27、I-DB-03、I-DB-07〜I-DB-10、E-09、E-10 | 自動 |
| NFR-34 | U-23、I-B-03 | 自動 |
| NFR-35 | I-DB-12、U-23、E-15 | 自動 |
| NFR-36 | E-07、E-08、E-15、S-05 | 自動 |
| NFR-37、NFR-38 | U-22、I-DB-09 | 自動 |
| NFR-39 | （手順。A-09 の際に ADR と要件の整合を確認） | 手動 |
| NFR-40、NFR-41 | S-09、S-15、A-09 | 自動 + 手動 |
| NFR-42 | S-01、E-04 | 自動 |
| NFR-43 | I-DB-01（service_role の grant を含む。N-3）、I-DB-02、I-DB-04、I-DB-15、I-DB-16 | 自動 |
| NFR-44 | I-B-04、I-B-05、I-B-11、U-28、U-29、S-07 | 自動 |
| NFR-45 | S-10 | 自動 |
| NFR-50、NFR-51 | I-B-08、S-06（削除処理・保持依存がない: `grep` で `delete from site_daily` 等がない） | 自動 |
| NFR-52 | I-B-03、I-DB-13、I-DB-04 | 自動 |
| NFR-60、NFR-61 | A-10、I-B-07 | 手動 + 自動 |
| NFR-70、NFR-71 | A-08 | 手動 |
| NFR-72 | I-B-06、A-09（スキャン・負荷試験の記録がない） | 自動 + 手動 |
| NFR-73 | I-DB-14、A-08 | 自動 + 手動 |
| NFR-80 | E-21、A-06 | 自動 + 手動 |
| NFR-81 | E-13 | 自動 |
| NFR-82 | U-13、A-04（JST 表記） | 自動 + 手動 |
| NFR-90 | U-25、E-18、I-B-04 | 自動 |
| NFR-91 | E-01、E-03、E-06、E-16、S-11 | 自動 |
| NFR-94、NFR-95 | E-05（h1）、E-22（記事単位の前期間比なし、「あなた」なし）、A-04 | 自動 + 手動 |
| NFR-96 | U-14、U-15、E-09、E-10 | 自動 |
| NFR-97 | U-19、E-11、E-12、S-05 | 自動 |
| NFR-98 | U-18、E-07 | 自動 |
| NFR-99 | U-19、E-13、E-14、A-04 | 自動 + 手動 |

受入基準の ID で対応がないもの: M-40 / FR-60（取得不可、基準未定）、M-50（スコープ外）。FR-05 は Q-19 の回答後。

## 10. テストデータ

- `supabase/seed/test/`: 架空の著者 4 人（`author-a`〜`author-d`。`author-d` を除外）、記事 12 本（広告 1 本、`author-d` 3 本、公開日は 2026-08-01〜2026-10-30 に分散、1 本は 365 日以上前）、`site_daily` 60 日、`article_daily` 12 本 × 公開後の日数、期間別表は last7 / prev7 / last28 / prev28 / last90 / prev90 / m2026-08〜m2026-10、`site_month_referrer` / `site_month_city` は m2026-08・m2026-09（確定）だけ。分布（`benchmark_curve`）はビューが計算するため直接は入れず、フィクスチャを 2 版にする: 基本版（記事 12 本。母集団 30 本に満たず「まだ比較できません」の経路）と、拡張版（スクリプトで生成した記事 40 本。うち除外著者 `author-d` の 5 本は、各 n で分位の補間位置（可視 35 本の順位 9・18・27 の前後）に来る値にして、除外の有無で p25 / p50 / p75 が変わることを I-DB-05・I-DB-17 で確かめられるようにする。公開日は 12 か月の窓の内外に分け、`population_window` の切り替えも通す）。性能計測（I-DB-17）には 1,000 本の生成版を使う。
- S-08・S-05 の「0 本」の経路: `author-c` は last28 に公開なし（以前の記事だけ読まれている）。
- 伏せ値のケースを明示的に含める: 区分 1 つだけが 4 で他に T 以上がある（二次伏せが起きる）、区分 1 つだけが 4 で他がすべて 0（候補なし、二次伏せが起きない。M-1）、2 つが 4（二次伏せが起きない）、0 の区分（D-16。0 のまま出る）、曜日 × 時間帯 で 1 セルだけ 1〜4（L-1）、著者の記事 3 本のうち 1 本だけ instagram が伏さる（階層差分。M-2）、`site_period_breakdown` の channel / device_pv / device_sessions（Q-36）。
- `pub_posting_period` に `author_count` がなく、シェア数の表・列がないことはスナップショット（I-DB-16）で固定する。
- 分母の境界: 19 と 20。
- 累積の境界: 公開 2 日目の記事（まだ比較できません）、7 日目、29 日目、30 日目。
- 本番のデータ（著者名、タイトル、数値）をフィクスチャに写さない。

## 11. 未確定

- Preview（Vercel）のビルドが読む Supabase（本番 anon か、ステージングプロジェクトか）。devops-engineer の決定事項（docs/operations/）。本計画は Preview に対しては構造だけを検査する前提。
- E-17 のサイズの上限値（S-01 120 KB など）は 04 §6 の見積もりから置いた仮の値。初回ビルドの実測で見直す。
- CSP の `script-src`（ADR 0008「結果」）が確定したら E-01 と S-11 の期待値を更新する。
- FR-05（CSV）、FR-61（シェア）を初回に含めるかで、U / E の項目を追加する。
- Q-36 は確定（2026-11-03）。I-DB-07 の対象（`pub_site_period_breakdown` の channel / device_pv / device_sessions）と U-22（G19、G20）に反映済み。E-05 の S-01 の期待値は 05 §3 の確定した構成に従う。
- 「Standard Protection」（06 §2.1、M-6）が Hobby で設定できるかの確認結果により、Preview スモーク（E-01〜E-05）の実行方法（Vercel Authentication のバイパストークンの要否）を決める。
