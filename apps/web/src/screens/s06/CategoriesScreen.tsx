'use client';

import Link from 'next/link';
import { Fragment, useId } from 'react';
import type { ReactNode } from 'react';

import a11y from '@/components/a11y.module.css';
import { MiniBar } from '@/components/charts';
import { cx } from '@/components/class-names';
import { Details } from '@/components/Details';
import { Notice, StateMessage } from '@/components/Notice';
import { PeriodPicker } from '@/components/PeriodPicker';
import { absentCompareText, usePeriod } from '@/components/usePeriod';
import { AD_CATEGORY_ID } from '@/lib/config';
import { monthProgress } from '@/lib/derive';
import { formatNumber } from '@/lib/format';
import type { CategoryAxis, CategoryData, CategoryPeriodValue, Period } from '@/lib/page-data';
import { metricLabel, t } from '@/lib/ui-text';

import styles from './shared/parts.module.css';
import { PrevDelta, Totals } from './shared/parts';

type PeriodValues = Readonly<Record<number, CategoryPeriodValue>>;

/** 子カテゴリで絞った「記事を探す」（S-02e）へのリンク。クエリには ID の数だけを入れる。 */
function CategoryLink({ id, children }: { id: number; children: ReactNode }) {
  if (!Number.isSafeInteger(id) || id <= 0) return <>{children}</>;
  return (
    <Link
      href={{ pathname: '/articles', query: { cat: String(id) } }}
      prefetch={false}
      className={styles.link}
    >
      {children}
    </Link>
  );
}

/** 1 本あたり（真ん中の記事）。母数が 0 なら「該当なし」（伏せ値ではない。04 §3.9）。 */
function medianOf(value: CategoryPeriodValue): number | null {
  return value.median30Count === 0 ? null : value.median30;
}

/**
 * 「真ん中の記事が、最初の 1 か月に読まれた回数」に値がありうる期間か（助言 A-1）。
 * 定義は「この期間に公開して 30 日たった記事」なので、直近 7 日・直近 28 日・月の途中の月では
 * 当てはまる記事がない。直近 90 日と、終わった月（確定・ほぼ確定）だけで行を出す。
 */
function medianApplies(period: Period): boolean {
  if (period.kind === 'month') return monthProgress(period) !== 'inProgress';
  return period.id === 'last90';
}

type AxisSectionProps = {
  axis: CategoryAxis;
  values: PeriodValues;
  prevValues: PeriodValues | undefined;
  /** 「前の 28 日と比べて」など。 */
  compareLabel: string;
  /** 前の期間の値がないときの文（月の途中なら「月が終わると…」）。 */
  absentText: string;
  /** 前の期間が数え始めた月なら、数え始めた日。 */
  partialDay: number | null;
  /** 真ん中の値の行を出すか（medianApplies）。 */
  showMedian: boolean;
};

