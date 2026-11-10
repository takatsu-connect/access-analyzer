import type { Metadata } from 'next';

import { getArticleListData } from '@/data';
import { t } from '@/lib/ui-text';
import { S02aScreen } from '@/screens/s02/S02aScreen';

export const metadata: Metadata = { title: t('s10a.name') };

// S-10a よく読まれたイベント記事（S-02a のイベント記事版）。ビルド時にデータを取り、画面の部品に渡すだけ。
export default async function TopEventsPage() {
  const data = await getArticleListData('top', 'event');
  return <S02aScreen data={data} />;
}
