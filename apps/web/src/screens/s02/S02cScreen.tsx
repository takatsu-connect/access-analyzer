'use client';

import type { ArticleListData } from '@/lib/page-data';

import { TopListScreen } from './TopListScreen';

/** S-02c 長く読まれている記事（05 §4.3）。data は getArticleListData('long')。 */
export function S02cScreen({ data }: { data: ArticleListData }) {
  return <TopListScreen data={data} screen="s02c" />;
}
