"""BI（apps/web）の開発と E2E で使うフィクスチャ（07 §10）。値はすべて架空。

基準日（D）を受け取り、偽の WP（`build_wp`）と偽の GA4 の応答（`ga4_responses`）を返す。
乱数も時計も使わないので、同じ基準日なら同じ結果になる。読み込みは
`python -m support.load_e2e_fixture` が、本物の日次バッチ（backfill）を通して行う。
伏せ値と派生指標はバッチが計算するので、ここには入力（GA4 と WP が返す値）だけを置く。

## 著者

| slug | 表示名 | 記事 | 場面 |
| --- | --- | --- | --- |
| author-a | 架空 一郎 | 101〜103 | 直近 28 日に公開あり。階層差分（注 1） |
| author-b | 架空 二子 | 111、112、生成 18 本 | 「これまでの記事」の中央値が出る |
| author-c | 架空 三太 | 106、107、109、110、生成 12 本 | 直近 28 日に公開なし（注 2） |
| author-d | 架空 四葉 | 104、105、108 | 記事が 5 本未満（中央値が出ない） |

- 注 1: 102 だけ、last28 の流入チャネルの social が 4 で伏さる。著者の social は 102 だが、
  ほかの 2 本との差から 4 が分かるので伏さる。そのあと二次伏せで direct も伏さる。
- 注 2: 記事はすべて公開から 91 日以上。last28 は公開が 0 本で、読まれた回数だけがある。

## 名前つきの記事（ID 101〜112）

著者の列は slug の末尾（a = author-a）。D は基準日。

| ID | 公開日 | 著者 | カテゴリ | 場面 |
| --- | --- | --- | --- | --- |
| 101 | D − 1 | a | 11 | 公開から 2 日目（まだ比較できません） |
| 102 | D − 6 | a | 11、12 | 公開から 7 日目。last28 の訪問回数と social が 4 |
| 103 | D − 28 | a | 21 | 公開から 29 日目。D − 3 に累積が 500 回を超える |
| 104 | D − 29 | d | 11 | 公開から 30 日目。D − 5 に累積が 1,000 回を超える |
| 105 | D − 40 | d | 3 | 最近よく読まれている |
| 106 | D − 150 | c | 12 | 久しぶりに読まれた（最近よく読まれている、も付く） |
| 107 | 計測開始日 − 60 | c | 1 | 計測開始より前に公開。1 年たっても読まれています |
| 108 | D − 60 | d | 188 | 広告の記事 |
| 109 | D − 100 | c | 11 | 直近 28 日の読まれた回数がちょうど 19 |
| 110 | D − 120 | c | 12 | 直近 28 日の読まれた回数がちょうど 20 |
| 111 | D − 200 | b | 21 | last28 の scroll が 3（伏さる）。リンク元が 2 つ |
| 112 | D − 45 | b | 2 | 公開後 30 日時点のリンク元が 2 つ |

- 102 は複数の子カテゴリ（11 と 12）に入る。102 と 112 はタグを 2 つ持つ。
- 104 は D − 17 に累積が 500 回も超える。105 と 106 は、直近 7 日が 210 回と 175 回、
  その前の 28 日が 28 回。107 は直近 28 日に 56 回。
- 公開後 30 日時点のリンク元は、30 日目の 104 と 32 日目の 201 にはまだ出ない
  （バッチが計算するのは、もう少し日がたってから）。106 は 1 つ、111 と 112 は 2 つ。

## 生成する記事（ID 201〜230）

広告でなく、計測開始後に公開、公開から 31 日以上（ID 201 + i の公開日は D − (31 + 10 i)）。
全記事の分布（`pub_benchmark_curve` の scope = all）の母集団を 30 本以上にするためにある。
公開から 91 日以上で i が奇数のものは author-c、ほかは author-b。
期間別の値（訪問回数など）は持たない。i が 5 の倍数のものは、リンク元を 2 つ持つ。

## カテゴリとタグ

- 親: 1 = 記事、2 = イベント、3 = マップ、188 = 広告。
- 子: 11・12（親 1）、21（親 2）。22（親 2）は記事が 1 本もない。
- タグ: 51、52 は使われている。53 は記事が 1 本もない。

## 全体の伏せ値の場面

| 期間 | 軸 | 入力 | 結果 |
| --- | --- | --- | --- |
| last28 | SNS | x だけ 4、ほかに 5 以上がある | 二次伏せが起きる（null が 2 つ） |
| last28 | 初めて・また来た | 「不明」の行がない | unknown は 0 のまま出る |
| last28 | 曜日 × 時間帯 | 火曜 4 時だけ 3 | 二次伏せが起きる（null が 2 つ） |
| last7 | SNS | x だけ 4、ほかは 0 | 二次伏せが起きない（null が 1 つ） |
| last90 | 地元 | japan_other と unknown が 4 | 二次伏せが起きない（null が 2 つ） |

曜日 × 時間帯は、どの期間も 3 時台が 0（0 のまま出る）。確定月の参照元ドメインと市別は、
しきい値以上の行が 4 つと、しきい値未満の行（格納されない）が 1 つある。
"""

