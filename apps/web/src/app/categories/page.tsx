import type { Metadata } from 'next';

import { getCategoryData } from '@/data';
import { t } from '@/lib/ui-text';
import { CategoriesScreen } from '@/screens/s06/CategoriesScreen';

export const metadata: Metadata = { title: t('s06.name') };

// S-06 カテゴリ別（05 §7.1）。ビルド時にデータを取り、画面の部品に渡すだけ。
export default async function CategoriesPage() {
  const data = await getCategoryData();
  return <CategoriesScreen data={data} />;
}
