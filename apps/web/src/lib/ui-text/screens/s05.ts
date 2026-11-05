/**
 * S-04（著者一覧）と S-05（著者ページ）の文言。src/lib/ui-text.ts の辞書にまとめて入り、t() で引く。
 *
 * 書き方の決まり:
 * - キーは 's04.' か 's05.' で始める、点区切りの平らな文字列にする。
 *   src/lib/ui-text.ts にあるキーと重ねない。
 * - 05 §2.1 の「使わない語」と「出ません」で終わる文を入れない（コメントにも書かない）。
 * - 差し込み値は {name} の形で書く（例: 's05.sample': '{n} 本の記事' → t('s05.sample', { n })）。
 */
import type { ScreenTexts } from './types';

export const S05_TEXT = {} as const satisfies ScreenTexts<'s04' | 's05'>;
