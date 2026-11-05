import type { ReactNode } from 'react';

import { MaskedMark } from '@/components/MaskedCell';
import { RATIO_MIN_DENOMINATOR } from '@/lib/config';
import { tenOf } from '@/lib/derive';
import { formatDuration, formatTenOf } from '@/lib/format';
import type { ArticlePeriodValue } from '@/lib/page-data';
import { t } from '@/lib/ui-text';

import styles from './s03.module.css';

export type EngagementSectionProps = { value: ArticlePeriodValue };

/** 値か、伏せ値の印か、不在の文。不在の文は数字より小さく書く。 */
type Shown = { kind: 'value' | 'masked' | 'absent'; node: ReactNode };

const ABSENT = (): Shown => ({ kind: 'absent', node: t('absent.ratio20') });
const MASKED = (): Shown => ({ kind: 'masked', node: <MaskedMark /> });

/** 読まれていた時間（1 回あたり）= engagementSeconds ÷ pageviews。分母 20 未満は不在、分子が伏せ値なら伏せ値。 */
function timePerView(value: ArticlePeriodValue): Shown {
  if (value.pageviews < RATIO_MIN_DENOMINATOR) return ABSENT();
  if (value.engagementSeconds === null) return MASKED();
  return { kind: 'value', node: formatDuration(value.engagementSeconds / value.pageviews) };
}

/** 最後まで読まれた割合 =「10 人中 ◯人」。分母 20 未満は不在、分子が伏せ値なら伏せ値。 */
function readToEnd(value: ArticlePeriodValue): Shown {
  if (value.pageviews < RATIO_MIN_DENOMINATOR) return ABSENT();
  if (value.scrollCount === null) return MASKED();
  const count = tenOf(value.scrollCount, value.pageviews);
  return count === null ? ABSENT() : { kind: 'value', node: formatTenOf(count) };
}

/**
 * どれくらい読み込まれたか（目安）（M-06、M-09。FR-23 (8)、NFR-96）。
 * 読まれていた時間には比較の相手を添えない（M-06 は弱い指標で、設計が許容している）。
 */
export function EngagementSection({ value }: EngagementSectionProps) {
  const stats = [
    {
      key: 'time',
      label: t('metric.M06.label'),
      shown: timePerView(value),
      note: t('metric.M06.note'),
    },
    {
      key: 'scroll',
      label: t('metric.M09.label'),
      shown: readToEnd(value),
      note: t('metric.M09.note'),
    },
  ];

  return (
    <section className={styles.section} aria-labelledby="s03-engagement">
      <h2 id="s03-engagement">{t('s03.engagement.h2')}</h2>
      <dl className={styles.stats}>
        {stats.map((stat) => (
          <div key={stat.key} className={styles.stat}>
            <dt className={styles.statLabel}>{stat.label}</dt>
            <dd className={stat.shown.kind === 'absent' ? styles.statText : styles.statValue}>
              {stat.shown.node}
            </dd>
            <dd className={styles.statNote}>{stat.note}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
