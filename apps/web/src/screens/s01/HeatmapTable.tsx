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
  /**
   * 行ごと（曜日ごと）と列ごと（時間帯ごと）の平均。図に渡したものと同じ値。
   * rowName は曜日の平均の名前（「1 時間あたりの平均」）、colName は時間帯の平均の名前（「7 曜日の平均」）。
   */
  means?: {
    rows: readonly Masked[];
    cols: readonly Masked[];
    rowName: string;
    colName: string;
    /** 平均の数字の書式（合計の表でも、平均は小数になりうる）。 */
    format: (value: number) => string;
  };
  formatValue: (value: number) => string;
};

/**
 * ヒートマップと同じ値の表（閉じた状態から始まる折りたたみの中）。
 * 狭い画面でも横にはみ出さないように、1 マスを 1 行（曜日 | 時間帯 | 数）で書く。
 * 曜日の平均は各曜日の行の続きに「曜日 | 1 時間あたりの平均 | 数」、時間帯の平均は表の最後に
 * 「7 曜日の平均 | 時間帯 | 数」の行で書く。
 */
export function HeatmapTable({
  caption,
  valueHeader,
  rowLabels,
  colLabels,
  values,
  means,
  formatValue,
}: HeatmapTableProps) {
  const cell = (value: Masked, format = formatValue) => (
    <td className={styles.num}>{value === null ? <MaskedMark /> : format(value)}</td>
  );
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
          {rowLabels.flatMap((rowLabel, rowIndex) => [
            ...colLabels.map((colLabel, colIndex) => (
              <tr key={`${rowLabel}/${colLabel}`}>
                <th scope="row">{rowLabel}</th>
                <td>{colLabel}</td>
                {cell(values[rowIndex]?.[colIndex] ?? null)}
              </tr>
            )),
            means === undefined ? null : (
              <tr key={`${rowLabel}/mean`} data-part="mean-row">
                <th scope="row">{rowLabel}</th>
                <td>{means.rowName}</td>
                {cell(means.rows[rowIndex] ?? null, means.format)}
              </tr>
            ),
          ])}
          {means === undefined
            ? null
            : colLabels.map((colLabel, colIndex) => (
                <tr key={`mean/${colLabel}`} data-part="mean-row">
                  <th scope="row">{means.colName}</th>
                  <td>{colLabel}</td>
                  {cell(means.cols[colIndex] ?? null, means.format)}
                </tr>
              ))}
        </tbody>
      </table>
    </Details>
  );
}
