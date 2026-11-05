'use client';

import a11y from '@/components/a11y.module.css';
import { cx } from '@/components/class-names';
import { Details } from '@/components/Details';
import { Notice, StateMessage } from '@/components/Notice';
import { PeriodPicker } from '@/components/PeriodPicker';
import { AuthorLink } from '@/components/SiteLinks';
import { usePeriod } from '@/components/usePeriod';
import { share } from '@/lib/derive';
import { formatNumber, formatShare, formatYearMonth } from '@/lib/format';
import type { ActivityData } from '@/lib/page-data';
import { t } from '@/lib/ui-text';
import parts from '@/screens/s06/shared/parts.module.css';
import { PrevDelta } from '@/screens/s06/shared/parts';

import styles from './activity.module.css';
import { MonthlyBars } from './MonthlyBars';
import type { MonthlyBarRow } from './MonthlyBars';

/** 図に出す月の数（05 §8）。 */
const MONTHS = 24;

/** 'YYYY-MM' の前年の同じ月。 */
function yoyOf(month: string): string {
  return `${Number(month.slice(0, 4)) - 1}${month.slice(4)}`;
}

/**
 * S-08 投稿活動（05 §8）。
 *
 * - 主文は本数だけ。人数は出さない（FR-51）。
 * - ライターの表は名前の順で固定（データの順のまま）。並べ替えも番号もなく、本数が 1 本以上の人だけ。
 * - カテゴリの割合は、期間の公開本数が 20 本以上のときだけ出す（05 §2.3）。
 */
