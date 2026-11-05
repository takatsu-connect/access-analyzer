/**
 * 画面に出す文言の辞書（05 §2.1、NFR-99、Q-29）。
 *
 * - 画面の日本語はすべてここに置く。JSX に日本語のリテラルを書かない（07 §7 S-04）。
 * - キーは 'band.note' のような点区切りの文字列。差し込み値は {name} の形で書き、t() で埋める。
 * - 指標の名称と注記は 02_metrics.md §4「画面での名称」と glossary §1「添える注記」に合わせる。
 * - 05 §2.1 の「使わない語」と「出ません」で終わる文を入れない（このファイルはコメントにも書かない。
 *   scripts/check-forbidden-words.mjs がコメントも見る）。GA4 の API 名は括弧の中にだけ書く。
 *   語の一覧と検査は tests/lib/ui-text.test.ts（U-19）にある。
 * - 文言は仮の初期値を含む（Q-29 の文言確認、計測開始前の記事の助言 §9 の採否で差し替える）。
 * - 画面ごとの文言は src/lib/ui-text/screens/ のファイル（s01.ts など）に足す。このファイルの
 *   辞書にまとめて入るので、t() の型と U-19 の検査は、どちらのキーにも同じように効く。
 *   このファイルに置くのは、複数の画面と共通の部品が使う文言。
 */
import type {
  Band,
  Channel,
  Device,
  Freshness,
  LocalBucket,
  NewReturning,
  SnsBucket,
  WindowId,
} from '@/lib/page-data';

import { S01_TEXT } from './ui-text/screens/s01';
import { S02_TEXT } from './ui-text/screens/s02';
import { S03_TEXT } from './ui-text/screens/s03';
import { S05_TEXT } from './ui-text/screens/s05';
import { S06_TEXT } from './ui-text/screens/s06';
import { S07_TEXT } from './ui-text/screens/s07';
import { S08_TEXT } from './ui-text/screens/s08';

/** 辞書に名称と注記を持つ指標（M-01〜M-27、M-30〜M-34、M-41）。 */
export const METRIC_IDS = [
  'M01',
  'M02',
  'M03',
  'M04',
  'M05',
  'M06',
  'M07',
  'M08',
  'M09',
  'M10',
  'M11',
  'M12',
  'M13',
  'M14',
  'M15',
  'M16',
  'M17',
  'M18',
  'M19',
  'M20',
  'M21',
  'M22',
  'M23',
  'M24',
  'M25',
  'M26',
  'M27',
  'M30',
  'M31',
  'M32',
  'M33',
  'M34',
  'M41',
] as const;

export type MetricId = (typeof METRIC_IDS)[number];

/** 廃止した指標。U-19 の完全性のために名称と注記を置くが、画面には出さない。 */
export const RETIRED_METRIC_IDS = [
  'M04',
  'M05',
  'M07',
  'M08',
] as const satisfies readonly MetricId[];

/** 初回対象外の指標（廃止ではない）。画面には出さない。 */
export const DEFERRED_METRIC_IDS = ['M41'] as const satisfies readonly MetricId[];

/** 廃止した指標の名称の先頭に付ける内部用の印。 */
export const RETIRED_MARK = '（廃止）';

/** 初回対象外の指標の名称の先頭に付ける内部用の印。 */
export const DEFERRED_MARK = '（初回対象外）';

/** 型で存在を保証するキー（指標と区分）。 */
type RequiredKey =
  | `metric.${MetricId}.label`
  | `metric.${MetricId}.note`
  | `band.${Band}`
  | `channel.${Channel}`
  | `sns.${SnsBucket}`
  | `device.${Device}`
  | `local.${LocalBucket}`
  | `newReturning.${NewReturning}`
  | `freshness.${Freshness}`
  | `period.${WindowId}`;

