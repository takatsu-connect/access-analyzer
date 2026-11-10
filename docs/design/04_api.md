# 04 データ契約（公開ビューと埋め込み JSON）

- 状態: 確定（2026-11-04。依頼者の確認済み。実装時の確認項目は ADR 0009 にある）
- 更新日: 2026-11-06
- 関係: ADR 0006（ビルド時生成）、02_data_model.md §4（公開ビュー）、05_screens.md、06_security.md §7、NFR-11、NFR-42、NFR-91、FR-01、FR-03、FR-06
- 変更履歴:
  - 2026-11-03: 設計レビュー（audits/2026-11-03-design-review.md）の H-1・M-1〜M-8・L-1〜L-10 と Q-36 を反映（M-4 シェア数を初回対象外、M-5 author_count の削除、Q-36 channel / device を期間値に）
  - 2026-11-03: `packages/shared` の廃止に伴いパスを `apps/web/src/lib/` に変更（ADR 0004）。契約の内容は変わらない
  - 2026-11-03: analytics-advisor の画面レビュー（advice/2026-11-03-screens-review.md）と security-auditor の再確認（audits/2026-11-03-design-review-recheck.md）の残りを反映（ArticleDetailData の period から prev* を外す、AuthorPageData の siteMedianPostCount を削除、PostRow の band7 を埋め込まない、一覧の benchmark を n = 30 だけに、ActivityData.authorCounts は 1 本以上の著者だけ。N-1: pub_benchmark_curve と帯の列はビューが可視記事から計算するが列集合は変わらない）
  - 2026-11-04: 著者の除外（FR-36）を初回対象外に（依頼者の決定、ADR 0005 保留）。契約のコメントから除外後と除外込みの区別を外した（型は変えない）
  - 2026-11-06: 構築 3 の実装に合わせた（§3.9 に `yoyPostCount`、`yoyMonths`、`categoryIds` / `categoryPaths`、`topChannelByPeriod` の `'none'`、月の状態 `monthProgress` を追加。§5 に参照元ドメインの絞り込みとページのデータの検査の例外。§6 の実測を更新。§8 の ID の形と検索語の切り詰め）
  - 2026-11-05: 構築 3 の実装を反映（§3.9 にまとめた）。型の正は `apps/web/src/lib/page-data.ts`。区分の名前を `contracts/constants.json` に合わせ、数え始める前に公開した記事の印（`isPreMeasure`、`measureStart`）、著者ページのない著者（`authorSlug` が null）、読み出しの方法（§5）、JSON の大きさの実測（§6）を追記

## 1. 方針（HTTP API はない）

- この BI に HTTP API はない（ADR 0006 案 A）。Route Handler、Server Actions、Middleware を作らない。
- 「API」に当たるものは 2 つの契約である。
  1. **公開ビューの契約**: BI がビルド時に anon キーで読む `pub_*` ビューと列（02 §4）。読むのは `apps/web/src/data/` の 1 モジュールだけ。`pub_` 以外のテーブル名は lint で禁止する（07 §7）。
  2. **埋め込み JSON の契約**: 各ページが HTML に埋め込み、クライアントが期間切り替え・絞り込み・並べ替えに使うデータの形。型は `apps/web/src/lib/page-data.ts` に置き、ビルド時の組み立て（`apps/web/src/data/pages/*.ts`）とクライアント部品の両方が同じ型を使う。
- 利用者の操作（期間、フィルタ、並べ替え、検索語）はすべてクライアント側で、埋め込んだ JSON に対して行う。Supabase にも Vercel の関数にも、実行時のリクエストは発生しない（NFR-11、NFR-42）。
- 埋め込む値はすべて `pub_*` に載っている値か、その値から BI が計算した派生値（差、比率、順序、最多区分）に限る。`pub_*` にない値は埋め込めない。

## 2. ビルド時に読む公開ビューと列

02 §4 のビューを、ページごとに「読むビュー → 使う列」で列挙する。列はビューの全列ではなく、ここに書いた列だけを select する（`select('post_id, period_id, pageviews')` の形。`select('*')` は使わない）。

