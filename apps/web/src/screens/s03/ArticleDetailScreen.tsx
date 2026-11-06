'use client';

import { StateMessage } from '@/components/Notice';
import { PeriodPicker } from '@/components/PeriodPicker';
import { usePeriod } from '@/components/usePeriod';
import type { ArticleDetailData } from '@/lib/page-data';
import { t } from '@/lib/ui-text';

import { ArticleHeader } from './ArticleHeader';
import { CurveSection } from './CurveSection';
import { DailySection } from './DailySection';
import { DeviceSection } from './DeviceSection';
import { EngagementSection } from './EngagementSection';
import { MilestoneSection } from './MilestoneSection';
import { OwnSection } from './OwnSection';
import { PeriodSummarySection } from './PeriodSummarySection';
import styles from './s03.module.css';
import { SourceSection } from './SourceSection';

export type ArticleDetailScreenProps = {
  /** ページに埋め込んだ JSON（04 §3.4）。 */
  data: ArticleDetailData;
};

/**
 * S-03 記事詳細（05 §5）。h1 から始まるフラグメントを返す。
 *
 * 節の順: 期間に依らない節（属性、公開からの読まれ方、到達のお知らせ、◯◯さんのこれまでの記事と比べて）
 * → 区切りと PeriodPicker → 期間に効く節（この期間に読まれた回数、日ごと、どこから来たか、端末、読み込まれ方）。
 * 記事では前の期間と比べない（compare() を呼ばない。▲▼ を出さない）。
 * 数え始める前に公開した記事（post.isPreMeasure）は、属性の直下に 1 文を置き、
 * 「公開からの読まれ方」「◯◯さんのこれまでの記事と比べて」「リンク元のサイト」を見出しごと出さない
 * （advice/2026-11-05-pre-measurement-posts.md の推奨案）。
 */
export function ArticleDetailScreen({ data }: ArticleDetailScreenProps) {
  const { period, setPeriod } = usePeriod(data.periods);
  const { post, meta } = data;
  const value = period === null ? undefined : data.period[period.id];
  const breakdown = period === null ? undefined : data.breakdown[period.id];

  return (
    <>
      <ArticleHeader post={post} measureStart={meta.measureStart} />

      {post.isPreMeasure ? null : (
        <CurveSection post={post} cumulative={data.cumulative} benchmark={data.benchmark} />
      )}
      <MilestoneSection
        milestones={data.milestones}
        isEvergreen365={data.isEvergreen365}
        isPreMeasure={post.isPreMeasure}
      />
      {post.isPreMeasure ? null : (
        <OwnSection post={post} cumulative={data.cumulative} ownMedian30d={data.ownMedian30d} />
      )}

      <p className={styles.divider}>{t('s03.periodPart.lead')}</p>
      {period === null ? (
        <StateMessage kind="empty" />
      ) : (
        <>
          <PeriodPicker periods={data.periods} value={period.id} onChange={setPeriod} />
          <PeriodSummarySection value={value} post={post} measureStart={meta.measureStart} />
          <DailySection
            period={period}
            daily={data.daily}
            baseDate={meta.baseDate}
            measureStart={meta.measureStart}
            isPreMeasure={post.isPreMeasure}
          />
          <SourceSection
            value={value}
            breakdown={breakdown}
            referrer30d={data.referrer30d}
            isPreMeasure={post.isPreMeasure}
          />
          {value === undefined ? null : (
            <>
              <DeviceSection value={value} breakdown={breakdown} />
              <EngagementSection value={value} />
            </>
          )}
        </>
      )}
    </>
  );
}
