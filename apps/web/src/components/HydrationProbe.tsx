'use client';

import { useState } from 'react';

import { uiText } from '@/lib/ui-text';

import styles from './HydrationProbe.module.css';

/**
 * 土台の確認に使う仮の部品。
 *
 * ボタンを押すと文言が切り替わる。CSP の下でハイドレーションが成功しているかを
 * e2e/csp.spec.ts で確かめるために置いている（D-17）。画面を作る工程で外す。
 */
export function HydrationProbe() {
  const [toggled, setToggled] = useState(false);

  return (
    <div className={styles.probe}>
      <output className={styles.state}>
        {toggled ? uiText.scaffold.probeToggled : uiText.scaffold.probeIdle}
      </output>
      <button
        type="button"
        className={styles.button}
        aria-pressed={toggled}
        onClick={() => setToggled((current) => !current)}
      >
        {uiText.scaffold.probeButton}
      </button>
    </div>
  );
}