| ページ（05 §1 の ID） | 読むビュー | 使う列 | 絞り込み |
| --- | --- | --- | --- |
| 共通（全ページ） | pub_meta | base_date、finished_at、mask_threshold、is_stale、last_status | ― |
| 共通 | pub_period | period_id、kind、start_date、end_date、is_confirmed | ― |
| 共通（著者 slug・カテゴリ ID・月の許可リスト） | pub_author、pub_category、pub_post | author_slug、display_name / category_id、name、parent_id、path / published_on | ― |
| S-01 全体 | pub_site_daily | day、pageviews、sessions | 全行 |
| S-01 | pub_site_period | period_id、pageviews、sessions、active_users、engagement_seconds、days | 全行 |
| S-01 | pub_site_period_breakdown | period_id、axis、bucket、value | 全行（axis = sns / local / new_returning / channel / device_pv / device_sessions / dow / hour。channel と device_* は Q-36 の確定で期間値として格納。dow と hour はヒートマップの平均の列と行に使う（ADR 0003 判断 8）。02 §3.3） |
| S-01 | pub_site_daily_channel、pub_site_daily_device | ― | S-01 では読まない（日別推移に内訳を描かない。期間の構成は pub_site_period_breakdown の channel / device_* から。03 §17）。ビューは 05 §4.1 行 2 のとおり存在する |
| S-01 | pub_site_period_heatmap | period_id、dow、hour、pageviews | 全行 |
| S-01 | pub_site_period_freshness | period_id、freshness、post_count、pageviews | 全行 |
| S-01 | pub_site_month_referrer | period_id、rank、source_domain、sessions | 全行（is_confirmed の月のみ存在） |
| S-01 | pub_site_month_city | period_id、rank、region、city、sessions | 全行 |
| S-01 | pub_posting_period | period_id、post_count | 全行（author_count は置かない。設計レビュー M-5） |
| S-01 | pub_post | published_on | 全行（M-26 の日別公開本数を BI が数える） |
| S-01、S-02b、S-03、S-05 | pub_benchmark_curve | scope、n、p25、p50、p75、population_size、population_window | scope = all |
| S-02a〜S-02e、S-05、S-07 | pub_post | post_id、title、post_url、author_slug、display_name、published_on、is_ad、age_days、freshness | 全行 |
| S-02a〜S-02e、S-05、S-07 | pub_article_period | post_id、period_id、pageviews | 全行（4,500 行程度。`range()` で 1,000 行ずつ） |
| S-02b、S-02d、S-02e、S-05 | pub_article_summary | post_id、age_days、freshness、pv_7d、pv_30d、band_7d、band_30d、is_recent_hot、is_revival | 全行 |
| S-02e | pub_post_category、pub_post_tag | post_id、category_id / tag_id | 全行 |
| S-03 記事詳細 | pub_post | 上と同じ + is_ad | post_id = :id |
| S-03 | pub_post_category、pub_post_tag、pub_category、pub_tag | category_id、name、path / tag_id、name | post_id = :id |
| S-03 | pub_article_daily | day、pageviews | post_id = :id |
| S-03 | pub_article_cumulative | n、cumulative_pv | post_id = :id |
| S-03 | pub_article_period | period_id、pageviews、landing_sessions、scroll_count、engagement_seconds | post_id = :id |
| S-03 | pub_article_period_breakdown | period_id、axis、bucket、sessions | post_id = :id |
| S-03 | pub_article_referrer_30d | rank、source_domain、sessions | post_id = :id |
| S-03 | pub_article_summary | 全列（referrer_30d_computed_on を含む） | post_id = :id |
| S-03 | pub_article_milestone | milestone、reached_on | post_id = :id |
| S-03 | pub_author_summary | own_median_30d、eligible_count | author_slug = 記事の著者 |
| S-04 著者一覧 | pub_author | author_slug、display_name、author_url | 全行 |
| S-05 著者ページ | pub_author | author_slug、display_name、author_url | author_slug = :slug |
| S-05 | pub_author_period | period_id、post_count、pageviews、long_post_count、long_pageviews | author_slug = :slug |
| S-05 | pub_author_period_breakdown | period_id、axis、bucket、sessions | author_slug = :slug |
| S-05 | pub_author_category_period | category_id、period_id、post_count、pageviews | author_slug = :slug |
| S-05 | pub_author_summary | own_median_30d、eligible_count、band_30d | author_slug = :slug |
| S-05 | pub_article_milestone | post_id、milestone、reached_on | post_id in 著者の記事 |
| S-05 | pub_article_period_breakdown | post_id、period_id、bucket、sessions | post_id in 著者の記事、axis = channel（最多区分を BI が決める） |
| S-05 | pub_posting_period | ― | 読まない（FR-31 (a) の参考値「1 人あたりの中央値」は 2026-11-03 に削除。advice §5 高。05 §6.2） |
| S-05 | pub_site_period_breakdown | period_id、axis、bucket、value | axis = sns / channel（FR-33 の全体との比較。channel は Q-36 の確定で期間値） |
| S-06 カテゴリ | pub_category | category_id、name、parent_id、path | 全行 |
| S-06、S-06b | pub_category_period | category_id、period_id、pageviews、post_count_total、post_count_published、median_30d_pv、published_post_count_30d | 全行 |
| S-07 タグ | pub_tag、pub_tag_period | tag_id、name / tag_id、period_id、pageviews、post_count | 全行 |
| S-07b タグページ | pub_post_tag、pub_post、pub_article_period、pub_article_summary | 上と同じ | tag_id = :id |
| S-08 投稿活動 | pub_posting_monthly | month、post_count | 全行 |
| S-08 | pub_posting_period | period_id、post_count | 全行（author_count は置かない。M-5） |
| S-08 | pub_author、pub_author_period | display_name、author_slug / period_id、post_count | 全行（名前順は BI。display_name の `localeCompare('ja')`） |
| S-08 | pub_category、pub_category_period | path / period_id、post_count_published | 全行 |
| S-09 反応（FR-61） | ― | ― | 初回対象外（設計レビュー M-4）。シェア数の表・列・ビューはない。FR-61 を実装するときは NFR-39 で 05 §4.1 に行を追加してから、ここに行を足す |

- 読み出しは anon キー。環境変数名は `SUPABASE_URL`、`SUPABASE_ANON_KEY`（Vercel のビルド環境変数。`NEXT_PUBLIC_` を付けない。06 §3）。
- PostgREST の既定上限（1,000 行）を超えるビュー（pub_article_period、pub_article_daily の全体読み、pub_site_period_heatmap）は `range(from, to)` で 1,000 行ずつ読む。
- 1 ビルドでの読み出し回数の目安: 全表読み 25 ビュー × 1〜5 ページ ≒ 40 リクエスト。記事ごとの読み出し（S-03 で 225 回 × 8 ビュー）は避け、§5 の方針で「全行を 1 回読んでメモリで切り出す」。

## 3. ページごとの埋め込み JSON

### 3.1 共通部分（meta、periods、dictionary）

全ページに次を埋め込む（`PageCommon`）。

```ts
type PageCommon = {
  meta: {
    baseDate: string;        // 'YYYY-MM-DD'（JST 暦日。pub_meta.base_date）
    finishedAt: string;      // 'YYYY-MM-DDTHH:mm:ss+09:00'（pub_meta.finished_at を JST に変換）
    maskThreshold: number;   // 5
    isStale: boolean;        // pub_meta.is_stale
    builtAt: string;         // ビルド時刻（JST）。FR-02 の表示には使わず、トラブル時の手がかり
  };
  periods: Period[];         // 表示できる期間の一覧（移動窓 3 + 月。prev* は比較用で選択肢に出さない）
};

type Period = {
  id: PeriodId;              // 'last7' | 'last28' | 'last90' | 'm2025-10' …
  kind: 'window' | 'month';
  start: string; end: string; // 'YYYY-MM-DD'
  isConfirmed: boolean;      // 月のみ意味を持つ（window は常に false）
  label: string;             // '直近 28 日' / '2026 年 10 月'
  prevId: PeriodId | null;   // 比較の相手（前の期間）。last28 → prev28、m2026-10 → m2026-09。無ければ null
  yoyId: PeriodId | null;    // 月のみ。前年同月。無ければ null（「前年のデータなし」）
};
```

- 「選べる期間」は `last7`、`last28`、`last90`、`m2025-10` 以降の全月（基準日の属する月を含む）。`prev7` / `prev28` / `prev90` は選択肢に出さず、`prevId` の参照先としてだけ使う。
- 月の上限: 直近 36 か月まで埋め込む。超えた分は選択肢から外す（ADR 0006「将来」。3 年後に見直す。§9）。
- 画面の言葉と注記（glossary §1「添える注記」）は JSON に埋め込まず、`apps/web/src/lib/ui-text.ts`（1 つの辞書ファイル）に置く（05 §2.1）。

