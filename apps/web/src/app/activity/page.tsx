import type { Metadata } from 'next';

import { getActivityData } from '@/data';
import { t } from '@/lib/ui-text';
import { ActivityScreen } from '@/screens/s08/ActivityScreen';

export const metadata: Metadata = { title: t('s08.name') };

// S-08 投稿活動（05 §8）。ビルド時にデータを取り、画面の部品に渡すだけ。
export default async function ActivityPage() {
  const data = await getActivityData();
  return <ActivityScreen data={data} />;
}
