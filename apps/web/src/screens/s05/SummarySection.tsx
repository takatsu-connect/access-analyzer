'use client';

import type { ReactNode } from 'react';

import { BandDot } from '@/components/charts';
import { Delta } from '@/components/Delta';
import { Notice, StateMessage } from '@/components/Notice';
import { ArticleLink } from '@/components/SiteLinks';
import type { PeriodChoice } from '@/components/usePeriod';
import { compare } from '@/lib/derive';
import { formatDate, formatDiff, formatMonthDay, formatNumber } from '@/lib/format';
import type { AuthorPageData, AuthorPeriodValue, Period } from '@/lib/page-data';
import { t } from '@/lib/ui-text';

import styles from './s05.module.css';

export type SummarySectionProps = {
  data: AuthorPageData;
  /** 選んだ期間。 */
  period: Period;
  /** 選んだ期間と、比較の相手（resolvePeriod の結果）。 */
  choice: PeriodChoice;
};

/** 移動窓の日数（「前の {days} 日と比べて」）。月は null。 */
function windowDays(id: string): number | null {
  if (id === 'last7') return 7;
  if (id === 'last28') return 28;
  if (id === 'last90') return 90;
  return null;
}

/**
 * (a) の文（FR-31 (a)）。事実だけで、ほかの著者とも、著者の本数の分布とも比べない。
 * 前の期間との比較は差だけ（% を出さない。05 §6.2）。
 */
function publishedText(
  period: Period,
  current: AuthorPeriodValue,
  prev: AuthorPeriodValue | undefined,
): string {
  const n = formatNumber(current.postCount);
  const pv = formatNumber(current.pageviews);
  if (prev === undefined) return t('s05.summary.a.single', { n, pv });

  const diffCount = formatDiff(compare(current.postCount, prev.postCount).diff);
  const diffPv = formatDiff(compare(current.pageviews, prev.pageviews).diff);
  if (period.kind === 'month') return t('s05.summary.a.month', { n, pv, diffCount, diffPv });

  const days = windowDays(period.id);
  if (days === null) return t('s05.summary.a.single', { n, pv });
  return t('s05.summary.a', { n, pv, days, diffCount, diffPv });
}

/** 「前の 28 日と比べて ▲ +40」。差だけを出す（まとめの中は差にそろえる）。 */
function PrevDiff({
  label,
  current,
  prev,
}: {
  label: string | null;
  current: number;
  prev: number | undefined;
}) {
  if (label === null || prev === undefined) return null;
  return (
    <p className={styles.small}>
      <span className={styles.compare}>
        <span>{label}</span>
        <Delta comparison={{ diff: compare(current, prev).diff, ratio: null }} />
      </span>
    </p>
  );
}

type PeriodValues = {
  current: AuthorPeriodValue;
  prev: AuthorPeriodValue | undefined;
  prevLabel: string | null;
};

/**
 * (a) 公開した本数と読まれた回数（M-30、M-01）。
 * 期間内の公開が 0 本のときは、(c)（以前に書いた記事）を主文にして 1 つにまとめる。
 */
function Published({ period, current, prev, prevLabel }: PeriodValues & { period: Period }) {
  if (current.postCount > 0) {
    return (
      <div className={styles.summaryItem}>
        <p className={styles.statement}>{publishedText(period, current, prev)}</p>
      </div>
    );
  }

  // 公開から 3 か月以上たった記事がまだない著者には、「0 本が 0 回」と書かない。
  const hasLong = current.longPostCount > 0;
  return (
    <div className={styles.summaryItem}>
      <p className={styles.statement}>
        {hasLong
          ? t('s05.summary.a.zero', {
              n: formatNumber(current.longPostCount),
              pv: formatNumber(current.longPageviews),
            })
          : t('s05.summary.a.zero.total', { pv: formatNumber(current.pageviews) })}
      </p>
      {hasLong ? (
        <PrevDiff label={prevLabel} current={current.longPageviews} prev={prev?.longPageviews} />
      ) : (
        <PrevDiff label={prevLabel} current={current.pageviews} prev={prev?.pageviews} />
      )}
    </div>
  );
}