/** 辞書の本体。複数の画面と共通の部品が使う文言（画面ごとの文言は screens/ のファイル）。 */
const baseDictionary = {
  // --- サイト、ナビゲーション、フッタ（05 §1、§2.7） ---
  // 名称は Q-23 で未確定。05 §2.7 の仮の名称を使う。
  'site.title': '高津コネクト アクセス BI',
  'nav.dashboard': '全体',
  'nav.articles': '記事',
  'nav.authors': '著者',
  'nav.categories': 'カテゴリ',
  'nav.tags': 'シリーズ',
  'nav.activity': '投稿活動',
  'nav.aria': 'ページの移動',
  'nav.articles.aria': '記事のページ',
  'skip.toMain': '本文へ移動',
  'footer.about': 'この BI について',
  'footer.about.source':
    '数字は Google アナリティクス（GA4）と、高津コネクトが公開している記事の情報から作っています。',
  'footer.about.update': '毎日 1 回、自動で更新します。',
  'footer.about.contact': 'お問い合わせは、高津コネクトの運営までお願いします。',

  // --- 画面の名前と h1（05 §1 の「問い」） ---
  's01.name': '全体ダッシュボード',
  's01.h1': 'この期間、サイト全体はどれくらい読まれた？',
  's02a.name': 'よく読まれた記事',
  's02a.h1': 'この期間、どの記事がよく読まれた？',
  's02b.name': '新着記事の立ち上がり',
  's02b.h1': 'この期間に公開された記事は、どう読まれ始めた？',
  's02c.name': '長く読まれている記事',
  's02c.h1': '公開から 3 か月以上たっても読まれている記事は？',
  's02d.name': '最近よく読まれている記事',
  's02d.h1': '最近よく読まれている記事は？',
  's02e.name': '記事を探す',
  's02e.h1': '記事を探す（絞り込みと検索）',
  's03.name': '記事詳細',
  's03.h1': 'この記事はどう読まれた？',
  's04.name': '著者一覧',
  's04.h1': 'ライターのページ',
  's05.name': '著者ページ',
  's05.h1': '{name}さんの記事は、この期間どう読まれた？',
  's06.name': 'カテゴリ別',
  's06.h1': 'どのカテゴリが読まれた？',
  's06b.name': '月ごと × カテゴリ',
  's06b.h1': '季節で読まれ方は変わる？',
  's07.name': 'シリーズ（タグ）別',
  's07.h1': 'どのシリーズが読まれた？',
  's07b.name': 'シリーズの記事',
  's07b.h1': '{name}の記事は、この期間どう読まれた？',
  's08.name': '投稿活動',
  's08.h1': 'この期間、どれくらい書いた？ どんな記事が多かった？',

  // --- 存在しないページ（05 §10 の固定文） ---
  'notFound.h1': 'このページはありません',
  'notFound.lead': 'URL をお確かめください。',
  'notFound.reasons.lead':
    '記事や著者のページが見つからないときは、次のいずれかの可能性があります。',
  'notFound.reason.notYet': '記事が公開翌日以降にまだ取り込まれていない（毎日 1 回更新しています）',
  'notFound.reason.removed': '記事が削除されたか、非公開になった',
  'notFound.reason.url': 'URL の一部が欠けている',
  'notFound.link.dashboard': '全体ダッシュボードへ',
  'notFound.link.search': '記事を探す',
  'notFound.link.authors': 'ライターのページ',

  // --- ヘッダ直下の DataStatus（05 §2.7） ---
  'status.asOf':
    '{date}までのデータです（{updated} 更新）。直近 2〜3 日の数字はあとで増えることがあります。',
  'status.delayed': '更新が遅れています: 最新のデータは {date}までです',

  // --- 読み込み中、エラー、データなし ---
  'state.loading': '読み込んでいます',
  'state.error': '表示できませんでした。時間をおいて、もう一度開いてください。',
  'state.empty': 'この期間の数字はまだありません。',

  // --- 期間の選択肢と比較の相手（05 §2.2、§2.5） ---
  'period.picker': '期間',
  'period.last7': '直近 7 日',
  'period.last28': '直近 28 日',
  'period.last90': '直近 90 日',
  'period.month': '月',
  'period.month.select': '年月を選ぶ',
  // 月の途中（基準日の属する月）。
  'period.month.unconfirmed': '{label}（途中まで）',
  // 月は終わったが、月末から 7 日たつまでは数字を取り直している。
  'period.month.settling': '{label}（集計中）',
  'compare.withRatio': '{diff}（{ratio}）',
  'compare.prevWindow': '前の {days} 日と比べて',
  'compare.prevMonth': '前の月と比べて',
  'compare.yoy': '去年の同じ月と比べて',
  'compare.arrow.up': '▲',
  'compare.arrow.down': '▼',
  'compare.up': '増えた',
  'compare.down': '減った',
  'compare.same': '変わらず',

  // --- 書式（src/lib/format.ts が使う） ---
  'format.date': '{year} 年 {month} 月 {day} 日',
  'format.monthDay': '{month} 月 {day} 日',
  'format.yearMonth': '{year} 年 {month} 月',
  'format.range': '{start}〜{end}',
  'format.dateTime': '{date} {time}',
  'format.duration.minSec': '{min} 分 {sec} 秒',
  'format.duration.sec': '{sec} 秒',
  'format.tenOf': '10 人中 {n} 人',

  // --- 帯の 3 区分（仮、Q-29。05 §2.1） ---
  'band.upper': 'よく読まれています',
  'band.middle': '多くの記事と同じくらい',
  'band.lower': 'これから',
  'band.lower.alt': 'ゆっくり読まれています',
  'band.na': 'まだ比較できません',
  'band.note':
    '3 つの区分は、同じ日数がたった記事を 4 等分したものです。4 本に 1 本は「よく読まれています」に、4 本に 1 本は「これから」に入ります。成績ではなく、位置です。',

  // --- 全画面共通の説明文 CommonNotes（05 §2.7） ---
  'notes.h2': 'このページの数字について',
  'notes.more': '詳しく',
  'notes.pageviews':
    '読まれた回数は、ページが表示された回数です。同じ人が 3 回読めば 3 と数えます。',
  'notes.masked':
    '「—（伏せ値）」: 5 回未満の小さな数と、小さな数が分かってしまう隣の数は表示していません。',
  'notes.band':
    '「多くの記事はこの範囲」は、公開から同じ日数がたった記事を読まれた回数の順に並べたときの、真ん中の半分です。',
  // 助言 §9 の案で直した（仮）: 「全期間の記事」→「数え始めてから公開されたすべての記事」。
  'notes.band.detail':
    '比べる相手は、直近 12 か月に公開された記事（広告を除く）です。30 本に満たないときは、数え始めてから公開されたすべての記事で比べ、それでも足りないときは「まだ比較できません」と出します。',
  'notes.ratio': '比率（%）は、元の数が 20 未満のときは出さず、差の数だけを出します。',
  'notes.source':
    '数字は Google アナリティクス（GA4）から毎日 1 回取り込んでいます。GA4 の管理画面の値と小さな差が出ることがあります。',
  // ここから 3 つは助言 §9 の案（仮の初期値）。
  'notes.measureStart': '読まれた回数は、{start}から数えています。',
  'notes.measureStart.detail':
    'それより前に公開された記事は、公開してすぐの数字（最初の 1 週間、最初の 1 か月、多くの記事との比較）が残っていません。合計は{start}からの合計です。',
  'notes.ownMedian.scope': '{start}以降に公開した記事で見ています。',

  // --- 伏せ値、該当なし、不在（05 §2.3） ---
  'masked.dash': '—',
  'masked.label': '伏せ値',
  'absent.na': '該当なし',
  'absent.dayN': '{n} 日目',
  'absent.dayN.count': '{n} 日目: {count} 回',
  // 助言 §9 の案で直した（仮）。05 §2.1 の初期値は「記事が 5 本以上になると出ます」。
  'absent.ownMedian': '数え始めてから公開した記事が 5 本以上になると出ます',
  'absent.ratio20': '読まれた回数が 20 回以上になると出ます',
  'absent.referrer30': '公開 30 日後に出ます',
  'absent.milestone': '500 回読まれると、最初のお知らせが出ます',
  'absent.band': 'まだ比較できません',
  'absent.yoy': '前年のデータなし',
  // ここから 4 つは助言 §9 の案（仮の初期値）。
  'absent.preMeasure': '数え始める前',
  'absent.preMeasure.alt': '記録なし',
  'absent.milestone.since': '数え始めてから 500 回読まれると、最初のお知らせが出ます',
  'absent.referrer30.preMeasure':
    '公開から 30 日間の集計です。この記事は数え始める前に公開されたので、ここに入る数字は残っていません。',

  // --- 印とお知らせ（05 §2.4、M-22、M-23） ---
  'badge.new': '新着',
  'badge.recentHot': '最近読まれている',
  'badge.revival': '久しぶりに読まれた',
  'milestone.reached': '{n} 回読まれました（{date}）',
  'milestone.reached.since': '数え始めてから {n} 回読まれました（{date}）',
  'milestone.evergreen': '1 年たっても読まれています',

  // --- グラフ、凡例、前置き（05 §2.3、§2.4、§2.6） ---
  'lead.sessions': '訪問 {n} 回のうち',
  'lead.pageviews': '読まれた {n} 回のうち',
  'lead.users': '読んだ人 {n} 人のうち',
  'chart.tap.hint': 'グラフの日付をタップすると、その日の数字に変わります',
  'chart.fixedRow': '{date}: {label} {value}（前の期間の同じ日: {prev}）',
  'chart.fixedRow.single': '{date}: {label} {value}',
  // ここから、グラフ部品が props で受ける文言（05 §2.8。仮の初期値）。
  // LineChart: 公開本数の添え書き（publishedText）と、週別の固定行（fixedRowText）。
  'chart.fixedRow.published': '。この日に {n} 本公開',
  'chart.fixedRow.week': '{range}: {label} {value}（前の期間の同じ週: {prev}）',
  'chart.fixedRow.week.single': '{range}: {label} {value}',
  // HBar: 数と構成比（valueWithShare）、比較相手の添え書き（compare.text）。
  'hbar.valueWithShare': '{n}（{share}）',
  'hbar.compare.prev': '前: {share}',
  'legend.current': 'この期間',
  'legend.prev': '前の期間',
  'legend.unconfirmed': '薄い色の日はあとで増えることがあります',
  'legend.masked': '— 伏せ値',
  'legend.heatmap': '読まれた回数が多い時間ほど濃い色',
  'legend.published': '公開した日',
  // HBar の比較相手の凡例。サイト全体との比較は s05.referrer.legend を使う。
  'legend.compare.prev': '細い枠: 前の期間',
  // Curve の凡例の「この記事」。帯は metric.M19.label、点線は metric.M27.label、
  // 横軸の「n 日目」は absent.dayN を使う（同じ意味のキーを 2 つ持たない）。
  'legend.curve.post': 'この記事',
  // Heatmap: 固定行の上の案内（hint）と、固定行の文（cellText）。
  'heatmap.tap.hint': 'マスをタップすると、その時間の数字に変わります',
  'heatmap.fixedRow': '{row} {col}: {label} {value}',
  'heatmap.fixedRow.masked': '{row} {col}: {label} —（伏せ値）',
  'heatmap.slots':
    '深夜 0〜3 時 / 早朝 4〜7 時 / 朝 8〜11 時 / 昼 12〜15 時 / 夕方 16〜19 時 / 夜 20〜23 時',
  'heat.avg': '1 日あたりの平均',
  'heat.sum': '期間の合計',
  'weekday.0': '日',
  'weekday.1': '月',
  'weekday.2': '火',
  'weekday.3': '水',
  'weekday.4': '木',
  'weekday.5': '金',
  'weekday.6': '土',

  // --- 表の列名、並び、件数（05 §2.5） ---
  'column.post': '記事',
  'column.author': 'ライター',
  'column.publishedOn': '公開日',
  'column.pageviews': '読まれた回数',
  'column.pv7': '最初の 1 週間',
  'column.pv30': '最初の 1 か月',
  'column.band': '多くの記事と比べて',
  'column.pvTotal': '公開からの合計',
  'column.topChannel': 'どこから来たか',
  'column.sessions': '訪問回数',
  'column.share': '割合',
  'column.postCount': '本数',
  'column.category': 'カテゴリ',
  'column.tag': 'シリーズ',
  'column.domain': 'リンク元のサイト',
  'column.area': 'おおよその地域',
  'column.month': '月',
  'column.median30': '1 本あたり読まれた回数（真ん中の記事）',
  'column.more': '詳しく',
  'sort.published': '公開日の新しい順',
  'sort.pv': '読まれた回数の多い順',
  'sort.pv7': '最初の 1 週間の多い順',
  'sort.pv30': '最初の 1 か月の多い順',
  'count.20': '20 件',
  'count.50': '50 件',
  'column.pageviews.period': '読まれた回数（この期間）',
  'column.recent7': '直近 7 日の読まれた回数',
  'sort.label': '並び',
  'table.more': 'さらに表示',
  'table.shown': '{total} 件のうち {shown} 件を表示しています',
  'list.separator': '、',
  'link.external.mark': '↗',
  'link.external.article': '{title}（高津コネクトの記事を新しいタブで開きます）',

  // --- 区分の名前（区分の値は contracts/constants.json と同じ） ---
  'channel.search': '検索',
  'channel.social': 'SNS',
  'channel.direct': '直接',
  'channel.referral': '他のサイトから',
  'channel.other': 'その他',
  'sns.instagram': 'Instagram',
  'sns.facebook': 'Facebook',
  'sns.x': 'X',
  'sns.line': 'LINE',
  'sns.other': 'その他',
  'device.mobile': 'スマホ',
  'device.desktop': 'パソコン',
  'device.tablet': 'タブレット',
  'local.kawasaki': '川崎市',
  'local.japan_other': '国内その他',
  'local.unknown': '不明',
  'newReturning.new': '初めての人',
  'newReturning.returning': 'また来た人',
  'newReturning.unknown': '不明',
  // 「鮮度」は内部の語で、画面には出さない（05 §2.1）。
  'freshness.new': '新着（1 か月以内）',
  'freshness.mid': '公開から 1〜3 か月',
  'freshness.long': '3 か月より前',

  // --- 計測開始前に公開した記事（助言 §9 の案。仮の初期値） ---
  'list.preMeasure.note':
    '「数え始める前」: {start}より前に公開された記事です。最初の 1 週間と最初の 1 か月の数字は残っていません。',
  'list.preMeasure.divider':
    'ここから下は、{start}より前に公開された記事です（公開日の新しい順）。',

  // --- S-01 全体 ---
  's01.benchmark':
    'このサイトの多くの記事は、公開から 30 日で {p25}〜{p75} 回（真ん中は {p50} 回）読まれます。',
  's01.readers.h2': '読者はどんな人？',
  's01.freshness.h3': '新しい記事と古い記事、どちらが読まれた？',

  // --- S-02 記事一覧 ---
  's02a.note': '公開日が近い記事が有利です。記事以外のページと広告の記事は含めていません。',
  's02b.empty': 'この期間に公開された記事はありません',
  's02c.note': '公開から 91 日以上たった記事のうち、この期間に読まれた回数が多いものです',
  's02d.empty': '今週は該当する記事がありません',
  's02b.note':
    '「多くの記事はこの範囲」との比較です。公開から 3 日未満は「まだ比較できません」。並びは公開日順で、帯で並べ替えません。',
  's02d.note': '直近 1 週間に、その前の数週間よりはっきり多く読まれた記事です（目安）。',
  's02d.note.detail':
    '公開から 15 日以上たち、直近 7 日に 20 回以上読まれ、その前 4 週の週平均の 2 倍以上の記事です。「久しぶりに読まれた」は、公開から 3 か月以上たった記事です。',

  // --- S-03 記事詳細 ---
  's03.curve.text':
    '30 日で {pv30} 回読まれました。多くの記事は {p25}〜{p75} 回（真ん中は {p50} 回）です。',
  's03.curve.text.young':
    '{n} 日目で {pv} 回読まれました。同じ {n} 日目の多くの記事は {p25}〜{p75} 回です。',
  's03.period': 'この期間に {n} 回読まれました。公開からの合計は {total} 回です。',
  's03.period.since': 'この期間に {n} 回読まれました。{start}からの合計は {total} 回です。',
  's03.own.h2': '{name}さんのこれまでの記事と比べて',
  's03.own.text':
    '{name}さんのこれまでの記事は、30 日で {median} 回くらい読まれています。この記事は 30 日で {pv30} 回。',
  's03.own.text.young':
    '{name}さんのこれまでの記事は、30 日で {median} 回くらい読まれています。この記事は {n} 日目で {pv} 回。',
  's03.own.text.preMeasure':
    '{name}さんのこれまでの記事は、30 日で {median} 回くらい読まれています。この記事は数え始める前に公開されたので、30 日の数字は残っていません。',
  's03.engagement.h2': 'どれくらい読み込まれたか（目安）',
  's03.preMeasure.lead':
    'この記事は、読まれた回数を数え始めた日（{start}）より前に公開されました。公開してすぐの数字は残っていないので、このページは数え始めてからの読まれ方をまとめています。',

  // --- S-04 / S-05 著者 ---
  's04.lead': '自分の名前を選ぶとページが開きます。ブックマークしておくと次から直接開けます。',
  's05.summary.a':
    'この期間に {n} 本公開し、合計 {pv} 回読まれました（前の {days} 日と比べて 本数 {diffCount}、読まれた回数 {diffPv}）。',
  's05.summary.a.zero':
    'この期間に新しく公開した記事はありません。以前に書いた {n} 本の記事が {pv} 回読まれました。',
  's05.summary.b':
    '{name}さんの記事は、公開から 30 日で {median} 回くらい読まれています。多くの記事は {p25}〜{p75} 回（真ん中は {p50} 回）です。',
  's05.summary.b.preMeasure':
    '{name}さんの記事は、どれも{start}より前に公開されたので、最初の 1 か月の数字は残っていません。',
  's05.summary.c': '以前に書いた {n} 本の記事は、この期間にも {pv} 回読まれました。',
  's05.referrer.legend': '細い枠: サイト全体',

  // --- S-06 カテゴリ ---
  's06.note':
    '1 つの記事が複数の子カテゴリに入ることがあるので、子の数字を足しても合計とは一致しません。',
  's06b.scroll': '→ 横にスクロールできます',

  // --- S-08 投稿活動 ---
  's08.authors.h2': 'この期間に記事を公開したライター（名前の順）',
  's08.authors.note': '名前の順に並んでいます。本数の多い順にはしていません。',

  // --- 指標の名称と注記（02_metrics.md §4、glossary §1） ---
  'metric.M01.label': '読まれた回数',
  'metric.M01.label.first': '読まれた回数（PV）',
  'metric.M01.note': '同じ人が 3 回読めば 3 と数えます。',
  'metric.M02.label': '訪問回数',
  'metric.M02.note': '1 回の訪問で何ページ読んでも 1 です。',
  'metric.M02.note.first': '1 回の訪問で何ページ読んでも 1 です（GA4 の sessions）。',
  'metric.M03.label': '読んだ人の数（おおよそ）',
  'metric.M03.note': '端末やブラウザごとに数えるため目安です。',
  'metric.M03.note.first': '端末やブラウザごとに数えるため目安です（GA4 の activeUsers）。',
  'metric.M04.label': '（廃止）新規ユーザー数（newUsers）',
  'metric.M04.note': '廃止した指標です。「初めての人」にまとめました。',
  'metric.M05.label': '（廃止）エンゲージメント率（engagementRate）',
  'metric.M05.note': '廃止した指標です。読み込まれ方は「最後まで読まれた割合（目安）」で見ます。',
  'metric.M06.label': '読まれていた時間（1 回あたりの目安）',
  'metric.M06.note':
    '画面が開いていた時間で、読んだ時間そのものではありません。GA4 管理画面の平均エンゲージメント時間とは一致しません。',
  'metric.M07.label': '（廃止）平均セッション時間（averageSessionDuration）',
  'metric.M07.note': '廃止した指標です。「読まれていた時間（1 回あたりの目安）」と重なります。',
  'metric.M08.label': '（廃止）直帰率（bounceRate）',
  'metric.M08.note':
    '廃止した指標です。1 つの記事を読んで帰るのが普通のサイトでは、読み違えやすい数字です。',
  'metric.M09.label': '最後まで読まれた割合（目安）',
  'metric.M09.note': '「10 人中 6 人」のように人数で示します。',
  'metric.M10.label': '読者はどこから来たか',
  'metric.M10.note': '「直接」には LINE などのアプリから開いた分が含まれることがあります。',
  'metric.M11.label': 'SNS の種類',
  'metric.M11.note': 'LINE は実際より少なく見えることがあります。',
  'metric.M12.label': 'リンク元のサイト',
  'metric.M12.note': 'ページ単位の完全な URL（pageReferrer）は取得も表示もしていません。',
  'metric.M13.label': 'スマホ / パソコン / タブレット',
  'metric.M13.note': '読むのに使われた端末の種類です。',
  'metric.M14.label': 'おおよその地域（都道府県・市）',
  'metric.M14.note': '通信会社の仕組み上、実際と違う市になることがあります。',
  'metric.M14.local.label': '地元の読者の目安',
  'metric.M14.local.note': '多くても少なくても良し悪しではありません。',
  'metric.M15.label': '初めての人 / また来た人',
  'metric.M15.note': 'スマホでは「初めて」が多めに出ます。',
  'metric.M16.label': 'いつ読まれているか',
  'metric.M16.note': '読まれた時刻で、投稿した時刻ではありません。',
  'metric.M17.label': '最初に開いたページ',
  'metric.M17.note': 'この記事から読み始めた訪問の内訳です。',
  'metric.M18.label': '公開からの読まれ方',
  'metric.M18.note': '公開した日を 1 日目として数えます。',
  'metric.M19.label': '多くの記事はこの範囲',
  'metric.M19.note': '真ん中の半分の記事が入る範囲です。',
  'metric.M20.label': '最初の 1 週間で / 最初の 1 か月で読まれた回数',
  'metric.M20.note': '公開した日を 1 日目として、7 日目まで、30 日目までに読まれた回数です。',
  'metric.M21.label': '新着（1 か月以内）/ 1〜3 か月 / 長く読まれている（3 か月以上）',
  'metric.M21.note': '公開からの日数で 3 つに分けています。',
  'metric.M22.label': '最近読まれている / 久しぶりに読まれた',
  'metric.M22.note': '目安です。公開直後の記事は対象外です。',
  'metric.M23.label': '到達のお知らせ',
  'metric.M23.note': '誰かと比べる数字ではありません。',
  'metric.M24.label': 'これまでの記事と比べて',
  'metric.M24.note': '数え始めてから公開した記事が 5 本以上になると出ます。',
  'metric.M25.label': '以前に書いた記事が、この期間に読まれた回数',
  'metric.M25.note': '公開から 3 か月以上たった記事が、この期間に読まれた回数の合計です。',
  'metric.M26.label': '公開した日',
  'metric.M26.note': 'その日に公開した記事の本数を、グラフに重ねています。',
  'metric.M27.label': '真ん中の記事',
  'metric.M27.note': '記事を読まれた回数の順に並べたときの真ん中です。',
  'metric.M30.label': '公開した記事の本数',
  'metric.M30.note': 'この期間に公開した記事の本数です。',
  'metric.M31.label': 'ライターごとの公開した本数',
  'metric.M31.note': '名前の順に並んでいます。本数の多い順にはしていません。',
  'metric.M32.label': 'カテゴリ別: 読まれた回数、本数、1 本あたり読まれた回数（真ん中の記事）',
  'metric.M32.note': '平均ではなく真ん中の記事の値です。',
  'metric.M33.label': 'シリーズ別',
  'metric.M33.note': '同じタグ（シリーズ）が付いた記事をまとめた数字です。',
  'metric.M34.label': '月ごと × カテゴリ',
  'metric.M34.note': 'カテゴリごとの読まれた回数を、月ごとに並べたものです。',
  'metric.M41.label': '（初回対象外）シェア',
  'metric.M41.note': 'シェアのボタンが押された回数です。初回は対象外です。',
} as const satisfies Readonly<Record<string, string>> & Readonly<Record<RequiredKey, string>>;

