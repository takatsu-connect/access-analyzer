import type { Metadata } from 'next';

import { getArticleListData } from '@/data';
import { t } from '@/lib/ui-text';
import { S02dScreen } from '@/screens/s02/S02dScreen';

export const metadata: Metadata = { title: t('s10d.name') };

// S-10d 最近よく読まれているイベント記事（S-02d のイベント記事版）。ビルド時にデータを取り、画面の部品に渡すだけ。
export default async function RecentEventsPage() {
  const data = await getArticleListData('recent', 'event');
  return <S02dScreen data={data} />;
}
