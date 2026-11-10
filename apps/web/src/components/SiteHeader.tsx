'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';

import { t } from '@/lib/ui-text';
import type { UiTextKey } from '@/lib/ui-text';

import styles from './SiteHeader.module.css';
import { SiteIcon } from './SiteIcon';
import { useRenderedPathname } from './useRenderedPathname';

type NavItem = { label: UiTextKey; href: string };

/**
 * ヘッダのナビゲーション（05 §1）。パスは 05 §1 の表のとおり。「イベント記事」（S-10a〜S-10e）は
 * 2026-11-10 の依頼者の決定で足した。
 * 「反応」は初回対象外で置かない。著者を数で並べる表、設定、ログインの項目も置かない
 * （NFR-20、NFR-22、NFR-36）。
 */
const NAV_ITEMS = [
  { label: 'nav.dashboard', href: '/' },
  { label: 'nav.articles', href: '/articles/top' },
  { label: 'nav.events', href: '/events/top' },
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

/**
 * 「イベント記事」のサブナビ（S-10a〜S-10e）。「記事」と同じ 5 つで、タブの名前は短い形。
 * イベント記事の詳細ページは作らず、記事詳細（/articles/[postId]）を共有する。
 */
const EVENT_NAV_ITEMS = [
  { label: 's10a.tab', href: '/events/top' },
  { label: 's10b.tab', href: '/events/new' },
  { label: 's10c.tab', href: '/events/long' },
  { label: 's10d.tab', href: '/events/recent' },
  { label: 's10e.tab', href: '/events' },
] as const satisfies readonly NavItem[];

/** サブナビを持つ区分（パスの先頭の区切り）→ サブナビの項目と aria-label。 */
const SUB_NAVS = {
  articles: { items: ARTICLE_NAV_ITEMS, aria: 'nav.articles.aria' },
  events: { items: EVENT_NAV_ITEMS, aria: 'nav.events.aria' },
} as const;

function subNavOf(section: string): (typeof SUB_NAVS)[keyof typeof SUB_NAVS] | undefined {
  return section === 'articles' || section === 'events' ? SUB_NAVS[section] : undefined;
}

/** 開いているページの印をサブナビが持つ、ヘッダの項目。 */
const SUB_NAV_LABELS: readonly UiTextKey[] = ['nav.articles', 'nav.events'];

/** 末尾の「/」を除く（ルートはそのまま）。 */
function normalize(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

/** パスの先頭の区切り（'/articles/123' → 'articles'。ルートは ''）。 */
function sectionOf(pathname: string): string {
  return pathname.split('/')[1] ?? '';
}

const ARTICLE_DETAIL_PATTERN = /^\/articles\/([1-9][0-9]{0,9})$/;

/**
 * 現在地の区分。記事詳細（/articles/[postId]）は、主な種類がイベントの記事なら「イベント記事」
 * （events）にする（レビュー 2026-11-10 H-2）。両方に属する記事は記事のまま。
 */
export function currentSectionOf(pathname: string, eventArticleIds: readonly number[]): string {
  const match = ARTICLE_DETAIL_PATTERN.exec(pathname);
  if (match !== null && eventArticleIds.includes(Number(match[1]))) return 'events';
  return sectionOf(pathname);
}

export type SiteHeaderViewProps = {
  /** 現在のパス（'/articles/top' など）。 */
  pathname: string;
  /** 主な種類がイベントの記事の ID（記事詳細の現在地を「イベント記事」にする）。 */
  eventArticleIds?: readonly number[];
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

export function SiteHeaderView({ pathname, eventArticleIds = [] }: SiteHeaderViewProps) {
  const current = normalize(pathname);
  const section = currentSectionOf(current, eventArticleIds);
  const subNav = subNavOf(section);
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
      <div className={styles.brand}>
        <Link href="/" prefetch={false} className={styles.title}>
          <SiteIcon size="header" />
          <span>{t('site.title')}</span>
        </Link>
      </div>
      <div className={styles.inner}>
        <nav aria-label={t('nav.aria')}>
          <ul className={styles.list}>
            {NAV_ITEMS.map((item) => {
              const isSection = sectionOf(item.href) === section;
              // 「記事」と「イベント記事」は、開いているページの印をサブナビが持つ。
              const isPage = item.href === current && !SUB_NAV_LABELS.includes(item.label);
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
        {subNav !== undefined ? (
          <nav aria-label={t(subNav.aria)}>
            <ul className={styles.subList} ref={subListRef}>
              {subNav.items.map((item) => {
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

/**
 * 全ページ共通のヘッダ（layout.tsx に置く）。現在のパスは Next.js のルーターから取る。
 * eventArticleIds はレイアウトがビルド時のデータから渡す（静的な HTML とブラウザで同じ結果になる）。
 */
export function SiteHeader({ eventArticleIds }: { eventArticleIds: readonly number[] }) {
  // 一覧にない ID の 404 で、静的な HTML と食い違わないよう、HTML を作ったときのパスで選ぶ。
  const pathname = useRenderedPathname();
  return <SiteHeaderView pathname={pathname} eventArticleIds={eventArticleIds} />;
}
