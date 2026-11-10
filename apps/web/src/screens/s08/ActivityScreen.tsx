'use client';

import a11y from '@/components/a11y.module.css';
import { cx } from '@/components/class-names';
import { Details } from '@/components/Details';
import { Notice, StateMessage } from '@/components/Notice';
import { PeriodPicker } from '@/components/PeriodPicker';
import { AuthorLink } from '@/components/SiteLinks';
import {
  absentCompareText,
  prevCountColumn,
  prevCountText,
  usePeriod,
} from '@/components/usePeriod';
import { monthProgress, share } from '@/lib/derive';
import { formatNumber, formatShare, formatYearMonth } from '@/lib/format';
import type { ActivityData } from '@/lib/page-data';
import { t } from '@/lib/ui-text';
import parts from '@/screens/s06/shared/parts.module.css';

import styles from './activity.module.css';
import { MonthlyBars } from './MonthlyBars';
import type { MonthlyBarRow } from './MonthlyBars';

/** 図に出す月の数（05 §8）。 */
const MONTHS = 24;

/**
 * S-08 投稿活動（05 §8）。
 *
 * - 主文は本数だけ。人数は出さない（FR-51）。
 * - ライターの表は名前の順で固定（データの順のまま）。並べ替えも番号もなく、本数が 1 本以上の人だけ。
 * - カテゴリの割合は、期間の公開本数が 20 本以上のときだけ出す（05 §2.3）。
 * - 本数の比較は ▲▼ と差を付けず、前の期間の本数を並べる（助言 A-2。書く人の活動に下向きの印を付けない）。
 */
export function ActivityScreen({ data }: { data: ActivityData }) {
  // 公開本数は WordPress から数えるので、数え始めた日に関係なくそろっている（measureStart は渡さない）。
  const { period, prevId, withheld, setPeriod } = usePeriod(data.periods);
  const periodId = period?.id ?? null;
  const absentPrev = absentCompareText(withheld, 'prev');

  const posting = periodId === null ? undefined : data.posting[periodId];
  const prevPosting = prevId === null ? undefined : data.posting[prevId];

  // --- 月ごとの公開本数。新しい月を上にする ---
  // 公開本数は月末で固まるので、「途中まで」を添えるのは、まだ終わっていない月だけ。
  const inProgress = new Set<string>(
    data.periods
      .filter((item) => item.kind === 'month' && monthProgress(item) === 'inProgress')
      .map((item) => item.id),
  );
  // 去年の同じ月の本数は、データ層が行ごとに持つ（13〜24 か月前の月の去年も引ける）。
  // 途中の月は、去年の 1 か月分と日数がそろわないので、線を描かない。
  // 図では「途中まで」を月の名前の下に小さく置き（折れない形）、表と読み上げの文は「（途中まで）」を付けた名前。
  const monthlyRows: (MonthlyBarRow & { withheld: boolean; fullLabel: string })[] = data.monthly
    .slice(-MONTHS)
    .reverse()
    .map(({ month, postCount, yoyPostCount }) => {
      const name = formatYearMonth(month);
      const isInProgress = inProgress.has(`m${month}`);
      const label = isInProgress ? t('period.month.unconfirmed', { label: name }) : name;
      const note = isInProgress ? t('s08.monthly.inProgress') : null;
      const yoy = isInProgress ? null : yoyPostCount;
      return {
        key: month,
        label: name,
        note,
        fullLabel: label,
        value: postCount,
        yoy,
        withheld: isInProgress,
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

  // --- カテゴリ。本数の多い順（カテゴリは人ではない）。同じ本数はデータの順（親の固定の順） ---
  const mix = periodId === null ? undefined : data.categoryMix[periodId];
  const prevMix = prevId === null ? undefined : data.categoryMix[prevId];
  const mixRows = (mix ?? [])
    .map((row, index) => ({ row, index }))
    .sort(
      (left, right) =>
        right.row.postCountPublished - left.row.postCountPublished || left.index - right.index,
    )
    .map(({ row }) => row);
  const shares = share(
    mixRows.map((row) => row.postCountPublished),
    posting?.postCount ?? null,
  );
  const hasShare = shares.some((value) => value !== null);
  // 前の期間に、そのカテゴリの公開がなければ 0 本。
  const prevCountOf = (categoryId: number): number =>
    prevMix?.find((row) => row.categoryId === categoryId)?.postCountPublished ?? 0;

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
            {prevPosting === undefined || period === null
              ? absentPrev
              : prevCountText(period, 'prev', formatNumber(prevPosting.postCount))}
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
                        {row.fullLabel}
                      </th>
                      <td className={cx(parts.cell, parts.numeric)}>{formatNumber(row.value)}</td>
                      <td className={cx(parts.cell, parts.numeric)}>
                        {row.yoy === null ? (
                          <span className={parts.absent}>
                            {row.withheld ? t('compare.inProgress.yoy') : t('absent.yoy')}
                          </span>
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
          <StateMessage kind="empty">{t('s08.empty')}</StateMessage>
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
                {/* 著者ページのない同名の著者がいても重ならないよう、key に並びの位置を含める。 */}
                {authors.map((author, index) => (
                  <tr key={`${index}:${author.slug ?? ''}:${author.name}`}>
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
          <StateMessage kind="empty">{t('s08.empty')}</StateMessage>
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
                    {/*
                      「前の 28 日」が数の列の keep-all で語ごとに縦に折れないよう、見出しは折らない。
                      幅は 5 字ほどで、360px でも 4 列に収まる。
                    */}
                    <th scope="col" className={cx(parts.head, parts.numeric, parts.nowrap)}>
                      {period === null ? null : prevCountColumn(period)}
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
                          {prevMix === undefined ? (
                            <span className={parts.absent}>{absentPrev}</span>
                          ) : (
                            formatNumber(prevCountOf(row.categoryId))
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Notice>{t('s08.mix.note')}</Notice>
          </>
        )}
      </section>
    </>
  );
}
