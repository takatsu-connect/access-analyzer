'use client';

import type { ArticleListData } from '@/lib/page-data';

import { TopListScreen } from './TopListScreen';

/** S-02a よく読まれた記事（05 §4.1、FR-20）。data は getArticleListData('top')。 */
export function S02aScreen({ data }: { data: ArticleListData }) {
  return <TopListScreen data={data} screen="s02a" />;
}
