import { uiText } from '@/lib/ui-text';

import styles from './page.module.css';

// 404 は固定文だけを出す（06 §7）。共通の説明（CommonNotes。05 §2.7）は後の工程で足す。
export default function NotFound() {
  return (
    <main className={styles.main}>
      <h1 className={styles.title}>{uiText.notFound.heading}</h1>
      <p className={styles.notice}>{uiText.notFound.body}</p>
    </main>
  );
}