### 3.2 全体ダッシュボード（S-01、`/`）

```ts
type DashboardData = PageCommon & {
  daily: { firstDay: string; pageviews: (number)[]; sessions: (number)[] };   // 列指向。firstDay から 1 日 1 要素（欠けた日は 0 ではなく null にしない。欠けはバッチが許さない）
  publishedPerDay: { firstDay: string; counts: number[] };                     // M-26。pub_post.published_on を日ごとに数えた値
  sitePeriod: Record<PeriodId, { pageviews: number; sessions: number; activeUsers: number | null; engagementSeconds: number; days: number }>;
  breakdown: Record<PeriodId, {
    channel: Record<Channel, number | null>;          // 期間値（pub_site_period_breakdown の axis = channel、値は sessions。Q-36 確定。日別の合算ではない）
    sns: Record<SnsBucket, number | null>;
    device: Record<Device, { pageviews: number | null; sessions: number | null }>;  // 期間値（axis = device_pv / device_sessions。Q-36 確定）
    local: Record<'kawasaki' | 'jp_other' | 'unknown', number | null>;
    newReturning: Record<'new' | 'returning' | 'unknown', number | null>;
  }>;
  heatmapMargins: Record<PeriodId, { dow: (number | null)[]; hour: (number | null)[] }>;  // 曜日ごと 7 要素（添字 0 = 日曜）、時間帯ごと 24 要素の合計（axis = dow / hour。ADR 0003 判断 8）。行がない期間はない（平均を出さない）
  heatmap: Record<PeriodId, (number | null)[]>;      // 168 要素。index = dow * 24 + hour（dow 0 = 日曜。GA4 の dayOfWeek と同じ）。伏せは null（二次伏せを含む。L-1）
  freshness: Record<PeriodId, Record<Freshness, { postCount: number; pageviews: number }>>;   // 公開記事の合算。sitePeriod.pageviews（GA4 のサイト全体値。記事以外のページを含む）とは一致しない。注記は FR-10
  monthReferrer: Record<PeriodId, { domain: string; sessions: number }[]>;      // 確定月のみ。rank 順。T 未満の行は存在しない
  monthCity: Record<PeriodId, { region: string; city: string; sessions: number }[]>;
  posting: Record<PeriodId, { postCount: number }>;  // 人数（authorCount）は置かない（M-5、FR-51）
  benchmark30: { p25: number; p50: number; p75: number; populationSize: number; populationWindow: string } | null;  // M-27。母集団 30 未満は null
};
```

- 期間の切り替えに必要な行の集合: `sitePeriod` / `breakdown` / `heatmap` / `freshness` / `posting` は「選べる期間 + その prevId + yoyId」のすべて。`daily` は全日（前期間の線は `prevId` の start〜end を切り出す）。`monthReferrer` / `monthCity` は確定月すべて（移動窓を選んでいるときは「最新の確定月」と、その prev / yoy を表示する。FR-13、FR-15）。

### 3.3 記事一覧（S-02a〜S-02e、`/articles/*`）

一覧 5 画面は同じ `ArticleListData` を使い、画面ごとに含める記事の集合を絞る。

```ts
type PostRow = {
  id: number; title: string; url: string;
  authorSlug: string;        // href にだけ使う（§7）。画面に文字列として出さない
  authorName: string;
  publishedOn: string;       // 'YYYY-MM-DD'
  isAd: boolean; ageDays: number; freshness: Freshness;
  pv7: number | null; pv30: number | null;       // 未経過は null（画面は「◯日目」と現時点の累積）
  band30: Band | null;                            // 'upper' | 'middle' | 'lower'。公開から N 日目（N = min(ageDays, 30)）の累積を同じ N 日目の分布と比べた値（pub_article_summary.band_30d。02 §4.1 でビューが公開記事の母集団から計算）。null = まだ比較できません（ageDays < 3、母集団不足）。pub_article_summary.band_7d は画面で使わないので埋め込まない
  pvTotal: number;                                // 現時点の累積（未経過のときの表示と、S-03 の「公開からの合計」に使う）
  isRecentHot: boolean; isRevival: boolean;
  categoryIds: number[]; tagIds: number[];        // S-02e（検索）だけ。他は空配列
};
type ArticleListData = PageCommon & {
  posts: PostRow[];                               // この画面で表示しうる記事（is_ad は S-02e 以外では除く）
  pvByPeriod: Record<PeriodId, (number)[]>;       // posts と同じ順の列指向配列（pub_article_period.pageviews。伏せなし）
  topIndex?: Record<PeriodId, number[]>;          // S-02a / S-02c: 期間ごとの上位 50 の posts インデックス（降順）。他は省略
  categories: { id: number; name: string; parentId: number | null; path: string }[];   // S-02e と絞り込みの許可リスト
  authors: { slug: string; name: string }[];      // 絞り込みの許可リスト（名前順）
  benchmark: { p25: number; p50: number; p75: number } | null;                         // n = 30 の 1 行（文言「多くの記事は ◯〜◯回（真ん中は ◯回）」用）。母集団不足は null
};
```

- 一覧に埋め込む帯の情報は `band30`（3 値）と `benchmark`（n = 30 の 1 行）で足りる。`BandDot` の点は 3 区分の固定位置に置き、値に比例した位置を描かない（05 §2.4）ので、記事ごとの位置計算に p25 / p75 は要らない。n = 7 や n = ageDays の曲線は一覧には埋め込まない（`band30` がビュー側で同じ日数の曲線と比べた結果を持つ）。

- S-02a（よく読まれた記事）: `posts` は「いずれかの期間で上位 50 に入る記事」の和集合、`topIndex` に期間ごとの順序。順位の数字は埋め込まない（インデックス順が降順であるだけ）。
- S-02b（新着の立ち上がり）: `posts` は全記事（広告を除く）。期間内に公開された記事はクライアントが `publishedOn` で絞る。`pvByPeriod` は不要なので省略する。
- S-02c（長く読まれている記事）: `posts` は freshness = long のうち、いずれかの期間で上位 50 の和集合。`topIndex` あり。
- S-02d（最近よく読まれている記事）: `posts` は `isRecentHot || isRevival` の記事（最大 10 件。超えるときは直近 7 日の読まれた回数の降順で 10 件。02 の article_summary は件数を切らないため BI で切る）。期間に依存しない。
- S-02e（検索と絞り込み）: `posts` は全記事（広告を含む。広告は一覧の末尾ではなく公開日順のまま。FR-24 は広告を除くと書いていない。§9）。`pvByPeriod` は全期間。`categoryIds` / `tagIds` を持つ。