import calendar
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Final

from support.fake_ga4 import FakeRow
from support.fake_wp import FakeWp, wp_post, wp_user
from takatsu_batch.config import AD_CATEGORY_ID, BACKFILL_START, WINDOW_DAYS

MEASUREMENT_START: Final = date.fromisoformat(BACKFILL_START)
# 生成する記事の公開日（最大で D − 321）が計測開始後になり、107 が公開から 365 日以上になる下限
MIN_BASE_DATE: Final = MEASUREMENT_START + timedelta(days=330)

AUTHORS: Final[dict[int, tuple[str, str]]] = {
    7: ("author-a", "架空 一郎"),
    8: ("author-b", "架空 二子"),
    9: ("author-c", "架空 三太"),
    10: ("author-d", "架空 四葉"),
}
AUTHOR_A, AUTHOR_B, AUTHOR_C, AUTHOR_D = 7, 8, 9, 10

CATEGORY_ARTICLE, CATEGORY_EVENT, CATEGORY_MAP = 1, 2, 3
CHILD_TOPIC, CHILD_SHOP, CHILD_SEASON, CHILD_EMPTY = 11, 12, 21, 22
TAG_WALK, TAG_FAMILY, TAG_EMPTY = 51, 52, 53

NAMED_POST_IDS: Final = tuple(range(101, 113))
GENERATED_POST_IDS: Final = tuple(range(201, 231))
PRE_MEASUREMENT_POST_ID: Final = 107

_CHANNEL: Final = "sessionDefaultChannelGroup"
_INSTAGRAM, _FACEBOOK, _X, _LINE = "l.instagram.com", "m.facebook.com", "t.co", "line.me"
_WINDOW_SCALE: Final = {
    "last7": 7,
    "prev7": 6,
    "last28": 28,
    "prev28": 25,
    "last90": 90,
    "prev90": 80,
}
# 記事 × 期間 の値を、式ではなく手で決める組（記事 ID, 期間 ID）→ (チャネル別, SNS 別, 端末別)
_WHOLE_LIFE_WINDOWS: Final = ("last7", "last28", "last90")
_NAMED_TITLES: Final = {
    101: "商店街の朝市だより",
    102: "川沿いの散歩道",
    103: "公園の花壇づくり",
    104: "図書館の読み聞かせ会",
    105: "町内の夏まつり",
    106: "坂道の写真めぐり",
    107: "昔の地図を歩く",
    108: "お知らせの枠",
    109: "手づくり市の準備",
    110: "音楽会の舞台裏",
    111: "地域の防災訓練",
    112: "冬のあかり巡り",
}


@dataclass(frozen=True, slots=True)
class PostSpec:
    post_id: int
    published_on: date
    author: int
    categories: tuple[int, ...]
    tags: tuple[int, ...] = ()


def _check_base(base: date) -> None:
    if base < MIN_BASE_DATE:
        raise ValueError("基準日が早すぎる（計測開始日から 330 日以上あとにする）")