/**
 * 辞書の部品。本体（このファイル）と、画面ごとのファイル（src/lib/ui-text/screens/）。
 * 画面ごとのファイルを足すときは、ここと、下の dictionary の両方に足す
 * （片方だけだと tests/lib/ui-text.test.ts が落ちる）。
 */
export const dictionaryParts = {
  base: baseDictionary,
  s01: S01_TEXT,
  s02: S02_TEXT,
  s03: S03_TEXT,
  s05: S05_TEXT,
  s06: S06_TEXT,
  s07: S07_TEXT,
  s08: S08_TEXT,
} as const;

type DictionaryParts = typeof dictionaryParts;

/** 部品のどれかにあるキー（部品ごとに分けて集める）。 */
type KeysOfAny<Part> = Part extends unknown ? keyof Part : never;

/** 2 つ以上の部品にあるキー。なければ never。 */
type DuplicateKey = {
  [Name in keyof DictionaryParts]: keyof DictionaryParts[Name] &
    KeysOfAny<DictionaryParts[Exclude<keyof DictionaryParts, Name>]>;
}[keyof DictionaryParts];

type MustBeNever<Key extends never> = Key;

/**
 * 同じキーが 2 か所にあると、ここがコンパイルエラーになる（エラーの文に、重なったキーが出る）。
 * 後ろの部品が前の文言を黙って上書きするのを防ぐ。
 */
