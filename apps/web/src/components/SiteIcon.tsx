import styles from './SiteIcon.module.css';

export type SiteIconProps = {
  /** 大きさのクラス（ヘッダは 'header'、フッタは 'footer'）。 */
  size: 'header' | 'footer';
};

/**
 * サイトのアイコン（05 §2.7）。タブ用の src/app/icon.svg と同じ図形を、ページの中に直接描く
 * （画像を別に読まないので、リクエストが増えない）。図形は icon.svg と同じでなければならない
 * （tests/components/SiteIcon.test.tsx が突き合わせる）。
 *
 * 飾りなので読み上げない。隣に名称の文字があるので、意味はそちらで伝わる。
 */
export function SiteIcon({ size }: SiteIconProps) {
  return (
    <svg
      className={size === 'header' ? styles.header : styles.footer}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      data-part="site-icon"
    >
      <rect width="64" height="64" rx="14" fill="#fbfbfa" />
      <path
        d="M14 10h36a8 8 0 0 1 8 8v20a8 8 0 0 1-8 8H26l-12 9v-9a8 8 0 0 1-8-8V18a8 8 0 0 1 8-8z"
        fill="#fff100"
        stroke="#ed6d3d"
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <rect x="17" y="30" width="7" height="10" rx="1.5" fill="#ed6d3d" />
      <rect x="28.5" y="23" width="7" height="17" rx="1.5" fill="#ed6d3d" />
      <rect x="40" y="17" width="7" height="23" rx="1.5" fill="#ed6d3d" />
      <path d="M30 56h22" stroke="#70c7d1" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}