def named_posts(base: date) -> list[PostSpec]:
    """名前つきの記事 12 本。場面は冒頭の表のとおり。"""

    def ago(days: int) -> date:
        return base - timedelta(days=days)

    return [
        PostSpec(101, ago(1), AUTHOR_A, (CHILD_TOPIC,), (TAG_WALK,)),
        PostSpec(102, ago(6), AUTHOR_A, (CHILD_TOPIC, CHILD_SHOP), (TAG_WALK, TAG_FAMILY)),
        PostSpec(103, ago(28), AUTHOR_A, (CHILD_SEASON,)),
        PostSpec(104, ago(29), AUTHOR_D, (CHILD_TOPIC,), (TAG_FAMILY,)),
        PostSpec(105, ago(40), AUTHOR_D, (CATEGORY_MAP,)),
        PostSpec(106, ago(150), AUTHOR_C, (CHILD_SHOP,)),
        PostSpec(107, MEASUREMENT_START - timedelta(days=60), AUTHOR_C, (CATEGORY_ARTICLE,)),
        PostSpec(108, ago(60), AUTHOR_D, (AD_CATEGORY_ID,)),
        PostSpec(109, ago(100), AUTHOR_C, (CHILD_TOPIC,)),
        PostSpec(110, ago(120), AUTHOR_C, (CHILD_SHOP,), (TAG_WALK,)),
        PostSpec(111, ago(200), AUTHOR_B, (CHILD_SEASON,)),
        PostSpec(112, ago(45), AUTHOR_B, (CATEGORY_EVENT,), (TAG_WALK, TAG_FAMILY)),
    ]


def generated_posts(base: date) -> list[PostSpec]:
    """生成する記事 30 本。公開日、著者、カテゴリ、タグは ID から決まる。"""
    category_cycle = ((CHILD_TOPIC,), (CHILD_SHOP,), (CHILD_SEASON,), (CATEGORY_MAP,))
    tag_cycle: tuple[tuple[int, ...], ...] = ((TAG_WALK,), (TAG_FAMILY,), ())
    posts = []
    for index, post_id in enumerate(GENERATED_POST_IDS):
        days_since_publish = 31 + 10 * index
        author = AUTHOR_C if days_since_publish >= 91 and index % 2 == 1 else AUTHOR_B
        posts.append(
            PostSpec(
                post_id,
                base - timedelta(days=days_since_publish),
                author,
                category_cycle[index % len(category_cycle)],
                tag_cycle[index % len(tag_cycle)],
            )
        )
    return posts


def all_posts(base: date) -> list[PostSpec]:
    _check_base(base)
    return [*named_posts(base), *generated_posts(base)]


def _title(post_id: int) -> str:
    topic = _NAMED_TITLES.get(post_id)
    if topic is None:
        topic = f"まちの記録 その {post_id - GENERATED_POST_IDS[0] + 1}"
    return f"架空の記事 {post_id} {topic}"


def build_wp(base: date) -> FakeWp:
    """偽の WP（カテゴリ 8 つ、タグ 3 つ、著者 4 人、記事 42 本）。"""
    return FakeWp(
        categories=[
            {"id": CATEGORY_ARTICLE, "name": "記事", "parent": 0},
            {"id": CATEGORY_EVENT, "name": "イベント", "parent": 0},
            {"id": CATEGORY_MAP, "name": "マップ", "parent": 0},
            {"id": AD_CATEGORY_ID, "name": "広告", "parent": 0},
            {"id": CHILD_TOPIC, "name": "まちの話題", "parent": CATEGORY_ARTICLE},
            {"id": CHILD_SHOP, "name": "お店の紹介", "parent": CATEGORY_ARTICLE},
            {"id": CHILD_SEASON, "name": "季節の催し", "parent": CATEGORY_EVENT},
            {"id": CHILD_EMPTY, "name": "これからの催し", "parent": CATEGORY_EVENT},
        ],
        tags=[
            {"id": TAG_WALK, "name": "散歩"},
            {"id": TAG_FAMILY, "name": "親子"},
            {"id": TAG_EMPTY, "name": "準備中"},
        ],
        users={user_id: wp_user(slug, name) for user_id, (slug, name) in AUTHORS.items()},
        posts=[
            wp_post(
                spec.post_id,
                # UTC の 3 時は JST の 12 時。公開日は JST でも同じ日になる
                date_gmt=f"{spec.published_on.isoformat()}T03:00:00",
                author=spec.author,
                categories=list(spec.categories),
                tags=list(spec.tags),
                title=_title(spec.post_id),
            )
            for spec in all_posts(base)
        ],
    )


