import type { Metadata } from 'next';

import { getArticleListData } from '@/data';
import { t } from '@/lib/ui-text';
import { S02eScreen } from '@/screens/s02/S02eScreen';

export const metadata: Metadata = { title: t('s10e.name') };

// S-10e イベント記事を探す（S-02e のイベント記事版）。ビルド時にデータを取り、画面の部品に渡すだけ。
export default async function SearchEventsPage() {
  const data = await getArticleListData('search', 'event');
  return <S02eScreen data={data} />;
}
