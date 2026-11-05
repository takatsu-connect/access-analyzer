import type { Metadata } from 'next';

import { getArticleListData } from '@/data';
import { t } from '@/lib/ui-text';
import { S02eScreen } from '@/screens/s02/S02eScreen';

export const metadata: Metadata = { title: t('s02e.name') };

// S-02e 記事を探す（05 §4.5）。ビルド時にデータを取り、画面の部品に渡すだけ。
export default async function SearchArticlesPage() {
  const data = await getArticleListData('search');
  return <S02eScreen data={data} />;
}
