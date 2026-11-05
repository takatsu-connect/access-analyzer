'use client';

import a11y from '@/components/a11y.module.css';
import { HBar } from '@/components/charts';
import type { HBarItem } from '@/components/charts/types';
import { Details } from '@/components/Details';
import { MaskedCell } from '@/components/MaskedCell';
import { Notice, StateMessage } from '@/components/Notice';
import { CHANNEL_BUCKETS, RATIO_MIN_DENOMINATOR, SNS_BUCKETS } from '@/lib/config';
import { share } from '@/lib/derive';
import { formatNumber, formatShare } from '@/lib/format';
import type { AuthorPageData, Masked, SelectablePeriodId } from '@/lib/page-data';
import { t } from '@/lib/ui-text';

import styles from './s05.module.css';

export type ReferrerSectionProps = {
  data: AuthorPageData;
  periodId: SelectablePeriodId;
};

/**
 * 区分の和。伏せ値が 1 つでもあれば null（見えている値だけの和を分母にしない。05 §2.3）。
 * 流入チャネルと SNS の種類には合計の列がないので、全区分が見えているときだけ和を合計として使う。
 */
function sumIfAllVisible(values: readonly Masked[]): number | null {
  let total = 0;
  for (const value of values) {
    if (value === null) return null;
    total += value;
  }
  return total;
}

type BreakdownProps = {
  /** 図の説明と、表の 1 列目の見出し。 */
  title: string;
  /** 表の名前（読み上げ用）。 */
  caption: string;
  items: readonly HBarItem[];
  /** サイト全体の値（items と同じ順）。その期間の値がなければ null。 */
  siteValues: readonly Masked[] | null;
};

/**
 * 横棒 1 組（この著者の棒に、サイト全体の構成比を細い輪郭で重ねる）と、同じ値の表。
 * 伏せ値が 1 つでもあれば、前置きも比率もサイト全体との比較も出さず、数だけにする。
 */
function Breakdown({ title, caption, items, siteValues }: BreakdownProps) {
  const values = items.map((item) => item.value);
  const total = sumIfAllVisible(values);
  const hasShare = total !== null && total >= RATIO_MIN_DENOMINATOR;
  const ownShares = share(values, total);
  const siteShares =
    hasShare && siteValues !== null ? share(siteValues, sumIfAllVisible(siteValues)) : [];
  const hasSite = siteShares.length > 0 && siteShares.every((value) => value !== null);

  return (
    <div className={styles.chartBox}>
      {/* 0 は 0 として数を出す（05 §2.3）。分けるものがないので、前置きだけ省く。 */}
      {total === null || total === 0 ? null : (
        <p className={styles.lead}>{t('lead.sessions', { n: formatNumber(total) })}</p>
      )}
      {hasSite ? (
        <HBar
          title={title}
          items={items}
          total={total}
          valueWithShare={(count, percent) =>
            t('hbar.valueWithShare', { n: count, share: percent })
          }
          compare={{
            shares: siteShares,
            legend: t('s05.referrer.legend'),
            text: (percent) => t('s05.referrer.compare', { share: percent }),
          }}
        />
      ) : (
        <HBar
          title={title}
          items={items}
          total={total}
          valueWithShare={(count, percent) =>
            t('hbar.valueWithShare', { n: count, share: percent })
          }
        />
      )}
      <Details summary={t('s05.referrer.table')}>
        <table className={styles.table}>
          <caption className={a11y.srOnly}>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">{title}</th>
              <th scope="col" className={styles.numeric}>
                {t('column.sessions')}
              </th>
              {hasShare ? (
                <th scope="col" className={styles.numeric}>
                  {t('column.share')}
                </th>
              ) : null}
              {hasSite ? (
                <th scope="col" className={styles.numeric}>
                  {t('s05.referrer.column.site')}
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              const ownShare = ownShares[index] ?? null;
              const siteShare = siteShares[index] ?? null;
              return (
                <tr key={item.key}>
                  <th scope="row">{item.label}</th>
                  <td className={styles.numeric}>
                    <MaskedCell value={item.value} />
                  </td>
                  {hasShare && ownShare !== null ? (
                    <td className={styles.numeric}>{formatShare(ownShare)}</td>
                  ) : null}
                  {hasSite && siteShare !== null ? (
                    <td className={styles.numeric}>{formatShare(siteShare)}</td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Details>
    </div>
  );
}

/**
 * h2 読者はどこから来たか（FR-33。M-10、M-11）。
 * 比較の相手はサイト全体の構成比だけ。良し悪しの言葉を付けない。
 */
export function ReferrerSection({ data, periodId }: ReferrerSectionProps) {
  const own = data.breakdown[periodId];
  const site = data.siteBreakdown[periodId];
  const { name } = data.author;

  return (
    <section className={styles.section}>
      <h2>{t('metric.M10.label')}</h2>
      {own === undefined ? (
        <StateMessage kind="empty" />
      ) : (
        <>
          <Breakdown
            title={t('metric.M10.label')}
            caption={t('s05.referrer.caption.channel', { name })}
            items={CHANNEL_BUCKETS.map((key) => ({
              key,
              label: t(`channel.${key}`),
              value: own.channel[key],
            }))}
            siteValues={site === undefined ? null : CHANNEL_BUCKETS.map((key) => site.channel[key])}
          />
          <Notice>{t('s05.referrer.note')}</Notice>
          <div className={styles.subsection}>
            <h3>{t('metric.M11.label')}</h3>
            <Breakdown
              title={t('metric.M11.label')}
              caption={t('s05.referrer.caption.sns', { name })}
              items={SNS_BUCKETS.map((key) => ({
                key,
                label: t(`sns.${key}`),
                value: own.sns[key],
              }))}
              siteValues={site === undefined ? null : SNS_BUCKETS.map((key) => site.sns[key])}
            />
          </div>
        </>
      )}
    </section>
  );
}
