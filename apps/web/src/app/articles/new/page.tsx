import type { Metadata } from 'next';

import { getArticleListData } from '@/data';
import { t } from '@/lib/ui-text';
import { S02bScreen } from '@/screens/s02/S02bScreen';

export const metadata: Metadata = { title: t('s02b.name') };

// S-02b 新着記事の立ち上がり（05 §4.2）。ビルド時にデータを取り、画面の部品に渡すだけ。
export default async function NewArticlesPage() {
  const data = await getArticleListData('new');
  return <S02bScreen data={data} />;
}
