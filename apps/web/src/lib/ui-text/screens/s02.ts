/**
 * S-02（記事一覧。S-02a〜S-02e）の文言。src/lib/ui-text.ts の辞書にまとめて入り、t() で引く。
 *
 * 書き方の決まり:
 * - キーは 's02.'（共通）か 's02a.'〜's02e.' で始める、点区切りの平らな文字列にする。
 *   src/lib/ui-text.ts にあるキーと重ねない。
 * - 05 §2.1 の「使わない語」と「出ません」で終わる文を入れない（コメントにも書かない）。
 * - 差し込み値は {name} の形で書く（例: 's02.sample': '{n} 本の記事' → t('s02.sample', { n })）。
 */
import type { ScreenTexts } from './types';

export const S02_TEXT = {
  // --- 件数の切り替え（S-02a、S-02c。05 §2.5） ---
  's02.count.label': '件数',

  // --- 記事を探す（S-02e。05 §4.5）。どれも仮の初期値 ---
  's02e.filter.label': '絞り込み',
  's02e.filter.q': 'タイトルに含む語',
  's02e.filter.category': 'カテゴリ',
  's02e.filter.author': 'ライター',
  's02e.filter.ym': '公開年月',
  's02e.filter.all': 'すべて',
  's02e.filter.clear': '条件を消す',
  // 絞り込みなし、または親カテゴリだけのときに出す、並びの説明（操作はできない）。
  's02e.sort.fixed': '並び: 公開日の新しい順',
  's02e.count': '{n} 件',
  's02e.empty': '条件に合う記事はありません。条件を変えるか、「条件を消す」を押してください。',
} as const satisfies ScreenTexts<'s02' | 's02a' | 's02b' | 's02c' | 's02d' | 's02e'>;
