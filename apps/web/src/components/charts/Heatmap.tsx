'use client';

import { useId, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { formatNumber } from '@/lib/format';
import { t } from '@/lib/ui-text';

import { percent, round2 } from './geometry';
import { heatLevels } from './heat-levels';
import type { HeatLevel } from './heat-levels';
import styles from './Heatmap.module.css';
import type { HeatmapCell, HeatmapProps } from './types';

// 縦の寸法（px）。Heatmap.module.css の --heatmap-header と --heatmap-cell と同じ値にする。
const HEADER_HEIGHT = 18;
const CELL_HEIGHT = 28;
const HEADER_BASELINE = 12;
const LEVELS: readonly HeatLevel[] = [1, 2, 3, 4, 5];
const SWATCH_SIZE = 12;

const LEVEL_CLASS: Record<HeatLevel, string | undefined> = {
  1: styles.shade1,
  2: styles.shade2,
  3: styles.shade3,
  4: styles.shade4,
  5: styles.shade5,
};

type Position = { row: number; col: number };

/** 既定のセル: 値がいちばん大きいセル（最初に見つかったもの）。値がなければ左上。 */
function largestCell(values: readonly (readonly (number | null)[])[]): Position {
  let best: Position = { row: 0, col: 0 };
  let bestValue = -Infinity;
  values.forEach((cells, row) => {
    cells.forEach((value, col) => {
      if (value !== null && value > bestValue) {
        best = { row, col };
        bestValue = value;
      }
    });
  });
  return best;
}

/**
 * 格子のヒートマップ（05 §2.8。S-01 の曜日 × 時間帯、S-06b の月 × カテゴリ）。
 *
 * - セルは、伏せ値を除いた値の分位で 5 段階の濃淡。分位を取る範囲は scale（表全体 / 行ごと / 列ごと）。
 *   伏せ値のセルは面の色（白）と「—」。
 * - セルの中の数字は広い画面だけ（CSS で隠す）。選んだセルの値は、図の下の固定行に出す。
 *   固定行は最初から埋まっている。
 */
export function Heatmap({
  title,
  rowLabels,
  colLabels,
  values,
  cellText,
  hint,
  legend,
  defaultCell,
  formatValue = formatNumber,
  colLabelEvery = 1,
  scale = 'all',
}: HeatmapProps) {
  const fixedRowId = useId();
  const [selected, setSelected] = useState<Position | null>(null);

  const rowCount = rowLabels.length;
  const colCount = colLabels.length;
  if (rowCount === 0 || colCount === 0) return null;

  const valueAt = (position: Position): number | null =>
    values[position.row]?.[position.col] ?? null;
  const inRange = (position: Position | null | undefined): position is Position =>
    position !== null &&
    position !== undefined &&
    position.row >= 0 &&
    position.row < rowCount &&
    position.col >= 0 &&
    position.col < colCount;
  // 選んだセルが格子の外になったら（行や列の数が変わったら）、既定のセルに戻る。
  const fallback = inRange(defaultCell) ? defaultCell : largestCell(values);
  const current = inRange(selected) ? selected : fallback;

  const levels = heatLevels(values, scale);
  const hasMasked = values.some((cells) => cells.some((value) => value === null));
  const cellWidth = 100 / colCount;
  const leftOf = (col: number): number => round2(col * cellWidth);
  const centerOf = (col: number): number => round2((col + 0.5) * cellWidth);
  const topOf = (row: number): number => HEADER_HEIGHT + row * CELL_HEIGHT;

  const currentCell: HeatmapCell = {
    row: current.row,
    col: current.col,
    rowLabel: rowLabels[current.row] ?? '',
    colLabel: colLabels[current.col] ?? '',
    value: valueAt(current),
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    let next: Position | null = null;
    if (event.key === 'ArrowLeft') next = { row: current.row, col: current.col - 1 };
    else if (event.key === 'ArrowRight') next = { row: current.row, col: current.col + 1 };
    else if (event.key === 'ArrowUp') next = { row: current.row - 1, col: current.col };
    else if (event.key === 'ArrowDown') next = { row: current.row + 1, col: current.col };
    else if (event.key === 'Home') next = { row: current.row, col: 0 };
    else if (event.key === 'End') next = { row: current.row, col: colCount - 1 };
    if (next === null) return;
    event.preventDefault();
    if (inRange(next)) setSelected(next);
  };

  return (
    <div className={styles.chart}>
      <div className={styles.grid}>
        <div className={styles.rowLabels} aria-hidden="true">
          {rowLabels.map((label, row) => (
            <span key={`${row}-${label}`} className={styles.rowLabel}>
              {label}
            </span>
          ))}
        </div>
        <div
          className={styles.plot}
          role="group"
          tabIndex={0}
          aria-label={title}
          aria-describedby={fixedRowId}
          onKeyDown={onKeyDown}
        >
          <svg className={styles.svg} role="img" height={HEADER_HEIGHT + rowCount * CELL_HEIGHT}>
            <title>{title}</title>
            {colLabels.map((label, col) =>
              col % colLabelEvery === 0 ? (
                <text
                  key={`${col}-${label}`}
                  className={styles.colLabel}
                  data-part="col-label"
                  x={percent(centerOf(col))}
                  y={HEADER_BASELINE}
                  textAnchor="middle"
                >
                  {label}
                </text>
              ) : null,
            )}
            {rowLabels.map((rowLabel, row) =>
              colLabels.map((colLabel, col) => {
                const value = valueAt({ row, col });
                const level = levels[row]?.[col] ?? null;
                const levelClass = level === null ? styles.masked : LEVEL_CLASS[level];
                return (
                  <g key={`${row}-${col}`}>
                    <rect
                      className={`${styles.cell} ${levelClass}`}
                      data-part="cell"
                      data-row={row}
                      data-col={col}
                      data-level={level ?? 'masked'}
                      x={percent(leftOf(col))}
                      y={topOf(row)}
                      width={percent(cellWidth)}
                      height={CELL_HEIGHT}
                      onClick={() => setSelected({ row, col })}
                    />
                    {value === null ? (
                      <text
                        className={styles.maskedMark}
                        data-part="masked-mark"
                        x={percent(centerOf(col))}
                        y={topOf(row) + CELL_HEIGHT / 2}
                        textAnchor="middle"
                        dominantBaseline="central"
                      >
                        {t('masked.dash')}
                      </text>
                    ) : (
                      <text
                        className={`${styles.cellValue} ${
                          level !== null && level >= 4 ? styles.onStrong : styles.onWeak
                        }`}
                        data-part="cell-value"
                        x={percent(centerOf(col))}
                        y={topOf(row) + CELL_HEIGHT / 2}
                        textAnchor="middle"
                        dominantBaseline="central"
                      >
                        {formatValue(value)}
                      </text>
                    )}
                  </g>
                );
              }),
            )}
            <rect
              className={styles.selected}
              data-part="selected"
              x={percent(leftOf(current.col))}
              y={topOf(current.row)}
              width={percent(cellWidth)}
              height={CELL_HEIGHT}
            />
          </svg>
        </div>
      </div>
      <p className={styles.hint}>{hint}</p>
      <p id={fixedRowId} className={styles.fixedRow} data-part="fixed-row" aria-live="polite">
        {cellText(currentCell)}
      </p>
      <ul className={styles.legend}>
        <li className={styles.legendItem}>
          <svg
            className={styles.swatch}
            aria-hidden="true"
            width={SWATCH_SIZE * LEVELS.length}
            height={SWATCH_SIZE}
          >
            {LEVELS.map((level) => (
              <rect
                key={level}
                className={LEVEL_CLASS[level]}
                x={(level - 1) * SWATCH_SIZE}
                y={0}
                width={SWATCH_SIZE}
                height={SWATCH_SIZE}
              />
            ))}
          </svg>
          <span>{legend}</span>
        </li>
        {hasMasked ? (
          <li className={styles.legendItem} data-part="legend-masked">
            {t('legend.masked')}
          </li>
        ) : null}
      </ul>
    </div>
  );
}
