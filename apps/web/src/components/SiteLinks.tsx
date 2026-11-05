import Link from 'next/link';
import type { ReactNode } from 'react';

export type ArticleLinkProps = {
  /** 記事の ID（PostRow.id）。正の整数でなければリンクにしない。 */
  postId: number;
  children: ReactNode;
  className?: string;
};

/**
 * 記事詳細（S-03、/articles/[postId]）へのサイト内リンク。
 * 一覧に何十件も並ぶので、先読みはしない。
 */
export function ArticleLink({ postId, children, className }: ArticleLinkProps) {
  if (!Number.isSafeInteger(postId) || postId <= 0) return <>{children}</>;
  return (
    <Link href={`/articles/${postId}`} prefetch={false} className={className}>
      {children}
    </Link>
  );
}

export type AuthorLinkProps = {
  /** 著者の slug。href にだけ使い、画面の文字にしない。null（著者ページがない）ならリンクにしない。 */
  slug: string | null | undefined;
  /** 著者の表示名。 */
  children: ReactNode;
  className?: string;
};

/** 著者ページ（S-05、/authors/[slug]）へのサイト内リンク。 */
export function AuthorLink({ slug, children, className }: AuthorLinkProps) {
  if (typeof slug !== 'string' || slug === '') return <>{children}</>;
  return (
    <Link href={`/authors/${encodeURIComponent(slug)}`} prefetch={false} className={className}>
      {children}
    </Link>
  );
}
