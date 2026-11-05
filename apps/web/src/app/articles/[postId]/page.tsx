import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { getArticleDetailData, getArticleIds } from '@/data';
import type { ArticleDetailData } from '@/lib/page-data';
import { ArticleDetailScreen } from '@/screens/s03/ArticleDetailScreen';

// S-03 記事詳細（05 §5、04 §3.4）。全記事を静的生成し、一覧にない ID は 404 にする。

/** 記事の ID として受け付ける形（04 §8）。これ以外は数にせず、問い合わせもしない。 */
const POST_ID_PATTERN = /^[1-9][0-9]{0,9}$/;

type ArticlePageProps = { params: Promise<{ postId: string }> };

export const dynamicParams = false;

export async function generateStaticParams(): Promise<{ postId: string }[]> {
  const ids = await getArticleIds();
  return ids.map((id) => ({ postId: String(id) }));
}

/** 形を確かめてからデータを取る。形が違うとき、記事がないときは null。 */
async function loadArticle(postId: string): Promise<ArticleDetailData | null> {
  if (!POST_ID_PATTERN.test(postId)) return null;
  return getArticleDetailData(Number(postId));
}

export async function generateMetadata({ params }: ArticlePageProps): Promise<Metadata> {
  const { postId } = await params;
  const data = await loadArticle(postId);
  if (data === null) return {};
  // 記事のタイトルは文字列として渡す（Next.js が title 要素の中身としてエスケープする）。
  return { title: data.post.title };
}

export default async function ArticleDetailPage({ params }: ArticlePageProps) {
  const { postId } = await params;
  const data = await loadArticle(postId);
  if (data === null) notFound();
  return <ArticleDetailScreen data={data} />;
}
