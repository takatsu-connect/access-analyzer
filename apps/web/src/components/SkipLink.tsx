'use client';

import Link from 'next/link';

import { t } from '@/lib/ui-text';

import styles from './SkipLink.module.css';

export type SkipLinkProps = {
  /** 行き先の要素の id（main）。行き先には tabIndex={-1} を付けておく。 */
  targetId: string;
};

/**
 * 本文へのスキップリンク。キーボードで最初にフォーカスが当たったときだけ見える。
 *
 * next/link のページ内リンクは、スクロールはするがフォーカスを動かさない（実機で確認）。
 * そのままだと次の Tab がヘッダに戻るので、押したときに行き先へフォーカスを移す。
 */
export function SkipLink({ targetId }: SkipLinkProps) {
  return (
    <Link
      href={`#${targetId}`}
      prefetch={false}
      className={styles.skip}
      onClick={() => {
        document.getElementById(targetId)?.focus();
      }}
    >
      {t('skip.toMain')}
    </Link>
  );
}
