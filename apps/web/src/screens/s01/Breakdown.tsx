import a11y from '@/components/a11y.module.css';
import { HBar } from '@/components/charts';
import type { HBarItem } from '@/components/charts';
import { Details } from '@/components/Details';
import { MaskedCell, MaskedMark } from '@/components/MaskedCell';
import { RATIO_MIN_DENOMINATOR } from '@/lib/config';
import { share } from '@/lib/derive';
import { formatShare } from '@/lib/format';
import type { Masked } from '@/lib/page-data';
import { t } from '@/lib/ui-text';

import styles from './s01.module.css';

export type BreakdownProps = {
  /** 図の説明（図の <title> と、表の caption）。 */
  title: string;
  /** 前置き（「訪問 2,900 回のうち」）。分母が伏せ値で出せないときは null。 */
  lead: string | null;
  /** 表の、数の列の見出し（「訪問回数」など）。 */
  valueHeader: string;
  items: readonly HBarItem[];
  /** 構成比の分母（その指標の合計の列）。 */
  total: Masked;
  /** 前の期間の値と分母（items と同じ順）。渡すと、前の期間の構成比を輪郭で重ねる。 */
  prev?: { values: readonly Masked[]; total: Masked } | undefined;
};

/**
 * 構成比の図（前置き、横棒、同じ値の表）。
 * 比率は分母が 20 以上のときだけ。伏せ値の区分は棒を描かず、表でも伏せ値の印にする。
 */
export function Breakdown({ title, lead, valueHeader, items, total, prev }: BreakdownProps) {
  const shares = share(
    items.map((item) => item.value),
    total,
  );
  const showShare = total !== null && total >= RATIO_MIN_DENOMINATOR;
  const prevShares = prev === undefined ? [] : share(prev.values, prev.total);
  const showPrev = showShare && prevShares.some((value) => value !== null);
  const compareProps = showPrev
    ? {
        compare: {
          shares: prevShares,
          legend: t('legend.compare.prev'),
          text: (text: string) => t('hbar.compare.prev', { share: text }),
        },
      }
    : {};

  return (
    <div className={styles.figure}>
      {lead === null ? null : (
        <p className={styles.lead} data-part="lead">
          {lead}
        </p>
      )}
      <HBar
        title={title}
        items={items}
        total={total}
        valueWithShare={(count, text) => t('hbar.valueWithShare', { n: count, share: text })}
        {...compareProps}
      />
      <Details summary={t('s01.table.summary')}>
        <table className={styles.table}>
          <caption className={a11y.srOnly}>{title}</caption>
          <thead>
            <tr>
              <th scope="col">{t('s01.table.bucket')}</th>
              <th scope="col" className={styles.num}>
                {valueHeader}
              </th>
              {showShare ? (
                <th scope="col" className={styles.num}>
                  {t('column.share')}
                </th>
              ) : null}
              {showPrev ? (
                <th scope="col" className={styles.num}>
                  {t('s01.table.prevShare')}
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              const itemShare = shares[index] ?? null;
              const prevShare = prevShares[index] ?? null;
              return (
                <tr key={item.key}>
                  <th scope="row">{item.label}</th>
                  <td className={styles.num}>
                    <MaskedCell value={item.value} />
                  </td>
                  {showShare ? (
                    <td className={styles.num}>
                      {itemShare === null ? <MaskedMark /> : formatShare(itemShare)}
                    </td>
                  ) : null}
                  {showPrev ? (
                    <td className={styles.num}>
                      {prevShare === null ? <MaskedMark /> : formatShare(prevShare)}
                    </td>
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