### 3.4 記事詳細（S-03、`/articles/[postId]`）

```ts
type ArticleDetailData = PageCommon & {
  post: PostRow & { categories: { id: number; path: string }[]; tags: { id: number; name: string }[] };
  daily: { firstDay: string; pageviews: number[] };                 // 公開日（または 2025-10-08 の遅い方）から基準日まで
  cumulative: (number | null)[];                                     // index 0 = 1 日目 … 89 = 90 日目。未経過は null
  benchmark: { p25: number[]; p50: number[]; p75: number[]; populationSize: number; populationWindow: string } | null;   // n = 1..90
  period: Record<SelectablePeriodId, { pageviews: number; landingSessions: number | null; scrollCount: number | null; engagementSeconds: number | null }>;   // 選べる期間だけ。prev7 / prev28 / prev90 の行を含めない（記事単位の前期間比を出さない。05 §5、advice §4 高）
  breakdown: Record<SelectablePeriodId, { channel: Record<Channel, number | null>; sns: Record<SnsBucket, number | null>; device: Record<Device, number | null> }>;   // 同上
  referrer30d: { status: 'ready'; rows: { domain: string; sessions: number }[] } | { status: 'pending' };   // pending = 「公開 30 日後に出ます」
  milestones: { milestone: 500 | 1000 | 5000 | 10000; reachedOn: string }[];
  isEvergreen365: boolean;
  ownMedian30d: { value: number } | null;                            // M-24。eligible_count < 5 は null。「◯◯さん」の名前は post.authorName
};
```

- `SelectablePeriodId` = `PeriodId` から `prev7` / `prev28` / `prev90` を除いた型（`apps/web/src/lib/page-data.ts`）。月の前月は選べる期間に含まれるが、S-03 はそれを比較に使わない（`compare()` を呼ばない）。
- 「公開からの合計」は `post.pvTotal`。帯の文の p25 / p50 / p75 は `benchmark` の n = 30（30 日未満の記事は n = `post.ageDays`）の要素を使う。
- `daily` は従来どおり公開日から基準日まで。S-03 の `LineChart` は前期間の線を描かない（05 §5）。

### 3.5 著者一覧（S-04、`/authors`）と著者ページ（S-05、`/authors/[slug]`）

```ts
type AuthorIndexData = PageCommon & { authors: { slug: string; name: string; url: string }[] };   // 名前順。数値なし

type AuthorPageData = PageCommon & {
  author: { slug: string; name: string; url: string };
  period: Record<PeriodId, { postCount: number; pageviews: number; longPostCount: number; longPageviews: number }>;
  breakdown: Record<PeriodId, { channel: Record<Channel, number | null>; sns: Record<SnsBucket, number | null> }>;
  siteBreakdown: Record<PeriodId, { channel: Record<Channel, number | null>; sns: Record<SnsBucket, number | null> }>;  // FR-33 の比較相手。channel は期間値（Q-36 確定）
  categoryMix: Record<PeriodId, { categoryId: number; path: string; postCount: number; pageviews: number }[]>;
  summary: { ownMedian30d: number | null; eligibleCount: number; band30: Band | null };   // FR-31 (b)（(e) を統合）。band30 は pub_author_summary.band_30d（ビューが計算。02 §4.1）
  posts: PostRow[];                                                  // 著者の記事
  pvByPeriod: Record<PeriodId, number[]>;                            // posts と同じ順
  topChannelByPeriod: Record<PeriodId, (Channel | null | 'none')[]>; // FR-32 の「流入の主な経路」。null は伏せ値、'none' は訪問なし（§3.9）
  milestones: { postId: number; milestone: number; reachedOn: string }[];
  benchmark: { p25: number; p50: number; p75: number } | null;       // n = 30 の 1 行（(b) の文言用）。母集団不足は null
};
```

- `siteMedianPostCount`（全著者の post_count の中央値。FR-31 (a) の参考値）は削除した（2026-11-03、advice §5 高。著者の本数の分布との比較で、比較の相手 3 つのどれでもない。05 §6.2）。他の著者の値から導く値は `siteBreakdown`（サイト全体の構成比。FR-33 の比較相手）だけ。
- (a) の前期間比は `period[prevId]` から `compare()` で差だけ出す（% は出さない）。

### 3.6 カテゴリ（S-06 `/categories`、S-06b `/categories/seasonal`）とタグ（S-07 `/tags`、S-07b `/tags/[id]`）

```ts
type CategoryData = PageCommon & {
  axes: { parent: { id: number; name: string }; children: { id: number; name: string }[] }[];   // 記事 / イベント / マップ / 広告 の順。広告は最後に別枠
  period: Record<PeriodId, Record<number /* categoryId */, { pageviews: number; postCountTotal: number; postCountPublished: number; median30: number | null; median30Count: number }>>;
};
type SeasonalData = PageCommon & {
  axes: CategoryData['axes'];
  months: PeriodId[];                                                // 直近 24 か月（存在する月だけ）
  pvByMonth: Record<number /* categoryId */, Record<PeriodId, number>>;
};
type TagIndexData = PageCommon & {
  tags: { id: number; name: string }[];                              // 名前順
  period: Record<PeriodId, Record<number, { pageviews: number; postCount: number }>>;   // postCount 0 のタグは行を含めない
};
type TagPageData = PageCommon & { tag: { id: number; name: string }; posts: PostRow[]; pvByPeriod: Record<PeriodId, number[]>; period: TagIndexData['period'] };
```

### 3.7 投稿活動（S-08、`/activity`）

```ts
type ActivityData = PageCommon & {
  monthly: { month: string; postCount: number }[];                   // 'YYYY-MM'。直近 24 か月
  posting: Record<PeriodId, { postCount: number }>;   // 人数は置かない（M-5）。主表示は「この期間に ◯本の記事が公開されました」
  authorCounts: Record<PeriodId, { name: string; slug: string; postCount: number }[]>;   // 名前順で固定。並べ替え不可（NFR-36）。**期間内に 1 本以上公開した著者だけ**（postCount ≥ 1。0 本の著者はビルド時に落とす。FR-51、advice §6 高）
  categoryMix: Record<PeriodId, { categoryId: number; path: string; postCountPublished: number }[]>;
};
```

