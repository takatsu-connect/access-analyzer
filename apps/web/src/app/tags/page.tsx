import type { Metadata } from 'next';

import { getTagIndexData } from '@/data';
import { t } from '@/lib/ui-text';
import { TagsScreen } from '@/screens/s07/TagsScreen';

export const metadata: Metadata = { title: t('s07.name') };

// S-07 シリーズ（タグ）別（05 §7.3）。ビルド時にデータを取り、画面の部品に渡すだけ。
export default async function TagsPage() {
  const data = await getTagIndexData();
  return <TagsScreen data={data} />;
}
