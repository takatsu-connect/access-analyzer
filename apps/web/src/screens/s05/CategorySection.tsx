'use client';

import a11y from '@/components/a11y.module.css';
import { StateMessage } from '@/components/Notice';
import { formatNumber } from '@/lib/format';
import type { AuthorPageData, SelectablePeriodId } from '@/lib/page-data';
import { t } from '@/lib/ui-text';

import styles from './s05.module.css';

export type CategorySectionProps = {
  data: AuthorPageData;
  periodId: SelectablePeriodId;
};

/**
 * h2 どのカテゴリの記事を書いたか（FR-33。M-32）。
 * 本人の記事の内訳なので、読まれた回数の多い順に並べる。連番は付けない。伏せ値はない。
 * 記事数は、期間によらない「これまでの記事数」（pub_author_category_period.post_count。02 §4）。
 * 読まれた回数は、選んだ期間の値。
 */
export function CategorySection({ data, periodId }: CategorySectionProps) {
  const rows = [...(data.categoryMix[periodId] ?? [])].sort(
    (left, right) => right.pageviews - left.pageviews || left.path.localeCompare(right.path, 'ja'),
  );

  return (
    <section className={styles.section}>
      <h2>{t('s05.category.h2')}</h2>
      {rows.length === 0 ? (
        <StateMessage kind="empty" />
      ) : (
        <table className={styles.table}>
          <caption className={a11y.srOnly}>
            {t('s05.category.caption', { name: data.author.name })}
          </caption>
          <thead>
            <tr>
              <th scope="col">{t('column.category')}</th>
              <th scope="col" className={styles.numeric}>
                {t('s05.category.column.posts')}
              </th>
              <th scope="col" className={styles.numeric}>
                {t('column.pageviews.period')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.categoryId}>
                <th scope="row">{row.path}</th>
                <td className={styles.numeric}>{formatNumber(row.postCount)}</td>
                <td className={styles.numeric}>{formatNumber(row.pageviews)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