### 3.8 反応指標（S-09、`/reactions`）

初回対象外（設計レビュー M-4）。`ReactionsData` 型、ページ、ナビ項目を作らない。FR-61 を実装するときは NFR-39 の手順で 05 §4.1 に「全体 × 期間 シェア数」「著者 × 期間 シェア数」の行を追加し、security-auditor のレビューを受けてから型を定義する。

共通の列挙型:

```ts
type Channel = 'search' | 'sns' | 'direct' | 'referral' | 'other';
type SnsBucket = 'instagram' | 'facebook' | 'x' | 'line' | 'other';
type Device = 'mobile' | 'desktop' | 'tablet';
type Freshness = 'new' | 'mid' | 'long';
type Band = 'upper' | 'middle' | 'lower';
```

`null` の意味は 1 つだけ: **伏せ値**（`pub_*` で null の値）。「該当なし」「まだ比較できません」「前年のデータなし」は、行や期間が**存在しない**か、専用の状態値（`referrer30d.status`、`band = null` は「比較できない」で例外として明記）で表す。画面側の描き分けは 05 §2.3。

### 3.9 構築 3 で確定した差分（2026-11-05）

上の §3.1〜§3.7 の型の記述より、こちらと `apps/web/src/lib/page-data.ts` を正とする。

- 区分の名前は `contracts/constants.json` を正とする。流入チャネルは `'search' | 'social' | 'direct' | 'referral' | 'other'`（上の `Channel` の `'sns'` は古い表記）、地元は `'kawasaki' | 'japan_other' | 'unknown'`（`'jp_other'` は古い表記）。
- `PageCommon.meta.measureStart`: 読まれた回数を数え始めた日（`'YYYY-MM-DD'`。設定値 `MEASURE_START` = バッチの `BACKFILL_START`。`contracts/constants.json` で突き合わせる）。
- `Period.id` は選べる期間（`SelectablePeriodId`）だけ。`prev7` / `prev28` / `prev90` は `prevId` の参照先としてだけ現れる。
- `PostRow.isPreMeasure`: 数え始める前に公開した記事（`publishedOn` < `measureStart`）。この記事は `pv7`、`pv30`、`band30` が null で、`pvTotal` は数え始めてからの合計。画面は null から不在の理由を推測せず、この印で文言を切り替える（advice/2026-11-05-pre-measurement-posts.md）。`pv7` / `pv30` の null は伏せ値ではなく「値がない」（まだその日数がたっていないか、数え始める前に公開した記事）。
- `PostRow.authorSlug` は `string | null`。著者ページを作るのは slug が `^[a-z0-9-]+$` の著者だけなので（06 §7）、それ以外の著者は null にし、画面は名前をリンクにしない。`ActivityData.authorCounts[].slug` も同じ。一覧の `authors[]` と `AuthorIndexData.authors` は、著者ページのある著者だけ。
- `ArticleDetailData.cumulative`: 数え始める前に公開した記事は空の配列（曲線を出さない。`pub_article_cumulative` に行がない）。
- `ArticleDetailData.benchmark` の `p25` / `p50` / `p75` は `(number | null)[]`。母集団が足りない n（ビューに行がない n）は null（伏せ値ではない）。
- `CategoryData` の `median30` の null は「該当なし」（伏せ値ではない）。
- 記事ごとの値（`pvByPeriod`、`topIndex`、`topChannelByPeriod`）と `authorCounts` に入れるのは、選べる期間だけ（比較用の `prev*` を入れない。記事では前の期間と比べないため）。集計値（サイト、著者、カテゴリ、タグ、公開本数）は、選べる期間とその `prevId`、`yoyId`。
- カテゴリの軸の順は、広告の軸（`category_id` が設定値 `AD_CATEGORY_ID` の親カテゴリ）を最後に、ほかの親は `category_id` の昇順。
- `pub_meta.last_status` は読むが、埋め込まない（画面で使わない）。

2026-11-06 に追加（画面の比較の決まり 05 §2.2.1 と、S-05・S-06b・S-08 の表示のため）:

- `ActivityData.monthly[].yoyPostCount: number | null`: 去年の同じ月の公開本数。24 か月より前の月も引く。数字がない（公開の記録より前の）月は null（伏せ値ではない）。
- `SeasonalData.yoyMonths: MonthId[]`: 24 か月の外にある、去年の同じ月（13〜24 か月前の月の「去年の同じ月と比べて」に使う。古い順）。図には描かない。カテゴリごとの読まれた回数は `months` と `yoyMonths` の両方の月について持つ。
- `AuthorPageData.posts[].categoryIds: number[]` と `AuthorPageData.categoryPaths: { id: number; path: string }[]`: 記事の一覧のカテゴリの列のため。`categoryPaths` は著者の記事に付いたカテゴリだけ（ID の順）。`categoryIds` を持つのは S-02e と S-05 だけで、ほかの画面では空の配列。
- `AuthorPageData.topChannelByPeriod` の値は `Channel | null | 'none'`。`'none'` は訪問がない（その期間の行がないか、全区分が 0）で、画面は「該当なし」と書く。null は伏せ値（最多の区分が伏せ値の側にある）。§3.5 の旧記述「全区分が伏せなら null」より、こちらを正とする。
- 月の状態（確定 / 集計中 / 月の途中）は JSON に持たない。`Period` の `end` と `isConfirmed` から `monthProgress()`（`apps/web/src/lib/derive/periods.ts`。値は `'confirmed' | 'settling' | 'inProgress'`）で導く。数え始めた月の開始日は `partialMonthStartDay()` で `meta.measureStart` から導く。

## 4. 型定義（apps/web/src/lib）

