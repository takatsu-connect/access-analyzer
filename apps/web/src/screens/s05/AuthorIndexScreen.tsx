import { Notice, StateMessage } from '@/components/Notice';
import { AuthorLink } from '@/components/SiteLinks';
import type { AuthorIndexData } from '@/lib/page-data';
import { t } from '@/lib/ui-text';

import styles from './s05.module.css';

export type AuthorIndexScreenProps = { data: AuthorIndexData };

/**
 * S-04 著者一覧（05 §6.1、FR-30）。
 *
 * - 出すのは表示名だけ。本数、読まれた回数、最終公開日などの数字を持たないし、出さない。
 * - 並びはデータの順（名前の順）のまま。ここでは並べ替えない。
 * - slug は href にだけ使う（AuthorLink）。期間の選択はない。
 */
export function AuthorIndexScreen({ data }: AuthorIndexScreenProps) {
  return (
    <>
      <h1>{t('s04.h1')}</h1>
      <p>{t('s04.lead')}</p>
      {data.authors.length === 0 ? (
        <StateMessage kind="empty">{t('s04.empty')}</StateMessage>
      ) : (
        <>
          <Notice>{t('s04.note')}</Notice>
          <ul className={styles.nameList} aria-label={t('s04.list.label')}>
            {data.authors.map((author) => (
              <li key={author.slug}>
                <AuthorLink slug={author.slug}>{author.name}</AuthorLink>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
