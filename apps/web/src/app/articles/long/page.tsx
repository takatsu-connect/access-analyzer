import type { Metadata } from 'next';

import { getArticleListData } from '@/data';
import { t } from '@/lib/ui-text';
import { S02cScreen } from '@/screens/s02/S02cScreen';

export const metadata: Metadata = { title: t('s02c.name') };

// S-02c 長く読まれている記事（05 §4.3）。ビルド時にデータを取り、画面の部品に渡すだけ。
export default async function LongArticlesPage() {
  const data = await getArticleListData('long');
  return <S02cScreen data={data} />;
}
