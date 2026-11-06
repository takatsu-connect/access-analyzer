import { StateMessage } from '@/components/Notice';
import { DEVICE_BUCKETS } from '@/lib/config';
import { formatNumber } from '@/lib/format';
import type { ArticleBreakdown, ArticlePeriodValue } from '@/lib/page-data';
import { t } from '@/lib/ui-text';

import styles from './s03.module.css';
import { ShareBars } from './ShareBars';

export type DeviceSectionProps = {
  value: ArticlePeriodValue;
  breakdown: ArticleBreakdown | undefined;
};

/**
 * どんな端末で読まれたか（M-13。FR-23 (7)）。
 *
 * 端末ごとの値は「この記事から読み始めた訪問」の数なので、分母も前置きも landingSessions にそろえる。
 * 05 §5 のワイヤーは前置きを「読まれた ◯回のうち」（pageviews）としているが、そのとおりにすると
 * 前置きの数と比率の分母が食い違う。設計との差異として報告している。
 * landingSessions が伏せ値なら、前置きも比率も出さない。
 */
export function DeviceSection({ value, breakdown }: DeviceSectionProps) {
  return (
    <section className={styles.section} aria-labelledby="s03-device">
      <h2 id="s03-device">{t('s03.device.h2')}</h2>
      {breakdown === undefined ? (
        <StateMessage kind="empty" />
      ) : (
        <>
          {/* 伏せ値か 0 なら前置きを出さない。注記（s03.landing.note）は最初の節にだけ添える。 */}
          {value.landingSessions === null || value.landingSessions === 0 ? null : (
            <p className={styles.lead}>
              {t('s03.landing.lead', { n: formatNumber(value.landingSessions) })}
            </p>
          )}
          <ShareBars
            title={t('s03.device.h2')}
            columnLabel={t('s03.device.column')}
            items={DEVICE_BUCKETS.map((key) => ({
              key,
              label: t(`device.${key}`),
              value: breakdown.device[key],
            }))}
            total={value.landingSessions}
          />
        </>
      )}
    </section>
  );
}
