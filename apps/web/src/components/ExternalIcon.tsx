import styles from './ExternalIcon.module.css';

/**
 * 新しいタブ（別のサイト）で開くリンクの印。四角と、右上へ出る矢印（依頼者の指定、2026-11-07）。
 *
 * - 画像ファイルを読まず、SVG で描く（CSP の img-src と、外部の読み込みをしない決まり）。
 * - 色は文字色（currentColor）に合わせ、大きさは文字の大きさに合わせる（1em）。
 * - 飾りなので読み上げない。行き先は、リンクの aria-label に言葉で書く。
 */
export function ExternalIcon() {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
