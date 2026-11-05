import { HydrationProbe } from '@/components/HydrationProbe';
import { uiText } from '@/lib/ui-text';

import styles from './page.module.css';

// 仮の 1 画面。画面と集計は後の工程で作る。
export default function HomePage() {
  return (
    <main className={styles.main}>
      <h1 className={styles.title}>{uiText.site.title}</h1>
      <p className={styles.notice}>{uiText.scaffold.notice}</p>
      <HydrationProbe />
    </main>
  );
}