export type NoDuplicateUiTextKey = MustBeNever<DuplicateKey>;

/** 画面に出す文言のすべて。部品を 1 つにまとめたもの。 */
export const dictionary = {
  ...dictionaryParts.base,
  ...dictionaryParts.s01,
  ...dictionaryParts.s02,
  ...dictionaryParts.s03,
  ...dictionaryParts.s05,
  ...dictionaryParts.s06,
  ...dictionaryParts.s07,
  ...dictionaryParts.s08,
} as const;

type Dictionary = typeof dictionary;

/** 辞書のキー。存在しないキーはコンパイルエラーになる。 */
export type UiTextKey = keyof Dictionary;

/** 文言の中の {name} を取り出す。 */
type PlaceholderOf<Text extends string> = Text extends `${string}{${infer Name}}${infer Rest}`
  ? Name | PlaceholderOf<Rest>
  : never;

/** そのキーの文言が求める差し込み値。 */
export type UiTextParams<Key extends UiTextKey> = Readonly<
  Record<PlaceholderOf<Dictionary[Key]>, string | number>
>;

type ParamArgs<Key extends UiTextKey> = [PlaceholderOf<Dictionary[Key]>] extends [never]
  ? []
  : [params: UiTextParams<Key>];

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

function hasOwn(target: object, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, name);
}

