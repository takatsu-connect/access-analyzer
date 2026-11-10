/**
 * 記事の種類 → 一覧の画面 ID（05 §1）。「記事」タブは S-02a〜S-02e、「イベント記事」タブは
 * S-10a〜S-10e。画面の部品は同じで、文言のキーの接頭辞と URL のクエリの許可リストの画面だけが変わる。
 */
import type { ArticleSection } from '@/lib/page-data';

export const LIST_SCREEN_IDS = {
  article: { top: 's02a', new: 's02b', long: 's02c', recent: 's02d', search: 's02e' },
  event: { top: 's10a', new: 's10b', long: 's10c', recent: 's10d', search: 's10e' },
} as const satisfies Record<ArticleSection, Record<string, string>>;

export type ListScreenIds = (typeof LIST_SCREEN_IDS)[ArticleSection];
