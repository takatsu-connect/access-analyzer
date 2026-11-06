import a11y from '@/components/a11y.module.css';
import { t } from '@/lib/ui-text';

export type TableSummaryProps = {
  /** 表の名前（読み上げ用に summary へ添える）。 */
  name: string;
};

/**
 * 図の下の表の Details の見出し。画面には「同じ数字を表で見る」だけを出し、
 * 読み上げでは節の名前を添えて、同じ名前の見出しが並ばないようにする。
 */
export function TableSummary({ name }: TableSummaryProps) {
  return (
    <>
      {t('s03.table.summary')}
      <span className={a11y.srOnly}>{t('s03.table.summary.sr', { name })}</span>
    </>
  );
}
