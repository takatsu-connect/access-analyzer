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
  // (a) は合計が先、本数が後（助言 B-3）。本数には印と差を付けず、前の期間の本数を並べる（助言 A-2）。
  // 月を選んだとき（「前の {days} 日」が合わない）。
  's05.summary.a.month':
    '{name}さんの記事は、この期間に合計 {pv} 回読まれました（前の月と比べて {diffPv}）。この期間に公開した記事は {n} 本です（前の月は {prevCount} 本）。',
  // 前の期間の数字がないとき。
  's05.summary.a.single':
    '{name}さんの記事は、この期間に合計 {pv} 回読まれました。この期間に公開した記事は {n} 本です。',
  // 多くの記事の範囲（全体の分布）がまだないとき。前半だけを出す。
  's05.summary.b.own': '{name}さんの記事は、公開から 30 日で {median} 回くらい読まれています。',
  // {condition} には absent.ownMedian を入れる。
  's05.summary.b.absent': '公開から 30 日で読まれた回数の目安は、{condition}。',

  // --- S-05 読者はどこから来たか ---
  's05.referrer.note': '傾向として見るためのもので、良し悪しではありません。',
  's05.referrer.compare': 'サイト全体: {share}',
  's05.referrer.column.site': 'サイト全体の割合',
  's05.referrer.table': '同じ数字を表で見る',
  // 伏せ値があるときは、棒をやめて文にする（助言 B-4）。{list} は「検索から 162 回、SNS から 40 回」。
  's05.referrer.text': '{list}の訪問がありました。',
  's05.referrer.masked':
    '{list}は伏せ値です（小さな数は表示していません）。期間を「直近 90 日」にすると、数字が出やすくなります。',
  // SNS の種類の文の 1 項目。{label} は区分の名前、{n} は訪問回数。
  's05.referrer.item': '{label}から {n} 回',
  // 流入チャネルの文の 1 項目（「他のサイトから」は「から」を重ねない）。
  's05.referrer.from.search': '検索から {n} 回',
  's05.referrer.from.social': 'SNS から {n} 回',
  's05.referrer.from.direct': '直接 {n} 回',
  's05.referrer.from.referral': '他のサイトから {n} 回',
  's05.referrer.from.other': 'その他 {n} 回',
  // 伏せ値の区分の並び（「SNS と直接」）。
  's05.referrer.and': 'と',
  's05.referrer.caption.channel': '{name}さんの記事への訪問回数（どこから来たか）',
  's05.referrer.caption.sns': '{name}さんの記事への訪問回数（SNS の種類）',

  // --- S-05 どのカテゴリの記事を書いたか ---
  's05.category.h2': 'どのカテゴリの記事を書いたか',
  // pub_author_category_period.post_count は期間によらない本数（02 §4 の列の定義）。
  's05.category.column.posts': 'これまでの記事数',
  's05.category.caption': '{name}さんの記事の、カテゴリごとの記事数と読まれた回数',

  // --- S-05 いま読まれている記事（最近よく読まれている / 久しぶりに読まれた） ---
  's05.recent.h2': 'いま読まれている記事',
  // 両方の一覧がないとき、h3 と枠の代わりに 1 文だけ出す（助言 A-1）。
  's05.recent.empty':
    'ふだんよりはっきり多く読まれた記事があると、ここに出ます（直近 7 日で見ています）。',
  's05.recent.hot.h3': '最近よく読まれている記事',
  's05.recent.revival.h3': '久しぶりに読まれた記事',
  's05.recent.caption.hot': '{name}さんの、最近よく読まれている記事',
  's05.recent.caption.revival': '{name}さんの、久しぶりに読まれた記事',

  // --- S-05 記事の一覧 ---
  's05.posts.h2': '記事の一覧',
  's05.posts.caption': '{name}さんの記事の一覧',
  's05.posts.caption.preMeasure': '{name}さんの記事のうち、数え始める前に公開した記事の一覧',
} as const satisfies ScreenTexts<'s04' | 's05'>;