# 109 と 110 の、直近 28 日の読まれた回数（基準日の何日前か → 回数）。合計は 19 と 20
_LAST28_EXACT: Final[dict[int, dict[int, int]]] = {
    109: {20: 10, 10: 5, 2: 4},
    110: {21: 10, 11: 5, 1: 5},
}


def _named_pageviews(post_id: int, since: int, before: int) -> int:
    """名前つきの記事の 1 日の読まれた回数。

    since は公開日からの日数（公開日が 0。107 は計測開始日が 0）、before は基準日の何日前か。
    """
    weekly = since % 7 == 0
    match post_id:
        case 101:
            return 12 + 6 * since
        case 102:
            return 15 - since
        case 103:
            # 26 日目（D − 3）に累積が 500 を超える
            return 19 + since % 3
        case 104:
            # 13 日目に 500、25 日目（D − 5）に 1,000 を超える
            return 40 + since % 2
        case 105:
            if before < 7:
                return 30
            return 8 if since < 6 else 1
        case 106:
            if before < 7:
                return 25
            if since < 30:
                return 6
            return 1 if before < 35 else 0
        case 107:
            if before < 28:
                return 2
            return 3 if weekly else 0
        case 108:
            if since < 30:
                return 5
            return 1 if since % 3 == 0 else 0
        case 109 | 110:
            if before < 28:
                return _LAST28_EXACT[post_id].get(before, 0)
            if since < 30:
                return 4 if post_id == 109 else 9
            return 2 if weekly else 0
        case 111:
            if since < 30:
                return 30
            return 3 if since % 2 == 0 else 0
        case 112:
            return 10 if since < 30 else 2
        case _:
            raise ValueError("名前つきの記事ではない")