- `apps/web/src/lib/pub-types.ts`: 公開ビューの行の型（`PubMeta`、`PubPeriod`、`PubPost`、`PubArticlePeriod`、…）。02 §4 の表と列名・型を一致させ、手書きで固定する。`supabase gen types` の出力と突き合わせるテストを置く（01 §4、07 §3）。
- `apps/web/src/lib/page-data.ts`: §3 の `PageCommon` と各 `*Data` 型。`zod` スキーマは `apps/web/src/lib/page-data-schema.ts` に置き（構築 3。クライアントの部品が型だけを読み、`zod` を読み込まないようにするため）、ビルド時に組み立てた JSON を一度 `parse` してから埋め込む（列の欠け・型違いをビルド失敗で検出する）。型とスキーマのずれはコンパイルで検出する。
- `apps/web/src/lib/ui-text.ts`: 画面の言葉と注記の辞書（05 §2.1）。
- `apps/web/src/lib/query.ts`: URL クエリの許可リスト検証（§8）。
- 列指向配列（`pvByPeriod` など）は `posts` の順序に依存する。順序は `post_id` 昇順で固定し、組み立て関数が保証する。

## 5. `apps/web/src/data/` の関数一覧

読み出し層（`apps/web/src/data/pub/*.ts`）。すべてビルド時にだけ実行される（`generateStaticParams` とページの Server Component から呼ぶ）。

| 関数 | 入力 | 出力 | 読むビュー |
| --- | --- | --- | --- |
| `loadAll()` | なし | `PubCache`（下の全ビューの全行をメモリに持つ。React の `cache()` でビルド中 1 回だけ実行） | 下の全ビュー |
| `getMeta()` | ― | `PubMeta` | pub_meta |
| `getPeriods()` | ― | `PubPeriod[]` | pub_period |
| `getPosts()` | ― | `PubPost[]`（post_id 昇順） | pub_post |
| `getAuthors()` | ― | `PubAuthor[]` | pub_author |
| `getCategories()` / `getTags()` | ― | `PubCategory[]` / `PubTag[]` | pub_category / pub_tag |
| `getPostCategories()` / `getPostTags()` | ― | 対応表 | pub_post_category / pub_post_tag |
| `getSiteDaily()` / `getSiteDailyChannel()` / `getSiteDailyDevice()` | ― | 日別行 | pub_site_daily / pub_site_daily_channel / pub_site_daily_device |
| `getSitePeriod()` / `getSitePeriodBreakdown()` / `getSiteHeatmap()` / `getSiteFreshness()` | ― | 期間別行 | pub_site_period / pub_site_period_breakdown / pub_site_period_heatmap / pub_site_period_freshness |
| `getSiteMonthReferrer()` / `getSiteMonthCity()` | ― | 確定月の行 | pub_site_month_referrer / pub_site_month_city |
| `getArticleDailyAll()` | ― | `PubArticleDaily[]`（約 40,000 行。1,000 行ずつ `range`。S-03 の 225 ページで共有） | pub_article_daily |
| `getArticleCumulativeAll()` | ― | 約 20,000 行 | pub_article_cumulative |
| `getArticlePeriodAll()` / `getArticlePeriodBreakdownAll()` | ― | 約 4,500 / 60,000 行 | pub_article_period / pub_article_period_breakdown |
| `getArticleReferrer30dAll()` / `getArticleSummaryAll()` / `getArticleMilestoneAll()` | ― | 全行 | 対応するビュー |
| `getAuthorPeriodAll()` / `getAuthorPeriodBreakdownAll()` / `getAuthorCategoryPeriodAll()` / `getAuthorSummaryAll()` | ― | 全行 | 対応するビュー |
| `getCategoryPeriodAll()` / `getTagPeriodAll()` | ― | 全行 | pub_category_period / pub_tag_period |
| `getPostingMonthly()` / `getPostingPeriod()` | ― | 全行 | pub_posting_monthly / pub_posting_period |
| `getBenchmarkCurve()` | ― | scope = all の行（n = 1〜90。母集団 30 未満の n は行がない）。ビューが公開記事から計算した値（02 §4.1） | pub_benchmark_curve |

読み出しの実装（構築 3 で確定）:

- `loadAll()` は、プロセスの中で 1 回だけ読む（モジュール内の Promise を使い回す）。React の `cache()` の範囲は 1 回のレンダリングなので、それだけではページごとに読み直すことになる。ビルドのワーカーが複数なら、ワーカーの数だけ読む。
- 画面で使うビューだけを読む。`pub_site_daily_channel`、`pub_site_daily_device`、`pub_batch_run` は読まない（行の型とスキーマは、公開ビューの契約の検査のために持つ）。
- すべてのビューを、主キーの順で 1,000 行ずつ読み、空のページが返ったら終える。サーバー側の上限が 1,000 行より小さく設定されたときに、途中で切れたまま気づかないのを防ぐため。1 回の `loadAll()` は約 80 リクエストになる（§2 の目安の約 40 より多い）。
- 行は `zod` で検証する。定義にない区分や軸の行があれば、捨てずにビルドを失敗させる。読み出しのエラーに入れるのはビュー名だけ（URL、キー、行の値を出さない）。
- 組み立てたページのデータの検査（`zod` の `parse`）が失敗したときも、行の値を含まない固定の文の例外にする（監査 L-5）。
- 参照元ドメイン（`monthReferrer`、`referrer30d`）は、ドメインの形でない行（括弧つきの値、空白や記号を含む値、長すぎる値）を表から落とす（監査 L-3）。完全な参照 URL や GA4 の特殊な値を表に出さないため。
- 公開ビューの列の集合と型は、`tests/snapshots/pub-columns.json`（I-DB-16 のスナップショット）と Vitest で突き合わせる（07 U-20 の `supabase gen types` の代わり）。

組み立て層（`apps/web/src/data/pages/*.ts`）。`PubCache` から各ページの JSON を作り、`zod` で検証して返す。

| 関数 | 入力 | 出力 | 備考 |
| --- | --- | --- | --- |
| `buildCommon(cache)` | ― | `PageCommon` | periods の label / prevId / yoyId を計算。月は直近 36 か月 |
| `buildDashboard(cache)` | ― | `DashboardData` | §3.2 |
| `buildArticleList(cache, kind)` | kind: `top` / `new` / `long` / `recent` / `search` | `ArticleListData` | §3.3 |
| `buildArticleDetail(cache, postId)` | post_id | `ArticleDetailData` または `null`（pub_post にない = 404） | §3.4 |
| `listArticleIds(cache)` | ― | `number[]` | `generateStaticParams` 用。pub_post の post_id のみ |
| `buildAuthorIndex(cache)` / `buildAuthorPage(cache, slug)` / `listAuthorSlugs(cache)` | ― / slug | `AuthorIndexData` / `AuthorPageData` または `null` / `string[]` | §3.5。slug は `^[a-z0-9-]+$` を満たすものだけ（06 §7） |
| `buildCategories(cache)` / `buildSeasonal(cache)` | ― | `CategoryData` / `SeasonalData` | §3.6 |
| `buildTagIndex(cache)` / `buildTagPage(cache, tagId)` / `listTagIds(cache)` | ― / tag_id | §3.6 | タグの記事が 0 本なら null = ページを作らない |
| `buildActivity(cache)` | ― | `ActivityData` | §3.7 |
| `buildReactions(cache)` | ― | `ReactionsData` | FR-61 を含めるときだけ |

