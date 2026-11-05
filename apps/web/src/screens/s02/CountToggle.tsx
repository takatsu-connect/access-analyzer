'use client';

import { t } from '@/lib/ui-text';

import styles from './s02.module.css';

const COUNTS = [20, 50] as const;

export type CountToggleProps = {
  /** 選んでいる件数（useQueryState().state.n）。 */
  value: 20 | 50;
  onChange: (count: 20 | 50) => void;
};

/** 件数の切り替え（S-02a、S-02c。05 §2.5）。20 件か 50 件。 */
export function CountToggle({ value, onChange }: CountToggleProps) {
  return (
    <div className={styles.count} role="group" aria-label={t('s02.count.label')}>
      <span className={styles.countLabel} aria-hidden="true">
        {t('s02.count.label')}
      </span>
      {COUNTS.map((count) => (
        <button
          key={count}
          type="button"
          className={styles.button}
          aria-pressed={count === value}
          onClick={() => onChange(count)}
        >
          {t(`count.${count}`)}
        </button>
      ))}
    </div>
  );
}
