import type { ReactNode } from 'react';

import { safeExternalUrl } from '@/lib/derive';

export type ExternalLinkProps = {
  /** pub_post.post_url / pub_author.author_url の値。利用者の入力から作らない。 */
  href: string | null | undefined;
  children: ReactNode;
  className?: string;
  /** 読み上げ用の名前（行き先と、新しいタブで開くことを言葉で書く）。 */
  ariaLabel?: string;
};

/**
 * 外部（高津コネクト）へのリンク（05 §2.7、06 §7、U-26）。a 要素を描けるのはこの部品だけ。
 *
 * 描く前に、リンク先が https://takatsu-connect.com/ の配下であることを確かめ直す。
 * 通らなければリンクにせず、中身だけを描く。新しいタブで開き、rel は noopener。
 */
export function ExternalLink({ href, children, className, ariaLabel }: ExternalLinkProps) {
  const safeHref = safeExternalUrl(href);
  if (safeHref === null) return <>{children}</>;
  return (
    <a href={safeHref} target="_blank" rel="noopener" className={className} aria-label={ariaLabel}>
      {children}
    </a>
  );
}