/** (c) 以前に書いた記事が、この期間に読まれた回数（M-25）。(a) が 0 本のときは出さない。 */
function LongRead({ current, prev, prevLabel }: PeriodValues) {
  if (current.postCount === 0) return null;
  if (current.longPostCount === 0) {
    return (
      <div className={styles.summaryItem}>
        <p className={styles.small}>{t('s05.summary.c.absent')}</p>
      </div>
    );
  }
  return (
    <div className={styles.summaryItem}>
      <p>
        {t('s05.summary.c', {
          n: formatNumber(current.longPostCount),
          pv: formatNumber(current.longPageviews),
        })}
      </p>
      <PrevDiff label={prevLabel} current={current.longPageviews} prev={prev?.longPageviews} />
    </div>
  );
}

/**
 * (b) 著者自身の過去と、全記事の分布（FR-31 (b)。M-24、M-19、M-20）。
 * 帯の点は 3 区分の固定位置（BandDot）。値に比例した位置は描かない。
 */
function OwnMedian({ data }: { data: AuthorPageData }) {
  const { name } = data.author;
  const { ownMedian30d, band30 } = data.summary;
  const start = formatDate(data.meta.measureStart);

  if (ownMedian30d === null) {
    // 数え始めてから公開した記事が 1 本もない著者には、書くことを求める文にしない。
    const allPreMeasure = data.posts.length > 0 && data.posts.every((post) => post.isPreMeasure);
    return (
      <div className={styles.summaryItem}>
        <p className={styles.small}>
          {allPreMeasure
            ? t('s05.summary.b.preMeasure', { name, start })
            : t('s05.summary.b.absent', { condition: t('absent.ownMedian') })}
        </p>
      </div>
    );
  }

  const median = formatNumber(ownMedian30d);
  const { benchmark } = data;
  return (
    <div className={styles.summaryItem}>
      <p>
        {benchmark === null
          ? t('s05.summary.b.own', { name, median })
          : t('s05.summary.b', {
              name,
              median,
              p25: formatNumber(benchmark.p25),
              p75: formatNumber(benchmark.p75),
              p50: formatNumber(benchmark.p50),
            })}
      </p>
      {band30 === null ? (
        <p className={styles.small}>{t('absent.band')}</p>
      ) : (
        <>
          <div className={styles.bandBox}>
            <BandDot band={band30} />
          </div>
          <Notice>{t('band.note')}</Notice>
        </>
      )}
      <Notice>{t('notes.ownMedian.scope', { start })}</Notice>
    </div>
  );
}

/** (d) 到達のお知らせ（M-23）。期間内に到達したものがあるときだけ、h3 ごと出す。 */
function Milestones({ data, period }: { data: AuthorPageData; period: Period }) {
  const items: { key: string; node: ReactNode }[] = [];
  for (const item of data.milestones) {
    if (item.reachedOn < period.start || item.reachedOn > period.end) continue;
    const post = data.posts.find((candidate) => candidate.id === item.postId);
    if (post === undefined) continue;
    const params = { n: formatNumber(item.milestone), date: formatMonthDay(item.reachedOn) };
    items.push({
      key: `${item.postId}-${item.milestone}`,
      node: (
        <>
          <ArticleLink postId={post.id}>{post.title}</ArticleLink>
          <span>
            {post.isPreMeasure
              ? t('milestone.reached.since', params)
              : t('milestone.reached', params)}
          </span>
        </>
      ),
    });
  }
  if (items.length === 0) return null;

  return (
    <div className={styles.milestones}>
      <h3>{t('metric.M23.label')}</h3>
      <ul className={styles.milestoneList}>
        {items.map((item) => (
          <li key={item.key}>{item.node}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * h2 この期間のまとめ（FR-31）。
 * 期間のデータがないときは、まとめを出さずに「この期間の数字はまだありません。」。
 */
export function SummarySection({ data, period, choice }: SummarySectionProps) {
  const current = data.period[period.id];
  const prev = choice.prevId === null ? undefined : data.period[choice.prevId];

  return (
    <section className={styles.section}>
      <h2>{t('s05.summary.h2')}</h2>
      {current === undefined ? (
        <StateMessage kind="empty" />
      ) : (
        <div className={styles.summary}>
          <Published period={period} current={current} prev={prev} prevLabel={choice.prevLabel} />
          <OwnMedian data={data} />
          <LongRead current={current} prev={prev} prevLabel={choice.prevLabel} />
          <Milestones data={data} period={period} />
        </div>
      )}
    </section>
  );
}
