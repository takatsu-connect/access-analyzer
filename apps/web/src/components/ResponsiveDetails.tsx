'use client';

import { useState, useSyncExternalStore } from 'react';

import { cx } from './class-names';
import type { DetailsProps } from './Details';
import styles from './Details.module.css';

/** 広い画面の条件（05 §2.6。幅 600px 未満がスマホ扱い）。 */
const WIDE_QUERY = '(min-width: 600px)';

function canMatchMedia(): boolean {
  return typeof window.matchMedia === 'function';
}

function subscribe(onChange: () => void): () => void {
  if (!canMatchMedia()) return () => undefined;
  const media = window.matchMedia(WIDE_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

function getIsWide(): boolean {
  return canMatchMedia() && window.matchMedia(WIDE_QUERY).matches;
}

/** サーバーでは幅が分からないので、閉じた状態で描く。 */
function getServerIsWide(): boolean {
  return false;
}

/**
 * 広い画面で開いた状態、狭い画面で閉じた状態を既定にする折りたたみ（05 §2.6）。
 *
 * CSS だけでは open 属性を切り替えられないので、静的な HTML は閉じた状態にし、
 * マウント後に画面の幅で開く。利用者が自分で開閉したあとは、その状態を保つ。
 */
export function ResponsiveDetails({ summary, children, className }: DetailsProps) {
  const isWide = useSyncExternalStore(subscribe, getIsWide, getServerIsWide);
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? isWide;

  return (
    <details
      className={cx(styles.details, className)}
      open={open}
      onToggle={(event) => {
        // 幅に合わせた切り替えでも toggle が起きる。利用者の操作のときだけ覚える。
        const next = event.currentTarget.open;
        if (next !== open) setChosen(next);
      }}
    >
      <summary className={styles.summary}>{summary}</summary>
      <div className={styles.body}>{children}</div>
    </details>
  );
}
