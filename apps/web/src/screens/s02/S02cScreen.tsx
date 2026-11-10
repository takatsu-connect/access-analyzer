'use client';

import type { ArticleListData } from '@/lib/page-data';

import { LIST_SCREEN_IDS } from './screen-ids';
import { TopListScreen } from './TopListScreen';

/**
 * S-02c 長く読まれている記事（05 §4.3）と、そのイベント記事版の S-10c。
 * data は getArticleListData('long', section)。
 */
export function S02cScreen({ data }: { data: ArticleListData }) {
  return <TopListScreen data={data} screen={LIST_SCREEN_IDS[data.section].long} />;
}
