/**
 * S-08（投稿活動）の文言。src/lib/ui-text.ts の辞書にまとめて入り、t() で引く。
 *
 * 書き方の決まり:
 * - キーは 's08.' で始める、点区切りの平らな文字列にする。src/lib/ui-text.ts にあるキーと重ねない。
 * - 05 §2.1 の「使わない語」と「出ません」で終わる文を入れない（コメントにも書かない）。
 * - 差し込み値は {name} の形で書く（例: 's08.sample': '{n} 本の記事' → t('s08.sample', { n })）。
 */
import type { ScreenTexts } from './types';

export const S08_TEXT = {
  // --- 主文（05 §8）。人数は書かない（FR-51） ---
  's08.lead': 'この期間に {n} 本の記事が公開されました。',
  // ここから下は仮の初期値。
  's08.posts': '{n} 本',
  // 比較の相手が決まらないとき（前の期間がない月）の言い方。ふだんは「前の 28 日と比べて」など。
  's08.column.prev': '前の期間と比べて',
  // 前の期間の不在は共通の absent.prev を使う。
  // この期間に公開した記事がないとき（ライターの表、カテゴリの表）。
  's08.empty': 'この期間に公開された記事はありません',

  // --- 月ごとの公開本数 ---
  's08.monthly.h2': '月ごとの公開本数（直近 24 か月）',
  's08.monthly.chart': '月ごとの公開本数の図',
  's08.monthly.title': '{month}: {n} 本',
  's08.monthly.title.yoy': '{month}: {n} 本（去年の同じ月: {yoy} 本）',
  's08.monthly.legend.current': '塗り: その月の本数',
  's08.monthly.legend.yoy': '細い枠: 去年の同じ月の本数',
  's08.monthly.yoy': '去年の同じ月',
  's08.monthly.table.summary': '同じ数字を表で見る',
  's08.monthly.table.caption': '月ごとの公開本数の表',

  // --- この期間に記事を公開したライター ---
  's08.authors.count': 'この期間の本数',

  // --- どんな記事が多かった？（FR-52） ---
  's08.mix.h2': 'どんな記事が多かった？',
  's08.mix.column.category': 'カテゴリ',
  's08.mix.column.count': 'この期間に公開した本数',
  's08.mix.column.prev': '{label}（本数の差）',
  's08.mix.note':
    '1 つの記事が複数のカテゴリに入ることがあるので、本数を足しても公開した本数とは一致しません。',
} as const satisfies ScreenTexts<'s08'>;
