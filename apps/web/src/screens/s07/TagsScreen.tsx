'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import a11y from '@/components/a11y.module.css';
import { MiniBar } from '@/components/charts';
import { cx } from '@/components/class-names';
import { Notice, StateMessage } from '@/components/Notice';
import { PeriodPicker } from '@/components/PeriodPicker';
import { absentCompareText, usePeriod } from '@/components/usePeriod';
import { formatNumber } from '@/lib/format';
import type { TagIndexData } from '@/lib/page-data';
import { isValidId } from '@/lib/query';
import { metricLabel, metricNote, t } from '@/lib/ui-text';
import styles from '@/screens/s06/shared/parts.module.css';
import { PrevDelta } from '@/screens/s06/shared/parts';

/** シリーズの記事（S-07b）へのリンク。ID が正の整数でなければリンクにしない。 */
function TagLink({ id, children }: { id: number; children: ReactNode }) {
  if (!isValidId(id)) return <>{children}</>;
  return (
    <Link href={`/tags/${id}`} prefetch={false} className={styles.link}>
      {children}
    </Link>
  );
}

/**
 * S-07 シリーズ（タグ）別（05 §7.3）。
 * 並びは名前の順で固定（データの順のまま描く）。読まれた回数の順への切り替えは置かない。
 */
export function TagsScreen({ data }: { data: TagIndexData }) {
  const { period, prevId, prevLabel, withheld, prevPartialDay, setPeriod } = usePeriod(
    data.periods,
    data.meta.measureStart,
  );
  const values = period === null ? undefined : data.period[period.id];
  const prevValues = prevId === null ? undefined : data.period[prevId];
  // 記事が 0 本のシリーズは行を出さない（FR-42）。
  const rows = data.tags.flatMap((tag) => {
    const value = values?.[tag.id];
    return value === undefined || value.postCount === 0 ? [] : [{ tag, value }];
  });
  const max = rows.reduce((largest, row) => Math.max(largest, row.value.pageviews), 0);

  return (
    <>
      <h1>{t('s07.h1')}</h1>
      {period === null ? null : (
        <PeriodPicker periods={data.periods} value={period.id} onChange={setPeriod} />
      )}
      <Notice>{metricNote('M33')}</Notice>
      <Notice>{t('s07.note')}</Notice>
      {rows.length === 0 ? (
        <StateMessage kind="empty" />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className={a11y.srOnly}>{t('s07.table.caption')}</caption>
            <thead>
              <tr>
                <th scope="col" className={styles.head}>
                  {t('column.tag')}
                </th>
                <th scope="col" className={cx(styles.head, styles.numeric)}>
                  {metricLabel('M01')}
                </th>
                <th scope="col" className={cx(styles.head, styles.numeric)}>
                  {prevLabel ?? t('s07.column.prev')}
                </th>
                <th scope="col" className={cx(styles.head, styles.numeric)}>
                  {t('s07.column.postCount')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ tag, value }) => (
                <tr key={tag.id}>
                  <th scope="row" className={cx(styles.cell, styles.rowHead)}>
                    <TagLink id={tag.id}>{tag.name}</TagLink>
                  </th>
                  <td className={cx(styles.cell, styles.numeric, styles.barCell)}>
                    {formatNumber(value.pageviews)}
                    <span className={styles.bar}>
                      <MiniBar
                        title={t('s07.bar.title', {
                          name: tag.name,
                          n: formatNumber(value.pageviews),
                        })}
                        value={value.pageviews}
                        max={max}
                      />
                    </span>
                  </td>
                  <td className={cx(styles.cell, styles.numeric)}>
                    <PrevDelta
                      current={value.pageviews}
                      previous={prevValues?.[tag.id]?.pageviews}
                      absentText={absentCompareText(withheld, 'prev')}
                      partialDay={prevPartialDay}
                    />
                  </td>
                  <td className={cx(styles.cell, styles.numeric)}>
                    {formatNumber(value.postCount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