共通の派生計算（`apps/web/src/lib/derive/`。バッチとは別。表示用）: `compare(cur, prev)` → `{ diff, ratio | null }`（分母 20 未満は ratio = null）、`share(values)` → 構成比（伏せ値を含む行は分母を「表示している値の和」ではなく**合計列**にし、伏せ値セルの構成比は出さない）、`topChannel(record)`（最多の区分。訪問がない = 行なしか全区分 0 なら `'none'`、最多が伏せ値の側なら null）、`fold6(heatmap168)`（スマホの 6 区分）、`unconfirmedFrom(baseDate)`（直近 3 日）、`latestConfirmedDay(baseDate)`（グラフの固定行の既定日 = 基準日 − 3 日。05 §2.6）。`median(numbers)` は `siteMedianPostCount` の削除で使う場所がなくなったため置かない（`quantiles` / `band` は `apps/batch/tests/support/reference.py` にテスト用の参照実装として置く。07 U-07、U-08、I-DB-17）。

## 6. サイズの見積もりと絞り込み

前提: 記事 225 本、月 13（2025-10〜2026-11）、選べる期間 16、比較用 prev 3 = 期間 19。JSON は gzip / brotli で約 1/4 になる（数値の配列は 1/5 以下）。目安は **埋め込み JSON 60 KB（raw）以下、記事詳細は 50 KB 以下**。

| ページ | 主な内訳（raw） | 合計の目安 | 増え方 |
| --- | --- | --- | --- |
| S-01 全体 | daily 390 日 × 2 列 ≒ 4 KB、heatmap 19 × 168 ≒ 13 KB、breakdown 19 × 約 20 セル ≒ 8 KB、monthReferrer / monthCity 13 × 10 行 ≒ 12 KB、publishedPerDay ≒ 2 KB、その他 ≒ 5 KB | **約 45 KB** | 年 +15 KB（heatmap 12 期間、月の参照元・市別 12 か月、日別 365 日） |
| S-02a 上位 | posts（和集合 100〜150 本 × 150 B）≒ 20 KB、topIndex 19 × 50 ≒ 4 KB | 約 25 KB | 月 +0.2 KB |
| S-02b 新着 | posts 225 × 160 B ≒ 36 KB、benchmark ≒ 0.1 KB | 約 36 KB | 記事 +160 B / 本 |
| S-02c 長く | posts 和集合 ≒ 15 KB、topIndex ≒ 4 KB | 約 20 KB | ― |
| S-02d 最近 | posts ≤ 10 | 約 3 KB | ― |
| S-02e 検索 | posts 225 × 180 B（category / tag ID を含む）≒ 40 KB、pvByPeriod 19 × 225 ≒ 17 KB、categories / authors ≒ 3 KB | **約 60 KB** | 記事 +250 B / 本、月 +1 KB |
| S-03 記事詳細 | daily ≤ 390 × 4 B ≒ 1.6 KB、cumulative 0.4 KB、benchmark 90 × 3 ≒ 1.5 KB、period 16 × 80 B ≒ 1.3 KB（prev* を含めない）、breakdown 16 × 13 セル ≒ 3.5 KB、その他 ≒ 1.5 KB | **約 10 KB** | 年 +3 KB。50 KB を超える見込みはない |
| S-05 著者（最大、120 本） | posts 120 × 150 B ≒ 18 KB、pvByPeriod 19 × 120 ≒ 9 KB、topChannel 19 × 120 ≒ 8 KB、breakdown / categoryMix ≒ 8 KB | 約 45 KB（典型は 10 KB） | 記事 +250 B / 本 |
| S-06 / S-06b / S-07 / S-08 | 期間 × カテゴリ（約 30）またはタグ（約 50） | 各 10〜20 KB | 月 +1 KB |

実測（2026-11-05、構築 3。架空の記事 42 本、選べる期間 17 のフィクスチャ）: どの画面も目安の中（S-01 35 KB、S-02e 21 KB、S-03 最大 11 KB、S-05 最大 29 KB。2026-11-06 の構築 3 の修正後は S-05 最大 30.9 KB。`categoryIds` / `categoryPaths` の追加による。ほかの画面の値は 2026-11-05 のまま）。ただし `PostRow` は 1 本あたり約 420 B（上の見積もりは 180 B。行ごとにキー名を繰り返すため）で、記事が 225 本になると S-02e は約 99 KB、S-02b は約 87 KB になる見込み。本番のデータで実測してから、下の案に加えて、`PostRow` を列指向にする、URL をパスだけにする、を検討する。

HTML 全体はこれに初期表示の DOM（既定期間 = 直近 28 日の描画分）が加わる。

HTML の大きさの目安（2026-11-06 に見直し）: 初期表示の DOM は、図（SVG）と同じ値の表で未圧縮のまま大きくなる（実測で S-01 180 KB のうち SVG 76 KB、表 31 KB、埋め込み 47 KB）が、繰り返しが多く gzip で 1/8 前後に縮む（S-01 21 KB、S-03 最大 13 KB、S-02e 12 KB）。NFR-10 は表示の速さの要件で、効くのは転送量なので、目安は **gzip 後の HTML で S-01 40 KB、S-02e 50 KB、S-03 20 KB** とし、`pnpm run check:build` で検査する。閉じた折りたたみの中身を開くまで描かない案は、ページ内検索と JavaScript なしの表示を損ねるので採らない。S-02e は上限に近いので、超えたときの順に次の案を用意する。

1. S-02e の `pvByPeriod` を「選べる移動窓 3 + 直近 12 か月」に絞る（並べ替えは絞り込み時にだけ使う列なので影響は小さい）。
2. S-01 の `heatmap` と `monthReferrer` / `monthCity` を直近 24 か月に絞る。
3. 期間別の行を静的 JSON（`public/data/<page>/<periodId>.json`。ビルド前スクリプトで生成）に分け、既定期間だけを埋め込み、他の期間は `fetch` で遅延取得する（CSP の `connect-src 'self'` の範囲内）。ADR 0006 の「将来」に当たる変更で、`apps/web/src/data/` の組み立て層の出力先を変えるだけで済む。

