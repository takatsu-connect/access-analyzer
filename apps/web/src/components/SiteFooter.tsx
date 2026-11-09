import { t } from '@/lib/ui-text';

import { Details } from './Details';
import styles from './SiteFooter.module.css';

/**
 * 全ページ共通のフッタ（05 §2.7）。名称と、「読まれ方ノートについて」の折りたたみ
 * （データの出所、更新、問い合わせ先）。
 */
export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <p className={styles.title}>{t('site.title')}</p>
        <Details summary={t('footer.about')}>
          <p className={styles.line}>{t('footer.about.source')}</p>
          <p className={styles.line}>{t('footer.about.update')}</p>
          <p className={styles.line}>{t('footer.about.contact')}</p>
        </Details>
      </div>
    </footer>
  );
}
