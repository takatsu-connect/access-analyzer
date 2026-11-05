/**
 * S-03（記事詳細）の文言。src/lib/ui-text.ts の辞書にまとめて入り、t() で引く。
 *
 * 書き方の決まり:
 * - キーは 's03.' で始める、点区切りの平らな文字列にする。src/lib/ui-text.ts にあるキーと重ねない。
 * - 05 §2.1 の「使わない語」と「出ません」で終わる文を入れない（コメントにも書かない）。
 * - 差し込み値は {name} の形で書く（例: 's03.sample': '{n} 本の記事' → t('s03.sample', { n })）。
 *
 * どれも仮の初期値（Q-29 の文言確認と、analytics-advisor の確認で差し替える）。
 */
import type { ScreenTexts } from './types';

export const S03_TEXT = {
  // --- 属性の行 ---
  // {day} には absent.dayN（「44 日目」）を入れる。数え始める前に公開した記事は .only を使う。
  's03.attr.published': '公開日 {date}（{day}）',
  's03.attr.published.only': '公開日 {date}',
  's03.attr.categories': 'カテゴリ: {list}',
  's03.attr.tags': 'シリーズ: {list}',

  // --- 図の下の表（Details の見出し） ---
  's03.table.summary': '同じ数字を表で見る',

  // --- 公開からの読まれ方 ---
  's03.curve.table.day': '公開からの日数',
  's03.curve.table.range': '{p25}〜{p75}',

  // --- 到達のお知らせ ---
  's03.milestone.mark': '✓',

  // --- ◯◯さんのこれまでの記事と比べて ---
  // この記事の側の数字がまだないとき（公開した当日など）に、著者の側だけを書く。
  's03.own.text.medianOnly':
    '{name}さんのこれまでの記事は、30 日で {median} 回くらい読まれています。',

  // --- 期間を選んで見る部分 ---
  's03.periodPart.lead': 'ここから下は、期間を選んで見る部分',
  's03.period.h2': 'この期間に読まれた回数',

  // --- 日ごとの読まれた回数 ---
  's03.daily.h2': '日ごとの読まれた回数',
  's03.daily.beforePublish':
    'この期間は、記事を公開する前です。日ごとの数字は、公開した日から始まります。',
  's03.daily.beforeMeasure':
    'この期間は、読まれた回数を数え始める前です。日ごとの数字は、{start}から始まります。',
  's03.daily.table.day': '日付',
  's03.daily.table.unconfirmed': 'あとで増えることがあります',
  's03.daily.view.label': 'グラフのまとめ方',
  's03.daily.view.weekly': '週ごと',
  's03.daily.view.daily': '日ごと',

  // --- 読者はどこから来たか ---
  's03.source.h2': '読者はどこから来たか（次に紹介する場所の参考に）',
  's03.landing.note': '（この記事から読み始めた訪問です）',
  's03.referrer.note': '公開後 30 日時点の集計です。期間を選び直しても変わりません。',
  's03.referrer.empty':
    '公開から 30 日のあいだに、ここに載る数の訪問があったリンク元のサイトはありませんでした。',

  // --- どんな端末で読まれたか ---
  's03.device.h2': 'どんな端末で読まれたか',
  's03.device.column': '端末',
} as const satisfies ScreenTexts<'s03'>;
