'use client';

import { formatDateRange } from '@/lib/format';
import type { Period, SelectablePeriodId } from '@/lib/page-data';
import { t } from '@/lib/ui-text';

import styles from './PeriodPicker.module.css';

export type PeriodPickerProps = {
  /** 選べる期間（埋め込んだ JSON の periods。移動窓 3 つと月）。 */
  periods: readonly Period[];
  /** 選んでいる期間の ID（usePeriod().period.id か、useQueryState().state.p）。 */
  value: SelectablePeriodId;
  /** 選んだ期間の ID を返す。periods にある ID だけを返す。 */
  onChange: (id: SelectablePeriodId) => void;
};

/**
 * 期間の選択（05 §2.5）。全画面で同じ部品を使う。
 * 「直近 7 日 / 直近 28 日 / 直近 90 日」はボタン（aria-pressed）、月は select。
 * 選んでいる期間の日付の範囲を、下に文字で添える。
 */
export function PeriodPicker({ periods, value, onChange }: PeriodPickerProps) {
  const windows = periods.filter((period) => period.kind === 'window');
  const months = periods.filter((period) => period.kind === 'month');
  const selected = periods.find((period) => period.id === value);
  const monthValue = selected?.kind === 'month' ? selected.id : '';

  return (
    <div className={styles.picker} role="group" aria-label={t('period.picker')}>
      <div className={styles.controls}>
        <div className={styles.segment}>
          {windows.map((period) => (
            <button
              key={period.id}
              type="button"
              className={styles.button}
              aria-pressed={period.id === value}
              onClick={() => onChange(period.id)}
            >
              {period.label}
            </button>
          ))}
        </div>
        {months.length === 0 ? null : (
          <label className={styles.month}>
            <span className={styles.monthLabel}>{t('period.month')}</span>
            <select
              className={styles.select}
              value={monthValue}
              data-selected={monthValue === '' ? undefined : 'true'}
              onChange={(event) => {
                const next = months.find((period) => period.id === event.currentTarget.value);
                if (next !== undefined) onChange(next.id);
              }}
            >
              <option value="" disabled>
                {t('period.month.select')}
              </option>
              {months.map((period) => (
                <option key={period.id} value={period.id}>
                  {period.isConfirmed
                    ? period.label
                    : t('period.month.unconfirmed', { label: period.label })}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {selected === undefined ? null : (
        <p className={styles.range}>{formatDateRange(selected.start, selected.end)}</p>
      )}
    </div>
  );
}
