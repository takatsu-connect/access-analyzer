/**
 * S-04（著者一覧）と S-05（著者ページ）の文言。src/lib/ui-text.ts の辞書にまとめて入り、t() で引く。
 *
 * 書き方の決まり:
 * - キーは 's04.' か 's05.' で始める、点区切りの平らな文字列にする。
 *   src/lib/ui-text.ts にあるキーと重ねない。
 * - 05 §2.1 の「使わない語」と「出ません」で終わる文を入れない（コメントにも書かない）。
 * - 差し込み値は {name} の形で書く（例: 's05.sample': '{n} 本の記事' → t('s05.sample', { n })）。
 *
 * どれも仮の初期値（Q-29 の文言確認と、analytics-advisor の確認で差し替える）。
 */
import type { ScreenTexts } from './types';

export const S05_TEXT = {
  // --- S-04 著者一覧 ---
  's04.note': '名前の順に並んでいます。',
  's04.list.label': 'ライターの名前',
  's04.empty': 'ライターのページは、まだありません。',

  // --- S-05 著者ページ: 見出しとリンク ---
  's05.title': '{name}さんの記事',
  's05.authorLink': '著者ページ',
  's05.authorLink.aria': '著者ページ（{name}さんの高津コネクトのページを新しいタブで開きます）',

  // --- S-05 (a)〜(d) この期間のまとめ ---
  's05.summary.h2': 'この期間のまとめ',
  // 月を選んだとき（「前の {days} 日」が合わない）。
  's05.summary.a.month':
    'この期間に {n} 本公開し、合計 {pv} 回読まれました（前の月と比べて 本数 {diffCount}、読まれた回数 {diffPv}）。',
  // 前の期間の数字がないとき。
  's05.summary.a.single': 'この期間に {n} 本公開し、合計 {pv} 回読まれました。',
  // 期間内の公開が 0 本で、公開から 3 か月以上たった記事もまだないとき。
  's05.summary.a.zero.total':
    'この期間に新しく公開した記事はありません。これまでに書いた記事が、この期間に合計 {pv} 回読まれました。',
  // 多くの記事の範囲（全体の分布）がまだないとき。前半だけを出す。
  's05.summary.b.own': '{name}さんの記事は、公開から 30 日で {median} 回くらい読まれています。',
  // {condition} には absent.ownMedian を入れる。
  's05.summary.b.absent': '公開から 30 日で読まれた回数の目安は、{condition}。',
  // 公開から 3 か月以上たった記事がまだないとき。
  's05.summary.c.absent':
    '公開から 3 か月以上たった記事ができると、その記事がこの期間に読まれた回数が出ます。',

  // --- S-05 読者はどこから来たか ---
  's05.referrer.note': '傾向として見るためのもので、良し悪しではありません。',
  's05.referrer.compare': 'サイト全体: {share}',
  's05.referrer.column.site': 'サイト全体の割合',
  's05.referrer.table': '表で見る',
  's05.referrer.caption.channel': '{name}さんの記事への訪問回数（どこから来たか）',
  's05.referrer.caption.sns': '{name}さんの記事への訪問回数（SNS の種類）',

  // --- S-05 どんなカテゴリを書いたか ---
  's05.category.h2': 'どんなカテゴリを書いたか',
  's05.category.column.posts': '記事数',
  's05.category.caption': '{name}さんの記事の、カテゴリごとの記事数と読まれた回数',

  // --- S-05 最近よく読まれている記事 / 久しぶりに読まれた記事 ---
  's05.recent.h2': '最近よく読まれている記事 / 久しぶりに読まれた記事',
  's05.recent.hot.h3': '最近よく読まれている記事',
  's05.recent.revival.h3': '久しぶりに読まれた記事',
  's05.recent.caption.hot': '{name}さんの、最近よく読まれている記事',
  's05.recent.caption.revival': '{name}さんの、久しぶりに読まれた記事',

  // --- S-05 記事の一覧 ---
  's05.posts.h2': '記事の一覧',
  's05.posts.caption': '{name}さんの記事の一覧',
  's05.posts.caption.preMeasure': '{name}さんの記事のうち、数え始める前に公開した記事の一覧',
} as const satisfies ScreenTexts<'s04' | 's05'>;
