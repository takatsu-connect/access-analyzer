'use client';

import type { ArticleListData } from '@/lib/page-data';

import { LIST_SCREEN_IDS } from './screen-ids';
import { TopListScreen } from './TopListScreen';

/**
 * S-02a よく読まれた記事（05 §4.1、FR-20）と、そのイベント記事版の S-10a。
 * data は getArticleListData('top', section)。
 */
export function S02aScreen({ data }: { data: ArticleListData }) {
  return <TopListScreen data={data} screen={LIST_SCREEN_IDS[data.section].top} />;
}
