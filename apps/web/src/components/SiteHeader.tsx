'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { t } from '@/lib/ui-text';
import type { UiTextKey } from '@/lib/ui-text';

import styles from './SiteHeader.module.css';

type NavItem = { label: UiTextKey; href: string };

/**
 * ヘッダのナビゲーション（05 §1）。パスは 05 §1 の表のとおり。
 * 「反応」は初回対象外で置かない。著者を数で並べる表、設定、ログインの項目も置かない
 * （NFR-20、NFR-22、NFR-36）。
 */
const NAV_ITEMS = [
  { label: 'nav.dashboard', href: '/' },
  { label: 'nav.articles', href: '/articles/top' },
  { label: 'nav.authors', href: '/authors' },
  { label: 'nav.categories', href: '/categories' },
  { label: 'nav.tags', href: '/tags' },
  { label: 'nav.activity', href: '/activity' },
] as const satisfies readonly NavItem[];

/** 「記事」のサブナビ（S-02a〜S-02e）。 */
const ARTICLE_NAV_ITEMS = [
  { label: 's02a.name', href: '/articles/top' },
  { label: 's02b.name', href: '/articles/new' },
  { label: 's02c.name', href: '/articles/long' },
  { label: 's02d.name', href: '/articles/recent' },
  { label: 's02e.name', href: '/articles' },
] as const satisfies readonly NavItem[];

/** 末尾の「/」を除く（ルートはそのまま）。 */
function normalize(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

/** パスの先頭の区切り（'/articles/123' → 'articles'。ルートは ''）。 */
function sectionOf(pathname: string): string {
  return pathname.split('/')[1] ?? '';
}

export type SiteHeaderViewProps = {
  /** 現在のパス（'/articles/top' など）。 */
  pathname: string;
};

/**
 * ヘッダの中身。現在のページの印は aria-current で付ける（見た目は太字と下線。色に頼らない）。
 * - 開いているページそのものへのリンク: aria-current="page"
 * - 開いているページを含む区分（「記事」の中の記事詳細など）: aria-current="true"
 *
 * リンクは先読みしない（prefetch={false}）。各ページはデータの JSON を埋め込んでいるので、
 * 全ページのヘッダで行き先を先読みすると、スマホの通信量と配信の量が増える。
 */
/**
 * 横スクロールのサブナビのタブで、選んでいるタブが見えるように列を横に寄せる（レビュー C-1）。
 * scrollIntoView は縦にもページを動かしうるので使わず、列の scrollLeft だけを変える。
 * 横にはみ出していない（広い画面）ときは何もしない。
 */
export function centerCurrentTab(list: HTMLElement, tab: HTMLElement): void {
  if (list.scrollWidth <= list.clientWidth) return;
  const left = tab.offsetLeft - (list.clientWidth - tab.offsetWidth) / 2;
  list.scrollLeft = Math.max(0, left);
}

export function SiteHeaderView({ pathname }: SiteHeaderViewProps) {
  const current = normalize(pathname);
  const section = sectionOf(current);
  const inArticles = section === 'articles';
  const subListRef = useRef<HTMLUListElement>(null);
  const currentSubRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const list = subListRef.current;
    const tab = currentSubRef.current;
    if (list === null || tab === null) return;
    centerCurrentTab(list, tab);
  }, [current]);

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link href="/" prefetch={false} className={styles.title}>
          {t('site.title')}
        </Link>
        <nav aria-label={t('nav.aria')}>
          <ul className={styles.list}>
            {NAV_ITEMS.map((item) => {
              const isSection = sectionOf(item.href) === section;
              // 「記事」は、開いているページの印をサブナビが持つ。
              const isPage = item.href === current && item.label !== 'nav.articles';
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    prefetch={false}
                    className={styles.link}
                    aria-current={isPage ? 'page' : isSection ? 'true' : undefined}
                  >
                    {t(item.label)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        {inArticles ? (
          <nav aria-label={t('nav.articles.aria')}>
            <ul className={styles.subList} ref={subListRef}>
              {ARTICLE_NAV_ITEMS.map((item) => {
                const isCurrent = item.href === current;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      prefetch={false}
                      className={styles.subLink}
                      aria-current={isCurrent ? 'page' : undefined}
                      ref={isCurrent ? currentSubRef : undefined}
                    >
                      {t(item.label)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        ) : null}
      </div>
    </header>
  );
}

/** 全ページ共通のヘッダ（layout.tsx に置く）。現在のパスは Next.js のルーターから取る。 */
export function SiteHeader() {
  const pathname = usePathname();
  return <SiteHeaderView pathname={pathname ?? '/'} />;
}
