import { HydrationProbe } from '@/components/HydrationProbe';
import { uiText } from '@/lib/ui-text';

import styles from './page.module.css';

// 仮の 1 画面。S-01 の担当が、このファイルと HydrationProbe を置き換える。
// main はレイアウトが持つので、ページはフラグメントを返す。
export default function HomePage() {
  return (
    <>
      <h1 className={styles.title}>{uiText.site.title}</h1>
      <p className={styles.notice}>{uiText.scaffold.notice}</p>
      <HydrationProbe />
    </>
  );
}
