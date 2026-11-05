import a11y from '@/components/a11y.module.css';
import { Details } from '@/components/Details';
import { MaskedMark } from '@/components/MaskedCell';
import type { Masked } from '@/lib/page-data';
import { t } from '@/lib/ui-text';

import styles from './s01.module.css';

export type HeatmapTableProps = {
  /** 表の説明（caption）。 */
  caption: string;
  /** 数の列の見出し（「読まれた回数（1 日あたりの平均）」など）。 */
  valueHeader: string;
  rowLabels: readonly string[];
  colLabels: readonly string[];
  /** values[行][列]。null は伏せ値。図に渡したものと同じ値。 */
  values: readonly (readonly Masked[])[];
  formatValue: (value: number) => string;
};

/**
 * ヒートマップと同じ値の表（閉じた状態から始まる折りたたみの中）。
 * 狭い画面でも横にはみ出さないように、1 マスを 1 行（曜日 | 時間帯 | 数）で書く。
 */
export function HeatmapTable({
  caption,
  valueHeader,
  rowLabels,
  colLabels,
  values,
  formatValue,
}: HeatmapTableProps) {
  return (
    <Details summary={t('s01.table.summary')}>
      <table className={styles.table}>
        <caption className={a11y.srOnly}>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{t('s01.heat.table.day')}</th>
            <th scope="col">{t('s01.heat.table.time')}</th>
            <th scope="col" className={styles.num}>
              {valueHeader}
            </th>
          </tr>
        </thead>
        <tbody>
          {rowLabels.flatMap((rowLabel, rowIndex) =>
            colLabels.map((colLabel, colIndex) => {
              const value = values[rowIndex]?.[colIndex] ?? null;
              return (
                <tr key={`${rowLabel}/${colLabel}`}>
                  <th scope="row">{rowLabel}</th>
                  <td>{colLabel}</td>
                  <td className={styles.num}>
                    {value === null ? <MaskedMark /> : formatValue(value)}
                  </td>
                </tr>
              );
            }),
          )}
        </tbody>
      </table>
    </Details>
  );
}
