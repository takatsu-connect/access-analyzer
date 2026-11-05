import type { Metadata } from 'next';

import { getArticleListData } from '@/data';
import { t } from '@/lib/ui-text';
import { S02dScreen } from '@/screens/s02/S02dScreen';

export const metadata: Metadata = { title: t('s02d.name') };

// S-02d 最近よく読まれている記事（05 §4.4）。ビルド時にデータを取り、画面の部品に渡すだけ。
export default async function RecentArticlesPage() {
  const data = await getArticleListData('recent');
  return <S02dScreen data={data} />;
}
