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
  's06.column.published': '期間内に公開',
  's06.absent.prev': '前の期間のデータなし',
  // M-32。平均ではないことと、「該当なし」の意味。
  's06.median.note':
    '「1 本あたり読まれた回数（真ん中の記事）」は、期間内に公開して 30 日たった記事が、最初の 1 か月に読まれた回数です。平均ではなく真ん中の記事の値です。そういう記事がまだないときは「該当なし」と出します。',
  's06.ad.note': '広告の記事は他の合計に含めていません。',
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
  's06b.legend': '読まれた回数が多いマスほど濃い色',
  // 選んだマスの文。text に 's06b.cell' の文が入る。
  's06b.cell': '{month} {category}: {count} 回',
  's06b.cell.yoy': '{text}。{label} {diff}',
  's06b.cell.noYoy': '{text}。{absent}',
  's06b.settling': '月末から 1 週間ほどは、あとで増えることがあります',
  's06b.cell.unconfirmed': '{text}。月が終わると、去年の同じ月と比べた数字が出ます',
  's06b.cell.note': '{text}。{note}',
  // 数え始めた月は、月の途中からの数字（助言 2026-11-05 §8）。
  's06b.partial': '{month}は {day} 日からの数字です',
  's06b.partial.note':
    '読まれた回数を数え始めたのが {date}なので、{month}は {day} 日からの数字です。この月と比べるときは、そのぶんを差し引いて見てください。',
  's06b.table.summary': '同じ数字を表で見る',
  's06b.table.caption': '月ごと、カテゴリごとの読まれた回数の表',
} as const satisfies ScreenTexts<'s06' | 's06b'>;