def _generated_pageviews(index: int, since: int) -> int:
    """生成する記事の 1 日の読まれた回数。公開から 30 日間の合計は 93〜423（11 通り）。"""
    if since < 30:
        weight = 1 + (index * 7) % 11
        return weight * ((30 - since) // 10) + 1 + (index + since) % 3
    # 31 日目からは、週に 1 日だけ読まれる
    return 1 + index % 3 if since % 7 == index % 7 else 0


def article_daily_pageviews(spec: PostSpec, base: date) -> dict[date, int]:
    """記事 1 本の、日ごとの読まれた回数。

    公開日（計測開始より前の記事は計測開始日）から基準日まで。0 の日は持たない。
    """
    first = max(spec.published_on, MEASUREMENT_START)
    result: dict[date, int] = {}
    for since in range((base - first).days + 1):
        day = first + timedelta(days=since)
        if spec.post_id in NAMED_POST_IDS:
            value = _named_pageviews(spec.post_id, since, (base - day).days)
        else:
            value = _generated_pageviews(spec.post_id - GENERATED_POST_IDS[0], since)
        if value > 0:
            result[day] = value
    return result


def period_ranges(base: date) -> dict[str, tuple[date, date]]:
    """期間 ID → (開始日, 終了日)。移動窓 6 つと、計測開始の月から基準日の月までの全月。"""
    ranges: dict[str, tuple[date, date]] = {}
    for current, previous, days in WINDOW_DAYS:
        ranges[current] = (base - timedelta(days=days - 1), base)
        ranges[previous] = (base - timedelta(days=2 * days - 1), base - timedelta(days=days))
    year, month = MEASUREMENT_START.year, MEASUREMENT_START.month
    while (year, month) <= (base.year, base.month):
        last_day = calendar.monthrange(year, month)[1]
        ranges[f"m{year}-{month:02d}"] = (date(year, month, 1), date(year, month, last_day))
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return ranges


def _scale(period_id: str, start: date, end: date) -> int:
    """期間の大きさ。期間別の値はこれに比例させる。月は、前月とも前年同月とも変わる。"""
    if period_id in _WINDOW_SCALE:
        return _WINDOW_SCALE[period_id]
    return (end - start).days + 1 + (start.month * 5 + start.year) % 7


def _ymd(day: date) -> str:
    return day.strftime("%Y%m%d")


def site_pageviews(day: date) -> int:
    """全体の日別の読まれた回数。日付から決まる。"""
    return 260 + (day.toordinal() * 7) % 60


def site_sessions(day: date) -> int:
    return 55 + (day.toordinal() * 3) % 20


def _daily_responses(base: date, posts: list[PostSpec]) -> dict[str, dict[str, list[FakeRow]]]:
    """G1〜G4。計測開始日から基準日までのすべての日に、全体の行がある。"""
    site: list[FakeRow] = []
    channel: list[FakeRow] = []
    device: list[FakeRow] = []
    for offset in range((base - MEASUREMENT_START).days + 1):
        day = MEASUREMENT_START + timedelta(days=offset)
        ymd, seed = _ymd(day), day.toordinal()
        site.append(
            (
                {"date": ymd},
                {
                    "screenPageViews": str(site_pageviews(day)),
                    "sessions": str(site_sessions(day)),
                },
            )
        )
        for name, sessions in (
            ("Organic Search", 25 + seed % 9),
            ("Organic Social", 10 + seed % 5),
            ("Direct", 12 + seed % 4),
            ("Referral", 5 + seed % 3),
            ("Email", 5),
        ):
            channel.append(({"date": ymd, _CHANNEL: name}, {"sessions": str(sessions)}))
        for name, pageviews, sessions in (
            ("mobile", 180 + seed % 40, 40 + seed % 12),
            ("desktop", 70 + seed % 15, 12 + seed % 6),
            ("tablet", 10 + seed % 5, 5 + seed % 2),
        ):
            device.append(
                (
                    {"date": ymd, "deviceCategory": name},
                    {"screenPageViews": str(pageviews), "sessions": str(sessions)},
                )
            )
    article: list[FakeRow] = [
        ({"date": _ymd(day), "pagePath": f"/{spec.post_id}/"}, {"screenPageViews": str(value)})
        for spec in posts
        for day, value in article_daily_pageviews(spec, base).items()
    ]
    return {
        "G1": {"daily": site},
        "G2": {"daily": channel},
        "G3": {"daily": device},
        "G4": {"daily": article},
    }


def _sns_rows(period_id: str, scale: int) -> list[FakeRow]:
    if period_id == "last7":
        # x だけ 4 で、ほかはすべて 0（二次伏せが起きない）
        return [({"sessionSource": _X}, {"sessions": "4"})]
    # last28 は x だけ 4 で、ほかに 5 以上がある（二次伏せが起きる）
    x_sessions = 4 if period_id == "last28" else 2 * scale
    return [
        ({"sessionSource": _INSTAGRAM}, {"sessions": str(6 * scale)}),
        ({"sessionSource": _FACEBOOK}, {"sessions": str(3 * scale)}),
        ({"sessionSource": _X}, {"sessions": str(x_sessions)}),
        ({"sessionSource": _LINE}, {"sessions": str(scale + 5)}),
        ({"sessionSource": "social.example"}, {"sessions": str(scale + 2)}),
    ]


def _heatmap_rows(period_id: str, scale: int) -> list[FakeRow]:
    """曜日（0 = 日曜）× 時間帯の 168 セル。3 時台は 0（行がない）。"""
    rows: list[FakeRow] = []
    for dow in range(7):
        for hour in range(24):
            if hour == 3:
                continue
            value = 5 + scale * (1 + (dow * 5 + hour * 3) % 7) // 4
            if 7 <= hour <= 22:
                value += scale
            if period_id == "last28" and (dow, hour) == (2, 4):
                # 1 セルだけ 1〜4
                value = 3
            rows.append(
                ({"dayOfWeek": str(dow), "hour": str(hour)}, {"screenPageViews": str(value)})
            )
    return rows


def _city_rows(period_id: str, scale: int) -> list[FakeRow]:
    def japan(region: str, city: str, sessions: int) -> FakeRow:
        return ({"country": "Japan", "region": region, "city": city}, {"sessions": str(sessions)})

    if period_id == "last90":
        # japan_other と unknown の 2 区分が 4（二次伏せが起きない）
        return [
            japan("Kanagawa", "Kawasaki", 30 * scale),
            japan("Tokyo", "Setagaya", 4),
            japan("(not set)", "(not set)", 4),
        ]
    return [
        japan("Kanagawa", "Kawasaki", 30 * scale),
        japan("Kanagawa", "Yokohama", 8 * scale),
        japan("Tokyo", "Setagaya", 4 * scale),
        japan("Tokyo", "Ota", 2 * scale),
        # しきい値未満。確定月の市別には格納されない
        japan("Tokyo", "Machida", 3),
        japan("(not set)", "(not set)", scale + 5),
        (
            {"country": "United States", "region": "California", "city": "(not set)"},
            {"sessions": "6"},
        ),
    ]


def _site_period_rows(period_id: str, scale: int) -> dict[str, list[FakeRow]]:
    """全体 × 期間（G5〜G9、G16、G19、G20）。"""
    new_returning: list[FakeRow] = [
        ({"newVsReturning": "new"}, {"activeUsers": str(28 * scale)}),
        ({"newVsReturning": "returning"}, {"activeUsers": str(15 * scale)}),
    ]
    if period_id != "last28":
        # last28 は「不明」が 0（行がない）
        new_returning.append(({"newVsReturning": "(not set)"}, {"activeUsers": str(2 * scale)}))
    return {
        "G5": [
            (
                {},
                {
                    "activeUsers": str(45 * scale),
                    "userEngagementDuration": f"{2600.5 * scale:.1f}",
                },
            )
        ],
        "G6": new_returning,
        "G7": _sns_rows(period_id, scale),
        "G8": _heatmap_rows(period_id, scale),
        "G9": _city_rows(period_id, scale),
        "G16": [
            ({"sessionSource": "news.example"}, {"sessions": str(9 * scale)}),
            ({"sessionSource": "blog.example"}, {"sessions": str(4 * scale)}),
            ({"sessionSource": "portal.example"}, {"sessions": str(2 * scale)}),
            ({"sessionSource": "town.example"}, {"sessions": str(scale)}),
            # しきい値未満。格納されない
            ({"sessionSource": "tiny.example"}, {"sessions": "3"}),
        ],
        "G19": [
            ({_CHANNEL: "Organic Search"}, {"sessions": str(30 * scale)}),
            ({_CHANNEL: "Organic Social"}, {"sessions": str(12 * scale)}),
            ({_CHANNEL: "Direct"}, {"sessions": str(15 * scale)}),
            ({_CHANNEL: "Referral"}, {"sessions": str(6 * scale)}),
            ({_CHANNEL: "Email"}, {"sessions": str(2 * scale)}),
        ],
        "G20": [
            (
                {"deviceCategory": "mobile"},
                {"screenPageViews": str(200 * scale), "sessions": str(46 * scale)},
            ),
            (
                {"deviceCategory": "desktop"},
                {"screenPageViews": str(80 * scale), "sessions": str(16 * scale)},
            ),
            (
                {"deviceCategory": "tablet"},
                {"screenPageViews": str(10 * scale), "sessions": str(3 * scale)},
            ),
        ],
    }


@dataclass(frozen=True, slots=True)
class _Visits:
    """記事 1 本 × 期間 1 つ の訪問の内訳。合計が訪問回数（landing）。"""

    channel: dict[str, int]
    sns: dict[str, int]
    device: dict[str, int]


def _formula_visits(pageviews: int) -> _Visits:
    landing = pageviews * 3 // 5
    search, social, direct = landing * 5 // 10, landing * 2 // 10, landing * 2 // 10
    instagram = social * 2 // 3
    mobile, desktop = landing * 7 // 10, landing * 2 // 10
    return _Visits(
        channel={
            "Organic Search": search,
            "Organic Social": social,
            "Direct": direct,
            "Referral": landing - search - social - direct,
        },
        sns={_INSTAGRAM: instagram, _X: social - instagram},
        device={"mobile": mobile, "desktop": desktop, "tablet": landing - mobile - desktop},
    )


# author-a の階層差分の場面。102 だけ social が 4 で伏さる。101 と 103 の social は 5 以上
_FIXED_VISITS: Final[dict[int, _Visits]] = {
    101: _Visits(
        channel={"Organic Search": 12, "Organic Social": 8, "Direct": 5},
        sns={_INSTAGRAM: 8},
        device={"mobile": 20, "desktop": 5},
    ),
    102: _Visits(channel={"Organic Social": 4}, sns={_INSTAGRAM: 4}, device={"mobile": 4}),
    103: _Visits(
        channel={"Organic Search": 150, "Organic Social": 90, "Direct": 60},
        sns={_INSTAGRAM: 60, _X: 30},
        device={"mobile": 210, "desktop": 70, "tablet": 20},
    ),
}


def _visits(post_id: int, period_id: str, pageviews: int) -> _Visits | None:
    """記事 × 期間 の訪問の内訳。値を持たない組は None。"""
    if post_id in (101, 102):
        # 公開から 7 日以内なので、3 つの窓の値は同じ。月の値は持たない
        return _FIXED_VISITS[post_id] if period_id in _WHOLE_LIFE_WINDOWS else None
    if post_id == 103 and period_id == "last28":
        return _FIXED_VISITS[post_id]
    return _formula_visits(pageviews)


def _article_period_responses(
    base: date, ranges: dict[str, tuple[date, date]]
) -> dict[str, dict[str, list[FakeRow]]]:
    """名前つきの記事 × 期間（G10〜G15）。その期間に読まれていない記事の行は作らない。"""
    responses: dict[str, dict[str, list[FakeRow]]] = {
        query_id: {period_id: [] for period_id in ranges}
        for query_id in ("G10", "G11", "G12", "G13", "G14", "G15")
    }
    for spec in named_posts(base):
        daily = article_daily_pageviews(spec, base)
        path = f"/{spec.post_id}/"
        for period_id, (start, end) in ranges.items():
            pageviews = sum(value for day, value in daily.items() if start <= day <= end)
            visits = _visits(spec.post_id, period_id, pageviews) if pageviews else None
            if visits is None:
                continue
            landing = sum(visits.channel.values())
            # 111 の last28 だけ scroll が 3（伏さる）
            scroll = 3 if (spec.post_id, period_id) == (111, "last28") else pageviews * 2 // 5
            if landing:
                responses["G10"][period_id].append(
                    ({"landingPage": path}, {"sessions": str(landing)})
                )
            responses["G11"][period_id].append(
                ({"pagePath": path}, {"userEngagementDuration": f"{pageviews * 35.5:.1f}"})
            )
            if scroll:
                responses["G12"][period_id].append(
                    ({"pagePath": path}, {"eventCount": str(scroll)})
                )
            for query_id, dimension, values in (
                ("G13", _CHANNEL, visits.channel),
                ("G14", "sessionSource", visits.sns),
                ("G15", "deviceCategory", visits.device),
            ):
                responses[query_id][period_id].extend(
                    ({"landingPage": path, dimension: name}, {"sessions": str(sessions)})
                    for name, sessions in values.items()
                    if sessions > 0
                )
    return responses


def _referrer_30d_rows() -> list[FakeRow]:
    """公開後 30 日時点のリンク元（G17）。行の landingPage で、偽の GA4 が記事を絞る。"""
    by_post: dict[int, dict[str, int]] = {
        106: {"news.example": 6},
        111: {"news.example": 22, "town.example": 8, "tiny.example": 2},
        112: {"blog.example": 7, "portal.example": 5},
    }
    for index, post_id in enumerate(GENERATED_POST_IDS):
        if index % 5 == 0:
            by_post[post_id] = {"news.example": 5 + index, "blog.example": 5 + index % 4}
    return [
        ({"landingPage": f"/{post_id}/", "sessionSource": source}, {"sessions": str(sessions)})
        for post_id, sources in by_post.items()
        for source, sessions in sources.items()
    ]


def ga4_responses(base: date) -> dict[str, dict[str, list[FakeRow]]]:
    """偽の GA4 に渡す応答（G1〜G17、G19、G20）。range 名は daily、期間 ID、article。

    日別は計測開始日から基準日まで。返すのは偽の GA4 が request の期間で絞った分。
    """
    posts = all_posts(base)
    ranges = period_ranges(base)
    responses = _daily_responses(base, posts)
    for period_id, (start, end) in ranges.items():
        rows_by_query = _site_period_rows(period_id, _scale(period_id, start, end))
        for query_id, rows in rows_by_query.items():
            responses.setdefault(query_id, {})[period_id] = rows
    responses.update(_article_period_responses(base, ranges))
    responses["G17"] = {"article": _referrer_30d_rows()}
    return responses
