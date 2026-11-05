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

export const S02_TEXT = {} as const satisfies ScreenTexts<
  's02' | 's02a' | 's02b' | 's02c' | 's02d' | 's02e'
>;
