import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { getTagIds, getTagPageData } from '@/data';
import { t } from '@/lib/ui-text';
import { TagPageScreen } from '@/screens/s07/TagPageScreen';

export const metadata: Metadata = { title: t('s07b.name') };

// 記事のあるタグのページだけを作る（FR-42）。一覧にない ID は 404（06 §7）。
export const dynamicParams = false;

/** タグの ID の形。先頭が 0 でない 10 桁までの数。 */
const TAG_ID_PATTERN = /^[1-9][0-9]{0,9}$/;

export async function generateStaticParams(): Promise<{ id: string }[]> {
  const ids = await getTagIds();
  return ids.map((id) => ({ id: String(id) }));
}

// S-07b シリーズの記事（05 §7.3）。
export default async function TagPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!TAG_ID_PATTERN.test(id)) notFound();
  const data = await getTagPageData(Number(id));
  if (data === null) notFound();
  return <TagPageScreen data={data} />;
}