export function ActivityScreen({ data }: { data: ActivityData }) {
  const { period, prevId, prevLabel, setPeriod } = usePeriod(data.periods);
  const periodId = period?.id ?? null;
  const compareLabel = prevLabel ?? t('s08.column.prev');
  const absentPrev = t('s08.absent.prev');

  const posting = periodId === null ? undefined : data.posting[periodId];
  const prevPosting = prevId === null ? undefined : data.posting[prevId];

  // --- 月ごとの公開本数。新しい月を上にする ---
  const unconfirmed = new Set<string>(
    data.periods
      .filter((item) => item.kind === 'month' && !item.isConfirmed)
      .map((item) => item.id),
  );
  const countByMonth = new Map(data.monthly.map((item) => [item.month, item.postCount]));
  const monthlyRows: MonthlyBarRow[] = data.monthly
    .slice(-MONTHS)
    .reverse()
    .map(({ month, postCount }) => {
      const name = formatYearMonth(month);
      const label = unconfirmed.has(`m${month}`)
        ? t('period.month.unconfirmed', { label: name })
        : name;
      const yoy = countByMonth.get(yoyOf(month)) ?? null;
      return {
        key: month,
        label,
        value: postCount,
        yoy,
        valueText: t('s08.posts', { n: formatNumber(postCount) }),
        title:
          yoy === null
            ? t('s08.monthly.title', { month: label, n: formatNumber(postCount) })
            : t('s08.monthly.title.yoy', {
                month: label,
                n: formatNumber(postCount),
                yoy: formatNumber(yoy),
              }),
      };
    });

  // --- ライター。期間内に 1 本以上公開した人だけ。データの順（名前の順）のまま ---
  const authors = (periodId === null ? undefined : data.authorCounts[periodId])?.filter(
    (author) => author.postCount >= 1,
  );

  // --- カテゴリ。本数の多い順（カテゴリは人ではない） ---
  const mix = periodId === null ? undefined : data.categoryMix[periodId];
  const prevMix = prevId === null ? undefined : data.categoryMix[prevId];
  const mixRows = [...(mix ?? [])].sort(
    (left, right) =>
      right.postCountPublished - left.postCountPublished || left.categoryId - right.categoryId,
  );
  const shares = share(
    mixRows.map((row) => row.postCountPublished),
    posting?.postCount ?? null,
  );
  const hasShare = shares.some((value) => value !== null);
  const prevCountOf = (categoryId: number): number | undefined =>
    prevMix === undefined
      ? undefined
      : (prevMix.find((row) => row.categoryId === categoryId)?.postCountPublished ?? 0);

  return (
    <>
      <h1>{t('s08.h1')}</h1>
      {period === null ? null : (
        <PeriodPicker periods={data.periods} value={period.id} onChange={setPeriod} />
      )}
      {posting === undefined ? (
        <StateMessage kind="empty" />
      ) : (
        <>
          <p className={styles.lead}>{t('s08.lead', { n: formatNumber(posting.postCount) })}</p>
          <p className={styles.leadCompare}>
            <span>{compareLabel}</span>
            <span>{t('column.postCount')}</span>
            <PrevDelta
              current={posting.postCount}
              previous={prevPosting?.postCount}
              absentText={absentPrev}
              diffOnly
            />
          </p>
        </>
      )}

      <section className={parts.section}>
        <h2>{t('s08.monthly.h2')}</h2>
        {monthlyRows.length === 0 ? (
          <StateMessage kind="empty" />
        ) : (
          <>
            <MonthlyBars
              title={t('s08.monthly.chart')}
              rows={monthlyRows}
              legend={{
                current: t('s08.monthly.legend.current'),
                yoy: t('s08.monthly.legend.yoy'),
              }}
            />
            <Details summary={t('s08.monthly.table.summary')}>
              <table className={parts.table}>
                <caption className={a11y.srOnly}>{t('s08.monthly.table.caption')}</caption>
                <thead>
                  <tr>
                    <th scope="col" className={parts.head}>
                      {t('column.month')}
                    </th>
                    <th scope="col" className={cx(parts.head, parts.numeric)}>
                      {t('column.postCount')}
                    </th>
                    <th scope="col" className={cx(parts.head, parts.numeric)}>
                      {t('s08.monthly.yoy')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyRows.map((row) => (
                    <tr key={row.key}>
                      <th scope="row" className={parts.cell}>
                        {row.label}
                      </th>
                      <td className={cx(parts.cell, parts.numeric)}>{formatNumber(row.value)}</td>
                      <td className={cx(parts.cell, parts.numeric)}>
                        {row.yoy === null ? (
                          <span className={parts.absent}>{t('absent.yoy')}</span>
                        ) : (
                          formatNumber(row.yoy)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Details>
          </>
        )}
      </section>

      <section className={parts.section}>
        <h2>{t('s08.authors.h2')}</h2>
        {authors === undefined ? (
          <StateMessage kind="empty" />
        ) : authors.length === 0 ? (
          <StateMessage kind="empty">{t('s02b.empty')}</StateMessage>
        ) : (
          <div className={parts.tableWrap}>
            <table className={parts.table}>
              <caption className={a11y.srOnly}>{t('s08.authors.h2')}</caption>
              <thead>
                <tr>
                  <th scope="col" className={parts.head}>
                    {t('column.author')}
                  </th>
                  <th scope="col" className={cx(parts.head, parts.numeric)}>
                    {t('s08.authors.count')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {authors.map((author) => (
                  <tr key={`${author.slug ?? ''}:${author.name}`}>
                    <th scope="row" className={cx(parts.cell, parts.rowHead)}>
                      <AuthorLink slug={author.slug} className={parts.link}>
                        {author.name}
                      </AuthorLink>
                    </th>
                    <td className={cx(parts.cell, parts.numeric)}>
                      {formatNumber(author.postCount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Notice>{t('s08.authors.note')}</Notice>
      </section>

      <section className={parts.section}>
        <h2>{t('s08.mix.h2')}</h2>
        {mix === undefined ? (
          <StateMessage kind="empty" />
        ) : mixRows.length === 0 ? (
          <StateMessage kind="empty">{t('s02b.empty')}</StateMessage>
        ) : (
          <>
            <div className={parts.tableWrap}>
              <table className={parts.table}>
                <caption className={a11y.srOnly}>{t('s08.mix.h2')}</caption>
                <thead>
                  <tr>
                    <th scope="col" className={parts.head}>
                      {t('s08.mix.column.category')}
                    </th>
                    <th scope="col" className={cx(parts.head, parts.numeric)}>
                      {t('s08.mix.column.count')}
                    </th>
                    {hasShare ? (
                      <th scope="col" className={cx(parts.head, parts.numeric)}>
                        {t('column.share')}
                      </th>
                    ) : null}
                    <th scope="col" className={cx(parts.head, parts.numeric)}>
                      {t('s08.mix.column.prev', { label: compareLabel })}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {mixRows.map((row, index) => {
                    const ratio = shares[index] ?? null;
                    return (
                      <tr key={row.categoryId}>
                        <th scope="row" className={cx(parts.cell, parts.rowHead)}>
                          {row.path}
                        </th>
                        <td className={cx(parts.cell, parts.numeric)}>
                          {formatNumber(row.postCountPublished)}
                        </td>
                        {hasShare ? (
                          <td className={cx(parts.cell, parts.numeric)}>
                            {ratio === null ? t('absent.na') : formatShare(ratio)}
                          </td>
                        ) : null}
                        <td className={cx(parts.cell, parts.numeric)}>
                          <PrevDelta
                            current={row.postCountPublished}
                            previous={prevCountOf(row.categoryId)}
                            absentText={absentPrev}
                            diffOnly
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {hasShare ? null : <Notice>{t('s08.mix.share.note')}</Notice>}
            <Notice>{t('s08.mix.note')}</Notice>
          </>
        )}
      </section>
    </>
  );
}
