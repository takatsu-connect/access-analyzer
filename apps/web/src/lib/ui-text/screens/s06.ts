/**
 * S-06（カテゴリ別）と S-06b（月ごと × カテゴリ）の文言。src/lib/ui-text.ts の辞書にまとめて入り、
 * t() で引く。
 *
 * 書き方の決まり:
 * - キーは 's06.' か 's06b.' で始める、点区切りの平らな文字列にする。
 *   src/lib/ui-text.ts にあるキーと重ねない。
 * - 05 §2.1 の「使わない語」と「出ません」で終わる文を入れない（コメントにも書かない）。
 * - 差し込み値は {name} の形で書く（例: 's06.sample': '{n} 本の記事' → t('s06.sample', { n })）。
 */
import type { ScreenTexts } from './types';

export const S06_TEXT = {
  // --- S-06 カテゴリ別（05 §7.1）。どれも仮の初期値 ---
  's06.total': '合計',
  's06.count': '{n} 回',
  's06.posts': '{n} 本',
  's06.column.child': '子カテゴリ',
  // 比較の相手が決まらないとき（前の期間がない月）の列名。ふだんは「前の 28 日と比べて」など。
  's06.column.prev': '前の期間と比べて',
  's06.column.postCountTotal': '記事数',
  's06.column.published': 'この期間に公開',
  // 前の期間の不在は共通の absent.prev を使う。
  // M-32。値がありうる期間（直近 90 日、終わった月）だけ、行の下に出す。
  's06.median.note': 'この期間に公開して 30 日たった記事の、真ん中の値です（平均ではありません）。',
  's06.median.absent': '公開から 30 日たった記事ができると出ます',
  's06.ad.note': '広告の記事は、ほかの 3 つのカテゴリの数字に入れていません。',
  // 表の名前（読み上げ用）と、棒の説明。
  's06.table.caption': '{name}の子カテゴリごとの数字',
  's06.bar.title': '{name}: 読まれた回数 {n}',

  // --- S-06b 月ごと × カテゴリ（05 §7.2）。どれも仮の初期値 ---
  's06b.axis.label': 'カテゴリの分け方',
  's06b.axis.parent': '親カテゴリ',
  's06b.axis.child': '子カテゴリ',
  's06b.period.wide': '期間: 直近 24 か月',
  's06b.period.narrow': '期間: 直近 12 か月',
  's06b.chart.title': '月ごと、カテゴリごとの読まれた回数',
  // 格子の見出しに使う短い年月（2026/10）。
  's06b.month.short': '{year}/{month}',
  's06b.tap.hint': 'マスをタップすると、その月の数字に変わります',
  's06b.legend': 'カテゴリごとに、読まれた回数が多い月ほど濃い色',
  // 選んだマスの文。text に 's06b.cell' の文が入る。
  's06b.cell': '{month} {category}: {count} 回',
  's06b.cell.yoy': '{text}。{label} {diff}',
  's06b.cell.noYoy': '{text}。{absent}',
  // ほぼ確定の月。{date} は月末から 7 日後（period.month.settling.note と同じ文の形。助言 B-1）。
  's06b.settling': '{date}ごろまでは、少し増えることがあります',
  's06b.cell.unconfirmed': '{text}。月が終わると、去年の同じ月と比べた数字が出ます',
  's06b.cell.note': '{text}。{note}',
  // 数え始めた月は、月の途中からの数字（助言 2026-11-05 §8）。
  's06b.partial': '{month}は {day} 日からの数字です',
  's06b.partial.note':
    '読まれた回数を数え始めたのが {date}なので、{month}は {day} 日からの数字です。日数がそろわないので、この月とは差を出さず、それぞれの数字を並べています。',
  // 去年の同じ月が数え始めた月のときの、選んだマスの文（差を出さず、数字を並べる。助言 B-2）。
  // 後ろに「。{note}」がつながることがあるので、ほかの固定行の文と同じく末尾に句点を付けない。
  's06b.cell.partialYoy': '{text}。去年の同じ月は、{day} 日からの数字で {count} 回です',
  's06b.table.summary': '同じ数字を表で見る',
  's06b.table.caption': '月ごと、カテゴリごとの読まれた回数の表',
} as const satisfies ScreenTexts<'s06' | 's06b'>;