/** 軸（記事、イベント、マップ、広告）ごとの合計と、子カテゴリの表。 */
function AxisSection({
  axis,
  values,
  prevValues,
  compareLabel,
  absentText,
  partialDay,
  showMedian,
}: AxisSectionProps) {
  const headingId = useId();
  const total = values[axis.parent.id];
  // 記事が 0 本の子は行を出さない。子は読まれた回数の多い順（カテゴリは人ではない）。
  const rows = axis.children
    .flatMap((child) => {
      const value = values[child.id];
      return value === undefined || value.postCountTotal === 0 ? [] : [{ child, value }];
    })
    .sort(
      (left, right) =>
        right.value.pageviews - left.value.pageviews || left.child.id - right.child.id,
    );
  const max = rows.reduce((largest, row) => Math.max(largest, row.value.pageviews), 0);
  const medianLabel = t('column.median30');
  const publishedLabel = t('s06.column.published');

  const prevDelta = (id: number, current: number): ReactNode => (
    <PrevDelta
      current={current}
      previous={prevValues?.[id]?.pageviews}
      absentText={absentText}
      partialDay={partialDay}
    />
  );
  const medianText = (value: CategoryPeriodValue): string => {
    const median = medianOf(value);
    return median === null ? t('s06.median.absent') : formatNumber(median);
  };
  const totalItems =
    total === undefined
      ? []
      : [
          {
            label: metricLabel('M01'),
            value: t('s06.count', { n: formatNumber(total.pageviews) }),
          },
          { label: compareLabel, value: prevDelta(axis.parent.id, total.pageviews) },
          {
            label: t('s06.column.postCountTotal'),
            value: t('s06.posts', { n: formatNumber(total.postCountTotal) }),
          },
          {
            label: publishedLabel,
            value: t('s06.posts', { n: formatNumber(total.postCountPublished) }),
          },
          ...(showMedian
            ? [
                {
                  label: medianLabel,
                  value:
                    medianOf(total) === null
                      ? t('s06.median.absent')
                      : t('s06.count', { n: medianText(total) }),
                },
              ]
            : []),
        ];

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId}>{axis.parent.name}</h2>
      {total === undefined ? (
        <StateMessage kind="empty" />
      ) : (
        <>
          <Totals label={t('s06.total')} items={totalItems} />
          {showMedian ? <Notice>{t('s06.median.note')}</Notice> : null}
        </>
      )}
      {axis.parent.id === AD_CATEGORY_ID ? <Notice>{t('s06.ad.note')}</Notice> : null}
      {rows.length === 0 ? null : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className={a11y.srOnly}>
              {t('s06.table.caption', { name: axis.parent.name })}
            </caption>
            <thead>
              <tr>
                <th scope="col" className={styles.head}>
                  {t('s06.column.child')}
                </th>
                <th scope="col" className={cx(styles.head, styles.numeric)}>
                  {metricLabel('M01')}
                </th>
                <th scope="col" className={cx(styles.head, styles.numeric)}>
                  {compareLabel}
                </th>
                <th scope="col" className={cx(styles.head, styles.numeric)}>
                  {t('s06.column.postCountTotal')}
                </th>
                <th scope="col" className={cx(styles.head, styles.numeric, styles.wideOnly)}>
                  {publishedLabel}
                </th>
                {showMedian ? (
                  <th scope="col" className={cx(styles.head, styles.numeric, styles.wideOnly)}>
                    {medianLabel}
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ child, value }) => (
                <Fragment key={child.id}>
                  <tr className={styles.hasMore}>
                    <th scope="row" className={cx(styles.cell, styles.rowHead)}>
                      <CategoryLink id={child.id}>{child.name}</CategoryLink>
                    </th>
                    <td className={cx(styles.cell, styles.numeric, styles.barCell)}>
                      {formatNumber(value.pageviews)}
                      <span className={styles.bar}>
                        <MiniBar
                          title={t('s06.bar.title', {
                            name: child.name,
                            n: formatNumber(value.pageviews),
                          })}
                          value={value.pageviews}
                          max={max}
                        />
                      </span>
                    </td>
                    <td className={cx(styles.cell, styles.numeric)}>
                      {prevDelta(child.id, value.pageviews)}
                    </td>
                    <td className={cx(styles.cell, styles.numeric)}>
                      {formatNumber(value.postCountTotal)}
                    </td>
                    <td className={cx(styles.cell, styles.numeric, styles.wideOnly)}>
                      {formatNumber(value.postCountPublished)}
                    </td>
                    {showMedian ? (
                      <td className={cx(styles.cell, styles.numeric, styles.wideOnly)}>
                        {medianText(value)}
                      </td>
                    ) : null}
                  </tr>
                  <tr className={styles.narrowOnly}>
                    <td colSpan={4} className={styles.moreCell}>
                      <Details
                        summary={
                          <>
                            {t('column.more')}
                            <span className={a11y.srOnly}>{child.name}</span>
                          </>
                        }
                      >
                        <dl className={styles.detailList}>
                          <dt>{publishedLabel}</dt>
                          <dd>{formatNumber(value.postCountPublished)}</dd>
                          {showMedian ? (
                            <>
                              <dt>{medianLabel}</dt>
                              <dd>{medianText(value)}</dd>
                            </>
                          ) : null}
                        </dl>
                      </Details>
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * S-06 カテゴリ別（05 §7.1）。軸ごとに、合計と子カテゴリの表を出す。
 * 見出しは親カテゴリの名前だけで、設計の語（軸）は画面に出さない。
 */
export function CategoriesScreen({ data }: { data: CategoryData }) {
  const { period, prevId, prevLabel, withheld, prevPartialDay, setPeriod } = usePeriod(
    data.periods,
    data.meta.measureStart,
  );
  const values = period === null ? undefined : data.period[period.id];
  const prevValues = prevId === null ? undefined : data.period[prevId];
  const hasAny =
    values !== undefined &&
    data.axes.some(
      (axis) =>
        values[axis.parent.id] !== undefined ||
        axis.children.some((child) => values[child.id] !== undefined),
    );

  return (
    <>
      <h1>{t('s06.h1')}</h1>
      {period === null ? null : (
        <PeriodPicker periods={data.periods} value={period.id} onChange={setPeriod} />
      )}
      <Notice>{t('s06.note')}</Notice>
      <p className={styles.nav}>
        <Link href="/categories/seasonal" prefetch={false} className={styles.link}>
          {t('s06b.h1')}
        </Link>
      </p>
      {values === undefined || !hasAny ? (
        <StateMessage kind="empty" />
      ) : (
        data.axes.map((axis) => (
          <AxisSection
            key={axis.parent.id}
            axis={axis}
            values={values}
            prevValues={prevValues}
            compareLabel={prevLabel ?? t('s06.column.prev')}
            absentText={absentCompareText(withheld, 'prev')}
            partialDay={prevPartialDay}
            showMedian={period !== null && medianApplies(period)}
          />
        ))
      )}
    </>
  );
}
