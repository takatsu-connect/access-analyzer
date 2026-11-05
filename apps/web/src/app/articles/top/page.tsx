import type { Metadata } from 'next';

import { getArticleListData } from '@/data';
import { t } from '@/lib/ui-text';
import { S02aScreen } from '@/screens/s02/S02aScreen';

export const metadata: Metadata = { title: t('s02a.name') };

// S-02a よく読まれた記事（05 §4.1）。ビルド時にデータを取り、画面の部品に渡すだけ。
export default async function TopArticlesPage() {
  const data = await getArticleListData('top');
  return <S02aScreen data={data} />;
}
