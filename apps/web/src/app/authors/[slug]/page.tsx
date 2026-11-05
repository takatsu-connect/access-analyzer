import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { getAuthorPageData, getAuthorSlugs } from '@/data';
import { t } from '@/lib/ui-text';
import { AuthorScreen } from '@/screens/s05/AuthorScreen';

type AuthorPageProps = { params: Promise<{ slug: string }> };

/** 著者の slug の形（04 §8、06 §7）。合わない値では、データを引かずに 404 にする。 */
const SLUG_PATTERN = /^[a-z0-9-]{1,64}$/;

// ビルド時に作ったページだけを返す。一覧にない slug は 404（05 §10）。
export const dynamicParams = false;

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  const slugs = await getAuthorSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: AuthorPageProps): Promise<Metadata> {
  const { slug } = await params;
  if (!SLUG_PATTERN.test(slug)) return {};
  const data = await getAuthorPageData(slug);
  // 題名には表示名を使う。slug は文字として出さない。
  return data === null ? {} : { title: t('s05.title', { name: data.author.name }) };
}

// S-05 著者ページ（05 §6.2）。データを取り、画面の部品に渡すだけ。
export default async function AuthorPage({ params }: AuthorPageProps) {
  const { slug } = await params;
  if (!SLUG_PATTERN.test(slug)) notFound();
  const data = await getAuthorPageData(slug);
  if (data === null) notFound();
  return <AuthorScreen data={data} />;
}
