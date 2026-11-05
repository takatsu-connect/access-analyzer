import { HBar } from '@/components/charts';
import type { HBarItem } from '@/components/charts/types';
import { Details } from '@/components/Details';
import { MaskedCell, MaskedMark } from '@/components/MaskedCell';
import { Notice } from '@/components/Notice';
import { share } from '@/lib/derive';
import { formatShare } from '@/lib/format';
import type { Masked } from '@/lib/page-data';
import { t } from '@/lib/ui-text';

import styles from './s03.module.css';

export type ShareBarsProps = {
  /** 図の説明（HBar の title）。 */
  title: string;
  /** 表の 1 列目の見出し（区分の名前の列）。 */
  columnLabel: string;
  items: readonly HBarItem[];
  /** 構成比の分母（合計の列）。伏せ値か 20 未満なら、比率を出さない。 */
  total: Masked;
};

/**
 * 構成比の横棒（HBar）と、伏せ値の凡例、同じ値の表（NFR-96、NFR-99）。
 * 伏せ値の区分があれば、図の下に「— 伏せ値」を出す（色に頼らず文字で書く）。
 * 表の割合の列は、比率を出せるときだけ出す。伏せ値の区分の割合は伏せ値。
 */
export function ShareBars({ title, columnLabel, items, total }: ShareBarsProps) {
  const shares = share(
    items.map((item) => item.value),
    total,
  );
  const hasShare = shares.some((value) => value !== null);
  const hasMasked = items.some((item) => item.value === null);

  return (
    <div className={styles.bars}>
      <HBar
        title={title}
        items={items}
        total={total}
        valueWithShare={(count, ratio) => t('hbar.valueWithShare', { n: count, share: ratio })}
      />
      {hasMasked ? <Notice>{t('legend.masked')}</Notice> : null}
      <Details summary={t('s03.table.summary')}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{columnLabel}</th>
              <th scope="col" className={styles.num}>
                {t('column.sessions')}
              </th>
              {hasShare ? (
                <th scope="col" className={styles.num}>
                  {t('column.share')}
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              const ratio = shares[index] ?? null;
              return (
                <tr key={item.key}>
                  <th scope="row">{item.label}</th>
                  <td className={styles.num}>
                    <MaskedCell value={item.value} />
                  </td>
                  {hasShare ? (
                    <td className={styles.num}>
                      {ratio === null ? <MaskedMark /> : formatShare(ratio)}
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
