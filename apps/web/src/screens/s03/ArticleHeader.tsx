import { ExternalLink } from '@/components/ExternalLink';
import { AuthorLink } from '@/components/SiteLinks';
import { formatDate } from '@/lib/format';
import type { ArticleDetailData } from '@/lib/page-data';
import { t } from '@/lib/ui-text';

import styles from './s03.module.css';

export type ArticleHeaderProps = {
  post: ArticleDetailData['post'];
  /** 読まれた回数を数え始めた日（meta.measureStart）。 */
  measureStart: string;
};

/**
 * h1 と属性の行（M-21、M-30。FR-23 (1)）。
 * 数え始める前に公開した記事は「◯日目」を出さず、属性の直下に 1 文（s03.preMeasure.lead）を置く。
 * 著者の slug は href にだけ使う（AuthorLink）。slug が null の著者は名前だけを書く。
 */
export function ArticleHeader({ post, measureStart }: ArticleHeaderProps) {
  const separator = t('list.separator');
  const date = formatDate(post.publishedOn);
  const published = post.isPreMeasure
    ? t('s03.attr.published.only', { date })
    : t('s03.attr.published', {
        date,
        day: t('absent.dayN', { n: Math.max(post.ageDays, 1) }),
      });

  return (
    <>
      <h1>{t('s03.h1')}</h1>
      <p className={styles.title}>
        <ExternalLink
          href={post.url}
          className={styles.titleLink}
          ariaLabel={t('link.external.article', { title: post.title })}
        >
          {post.title}
          <span className={styles.externalMark} aria-hidden="true">
            {t('link.external.mark')}
          </span>
        </ExternalLink>
      </p>
      <ul className={styles.attrs}>
        <li>
          <AuthorLink slug={post.authorSlug}>{post.authorName}</AuthorLink>
        </li>
        <li>{published}</li>
        <li>{t(`freshness.${post.freshness}`)}</li>
        {post.categories.length === 0 ? null : (
          <li>
            {t('s03.attr.categories', {
              list: post.categories.map((category) => category.path).join(separator),
            })}
          </li>
        )}
        {post.tags.length === 0 ? null : (
          <li>{t('s03.attr.tags', { list: post.tags.map((tag) => tag.name).join(separator) })}</li>
        )}
      </ul>
      {post.isPreMeasure ? (
        <p className={styles.preMeasure}>
          {t('s03.preMeasure.lead', { start: formatDate(measureStart) })}
        </p>
      ) : null}
    </>
  );
}
