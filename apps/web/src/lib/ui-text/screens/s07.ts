/**
 * S-07（シリーズ別）と S-07b（シリーズの記事）の文言。src/lib/ui-text.ts の辞書にまとめて入り、
 * t() で引く。
 *
 * 書き方の決まり:
 * - キーは 's07.' か 's07b.' で始める、点区切りの平らな文字列にする。
 *   src/lib/ui-text.ts にあるキーと重ねない。
 * - 05 §2.1 の「使わない語」と「出ません」で終わる文を入れない（コメントにも書かない）。
 * - 差し込み値は {name} の形で書く（例: 's07.sample': '{n} 本の記事' → t('s07.sample', { n })）。
 */
import type { ScreenTexts } from './types';

export const S07_TEXT = {} as const satisfies ScreenTexts<'s07' | 's07b'>;