/**
 * 辞書の文言を返す。{name} の形の差し込みがある文言は、params で埋める。
 *
 * 差し込み値が足りないときと、キーがないときは例外にする（「{n}」をそのまま画面に出さない）。
 * 数は呼び出し側が src/lib/format.ts で書式を整えてから渡す。
 */
export function t<Key extends UiTextKey>(key: Key, ...args: ParamArgs<Key>): string {
  if (!hasOwn(dictionary, key)) {
    throw new Error(`ui-text: キー「${String(key)}」がありません。`);
  }
  const template: string = dictionary[key];
  const params = (args as readonly unknown[])[0];
  return template.replace(PLACEHOLDER, (_match, name: string) => {
    const value: unknown =
      typeof params === 'object' && params !== null && hasOwn(params, name)
        ? (params as Record<string, unknown>)[name]
        : undefined;
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new Error(`ui-text: 「${key}」の差し込み値 ${name} がありません。`);
    }
    return String(value);
  });
}

/** 指標の画面での名称。 */
export function metricLabel(id: MetricId): string {
  return t(`metric.${id}.label`);
}

/** 指標に添える注記（1 文か 2 文）。 */
export function metricNote(id: MetricId): string {
  return t(`metric.${id}.note`);
}

/** スマホのヒートマップの 6 区分のラベル（深夜 0〜3 時 … 夜 20〜23 時）。 */
export function heatmapSlotLabels(): string[] {
  return t('heatmap.slots').split(' / ');
}
