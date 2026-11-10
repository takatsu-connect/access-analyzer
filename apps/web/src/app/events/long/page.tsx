import type { Metadata } from 'next';

import { getArticleListData } from '@/data';
import { t } from '@/lib/ui-text';
import { S02cScreen } from '@/screens/s02/S02cScreen';

export const metadata: Metadata = { title: t('s10c.name') };

// S-10c 長く読まれているイベント記事（S-02c のイベント記事版）。ビルド時にデータを取り、画面の部品に渡すだけ。
export default async function LongEventsPage() {
  const data = await getArticleListData('long', 'event');
  return <S02cScreen data={data} />;
}
