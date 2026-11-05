import type { Metadata } from 'next';

import { getAuthorIndexData } from '@/data';
import { t } from '@/lib/ui-text';
import { AuthorIndexScreen } from '@/screens/s05/AuthorIndexScreen';

export const metadata: Metadata = { title: t('s04.h1') };

// S-04 著者一覧（05 §6.1）。ビルド時にデータを読み、名前のリストを静的に描く。
export default async function AuthorsPage() {
  const data = await getAuthorIndexData();
  return <AuthorIndexScreen data={data} />;
}