## 7. 埋め込まない列・値

- `_mask` 列: ビューにないので埋め込めない（02 §2.3）。一次伏せ・二次伏せの区別は JSON に現れない。
- `author_slug`: `PostRow.authorSlug`、`authors[].slug` として JSON には入るが、**画面に文字列として描かない**。使うのは `href`（`/authors/<slug>` と `pub_author.author_url`）だけ（NFR-35、FR-30）。
- 著者の WordPress ユーザー ID、メール、アバター: ビューにない。
- 伏せる前の値、生の行データ（訪問・ユーザー・イベント）: ビューにない。
- 順位の数字: 埋め込まない。`topIndex` は順序を持つ配列だが、画面は番号を付けない（NFR-36）。
- 全記事の `pvByPeriod` を持つのは S-02e と S-05 だけで、S-02e では絞り込みなしでは並べ替えに使わない（FR-24）。JSON に全記事の期間 PV が入ること自体は、記事詳細（公開ページ）に同じ値が載るため新しい露出ではない。
- 市別 / 参照元ドメインの移動窓の値、記事 × 地域、記事 × 曜日 × 時間帯: ビューにない。

## 8. クライアント側の許可リスト検証

`apps/web/src/lib/query.ts` の `parseQuery(search, allow)` が、URL のクエリを検証済みの状態に変える。許可されない値は**無視して既定値**にし、エラーを出さない（NFR-91、FR-03）。URL への書き戻し（`history.replaceState`）は検証済みの値だけで行い、未知のパラメータは落とす。

| パラメータ | 形式（正規表現） | 許可リスト | 既定 | 使う画面 |
| --- | --- | --- | --- | --- |
| `p`（期間） | `^(last7\|last28\|last90\|m\d{4}-(0[1-9]\|1[0-2]))$` | かつ `periods[].id` に存在する（prev* は不可） | `last28` | 全画面 |
| `cat`（カテゴリ） | `^[1-9][0-9]{0,9}$`（`ID_PATTERN`） | かつ `categories[].id` に存在する | なし | S-02e |
| `author`（著者） | `^[a-z0-9-]{1,64}$`（`SLUG_PATTERN`） | かつ `authors[].slug` に存在する | なし | S-02e |
| `ym`（公開年月） | `^\d{4}-(0[1-9]\|1[0-2])$` | かつ `posts[].publishedOn` の年月のいずれか | なし | S-02e |
| `q`（タイトル検索） | 長さ 1〜50（NFC 正規化、前後の空白を除く。50 文字を超える分は切る） | ―（埋め込んだタイトルに対する `includes` にだけ使う。描画は React のテキストノード） | なし | S-02e |
| `sort` | `^(pv\|pv7\|pv30)$` | `author` / 子カテゴリの `cat` / `ym` のいずれかが有効なときだけ受け付ける。親カテゴリだけのとき、絞り込みなしのときは無視（FR-24、NFR-98） | 公開日順（降順） | S-02e、S-05（S-05 は常に受け付ける） |
| `n`（件数） | `^(20\|50)$` | ― | `20` | S-02a、S-02c |
| `line` | `^(pv\|sessions)$` | ― | `pv` | S-01（FR-11） |
| `heat` | `^(avg\|sum)$` | ― | `avg` | S-01（FR-12） |
| `axis`（カテゴリ軸の展開） | `^(parent\|child)$` | ― | `parent` | S-06b（FR-41） |

- 「子カテゴリ」の判定は `categories[].parentId !== null`。
- ID の形（`ID_PATTERN` = `^[1-9][0-9]{0,9}$`。カテゴリ、記事、タグ）と著者の slug の形（`SLUG_PATTERN` = `^[a-z0-9-]{1,64}$`）は `src/lib/query.ts` の 1 か所で定義し、ほかの場所はこれを使う（構築 3）。
- `q` は入力欄の文字で絞り込み、URL への書き戻しは打つのをやめて 300 ミリ秒後（05 §4.5）。
- 期間 `p` が無効なときは既定（`last28`）に戻すだけで、他のパラメータは個別に判定する（1 つの不正値で全部を捨てない）。
- `parseQuery` は純関数で、Vitest で表の全行を検査する（07 §3）。E2E では不正値を URL に与えて既定表示になることを確認する（07 §6）。
- 動的ルートのパラメータ（`[postId]`、`[slug]`、`[id]`）は `generateStaticParams` と `dynamicParams = false` で閉じるので、クライアント側の検証対象にならない（06 §7）。

## 9. 未確定

- Q-36 は確定（2026-11-03）: `site_period_breakdown` の axis `channel` / `device_pv` / `device_sessions` を期間ごとに GA4 から取る（02 §3.3、03 §5.4 G19・G20、ADR 0003 判断 6）。§3.2 の `breakdown.channel` / `device` は必須の期間値になり、暫定の日別合算は使わない。
- 月の埋め込み上限（36 か月）と、S-02e のサイズが上限を超えたときの案の順（§6）は設計の判断で、依頼者への質問ではない。実測はビルドの出力サイズで確認する（07 §6）。
- S-02e（検索）に広告カテゴリの記事を含めるか。FR-24 は除外を書いていないため含める。FR-20 / FR-22 / S-02b は除く。依頼者への確認は不要と見るが、05 §13 に記す。
- シェア数（FR-61、`pub_author_period_share`）は初回対象外で確定（設計レビュー M-4）。未確定ではない。
- 2026-11-03 の画面レビュー反映で変えた契約（確定。依頼者への質問ではない）: `ArticleDetailData.period` / `breakdown` から prev* を外した（記事単位の前期間比を出さない）、`AuthorPageData.siteMedianPostCount` を削除、`PostRow.band7` を埋め込まない、一覧の `benchmark` を n = 30 の 1 行に、`ActivityData.authorCounts` は 1 本以上の著者だけ。公開ビューの列は変わらない（N-1 の対策はビューの計算方法の変更で、02 §4.1）。
- `PostRow.band30` の意味（N = min(ageDays, 30) 日目の帯）は 02 §4.1 のビューに依存する。ビューの `band_30d` の定義を変えるときは本書 §3.3 と 05 §4.2 も合わせる。
