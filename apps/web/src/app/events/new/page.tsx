import type { Metadata } from 'next';

import { getArticleListData } from '@/data';
import { t } from '@/lib/ui-text';
import { S02bScreen } from '@/screens/s02/S02bScreen';

export const metadata: Metadata = { title: t('s10b.name') };

// S-10b 新着イベント記事の立ち上がり（S-02b のイベント記事版）。ビルド時にデータを取り、画面の部品に渡すだけ。
export default async function NewEventsPage() {
  const data = await getArticleListData('new', 'event');
  return <S02bScreen data={data} />;
}
