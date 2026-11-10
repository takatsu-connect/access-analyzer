import type { Page } from '@playwright/test';

import { t } from '../../src/lib/ui-text';

/**
 * E2E が共通で使う定義（07 §6）。全画面の一覧はここだけに書く。
 *
 * データは apps/batch/tests/support/e2e_fixture.py のフィクスチャ（記事 42 本、著者 4 人）。
 * 基準日はフィクスチャを読み込んだ日の前日なので、日付は画面から読んで相対で確かめる。
 */

/** フィクスチャに入れてある、HTML として解釈されうる文字列（ADR 0010 の 5）。バッチが格納する形。 */
export const HTML_LIKE = {
  /** 記事 102 の題名（タグの形）。 */
  title: '架空の記事 102 川沿いの散歩道 <img src=x onerror=alert(1)>',
  /** author-d の表示名（属性を閉じて script を足す形。数字を含めない。E-15）。 */
  author: '架空 四葉"><script>alert(document.domain)</script>',
  /** カテゴリ 12 の名前（エンティティの形。画面にも &lt; のまま出る）。 */
  category: 'お店の紹介 &lt;img src=x onerror=alert(3)&gt;',
  /** タグ 52 の名前（javascript: で始まる）。 */
  tag: 'javascript:alert(4) 親子',
} as const;

export type Screen = {
  /** 05 §1 の画面 ID。同じ画面の別の場面は括弧で添える。 */
  id: string;
  path: string;
  status: 200 | 404;
  /** h1 の文言（05 §1 の「問い」）。 */
  h1: string;
  /** ページの title（05 §2.7。「{画面の名前} | サイトの名前」、トップと 404 はサイトの名前だけ）。 */
  title: string;
};

function screen(
  id: string,
  path: string,
  h1: string,
  title: string,
  status: 200 | 404 = 200,
): Screen {
  return { id, path, status, h1, title };
}

/** 05 §2.7 の形の title。name がなければサイトの名前だけ。 */
function pageTitle(name?: string): string {
  return name === undefined ? t('site.title') : `${name} | ${t('site.title')}`;
}

/** 全画面（S-01〜S-08、S-10a〜S-10e と 404）。記事詳細は 3 種、著者とタグは HTML の形の名前を持つものも含む。 */
export const SCREENS: readonly Screen[] = [
  screen('S-01', '/', t('s01.h1'), pageTitle()),
  screen('S-02e', '/articles', t('s02e.h1'), pageTitle(t('s02e.name'))),
  screen('S-02a', '/articles/top', t('s02a.h1'), pageTitle(t('s02a.name'))),
  screen('S-02b', '/articles/new', t('s02b.h1'), pageTitle(t('s02b.name'))),
  screen('S-02c', '/articles/long', t('s02c.h1'), pageTitle(t('s02c.name'))),
  screen('S-02d', '/articles/recent', t('s02d.h1'), pageTitle(t('s02d.name'))),
  // イベント記事（S-02a〜S-02e のイベント記事版。2026-11-10）。詳細は /articles/[postId] を共有する。
  screen('S-10e', '/events', t('s10e.h1'), pageTitle(t('s10e.name'))),
  screen('S-10a', '/events/top', t('s10a.h1'), pageTitle(t('s10a.name'))),
  screen('S-10b', '/events/new', t('s10b.h1'), pageTitle(t('s10b.name'))),
  screen('S-10c', '/events/long', t('s10c.h1'), pageTitle(t('s10c.name'))),
  screen('S-10d', '/events/recent', t('s10d.h1'), pageTitle(t('s10d.name'))),
  screen('404（イベント記事の詳細はない）', '/events/111', t('notFound.h1'), pageTitle(), 404),
  // 記事詳細の title は記事の題名（画面の名前の代わり）。
  screen('S-03（通常）', '/articles/111', t('s03.h1'), pageTitle('架空の記事 111 地域の防災訓練')),
  screen(
    'S-03（30 日未満）',
    '/articles/101',
    t('s03.h1'),
    pageTitle('架空の記事 101 商店街の朝市だより'),
  ),
  screen(
    'S-03（数え始める前）',
    '/articles/107',
    t('s03.h1'),
    pageTitle('架空の記事 107 昔の地図を歩く'),
  ),
  screen('S-03（題名が HTML の形）', '/articles/102', t('s03.h1'), pageTitle(HTML_LIKE.title)),
  screen('S-04', '/authors', t('s04.h1'), pageTitle(t('s04.h1'))),
  screen(
    'S-05',
    '/authors/author-a',
    t('s05.h1', { name: '架空 一郎' }),
    pageTitle(t('s05.title', { name: '架空 一郎' })),
  ),
  screen(
    'S-05（期間内の公開なし）',
    '/authors/author-c',
    t('s05.h1', { name: '架空 三太' }),
    pageTitle(t('s05.title', { name: '架空 三太' })),
  ),
  screen(
    'S-05（名前が HTML の形）',
    '/authors/author-d',
    t('s05.h1', { name: HTML_LIKE.author }),
    pageTitle(t('s05.title', { name: HTML_LIKE.author })),
  ),
  screen('S-06', '/categories', t('s06.h1'), pageTitle(t('s06.name'))),
  screen('S-06b', '/categories/seasonal', t('s06b.h1'), pageTitle(t('s06b.name'))),
  screen('S-07', '/tags', t('s07.h1'), pageTitle(t('s07.name'))),
  screen('S-07b', '/tags/51', t('s07b.h1', { name: '散歩' }), pageTitle(t('s07b.name'))),
  screen(
    'S-07b（名前が javascript:）',
    '/tags/52',
    t('s07b.h1', { name: HTML_LIKE.tag }),
    pageTitle(t('s07b.name')),
  ),
  screen('S-08', '/activity', t('s08.h1'), pageTitle(t('s08.name'))),
  screen('404', '/no-such-page', t('notFound.h1'), pageTitle(), 404),
];

/** 横スクロールを許す画面（S-06b の格子だけ。05 §7.2）。 */
export const HORIZONTAL_SCROLL_ALLOWED = ['S-06b'];

export function screenById(id: string): Screen {
  const found = SCREENS.find((item) => item.id === id);
  if (found === undefined) throw new Error(`画面 ${id} が一覧にない`);
  return found;
}

/**
 * CSP の指示の集合（ADR 0010 の 4。06 §6）。next.config.ts の定義と同じでなければならない
 * （headers.spec.ts が、定義とこの一覧、応答とこの一覧の両方を確かめる）。
 */
export const EXPECTED_CSP: readonly string[] = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "script-src-attr 'none'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'none'",
];

/** CSP 以外の応答ヘッダ（06 §6）。名前は小文字。 */
export const EXPECTED_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'x-robots-tag': 'noindex, nofollow',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

/** CSP のヘッダの値を、指示ごとの文字列（空白を 1 つにそろえたもの）の並びにする。並べ替えて返す。 */
export function parseCsp(value: string | undefined): string[] {
  return (value ?? '')
    .split(';')
    .map((directive) => directive.trim().replace(/\s+/g, ' '))
    .filter((directive) => directive !== '')
    .sort();
}

type Violation = { directive: string; blockedUri: string; sample: string };
type WatchWindow = Window & { __cspViolations?: Violation[] };

export type PageWatch = {
  /** コンソールに出た CSP の通知。 */
  consoleCsp: string[];
  /** ページの中で起きた例外。 */
  pageErrors: string[];
  /** alert / confirm / prompt が呼ばれた回数（呼ばれたら閉じる）。 */
  dialogs: string[];
  /** ブラウザが報告した CSP 違反（いま開いている文書の分）。 */
  violations: () => Promise<Violation[]>;
};

/**
 * ページの見張りを付ける。goto の前に呼ぶ。
 * CSP 違反（securitypolicyviolation）、コンソールの CSP の通知、例外、ダイアログを集める。
 */
export async function watchPage(page: Page): Promise<PageWatch> {
  const consoleCsp: string[] = [];
  const pageErrors: string[] = [];
  const dialogs: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) consoleCsp.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('dialog', (dialog) => {
    dialogs.push(`${dialog.type()}: ${dialog.message()}`);
    void dialog.dismiss();
  });
  await page.addInitScript(() => {
    const probe = window as WatchWindow;
    probe.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      probe.__cspViolations?.push({
        directive: event.effectiveDirective,
        blockedUri: event.blockedURI,
        sample: event.sample,
      });
    });
  });
  return {
    consoleCsp,
    pageErrors,
    dialogs,
    violations: () => page.evaluate(() => (window as WatchWindow).__cspViolations ?? []),
  };
}

/** 画面を開き、ハイドレーションが済む（PeriodPicker などの操作が効く）まで待つ。 */
export async function openScreen(page: Page, path: string) {
  const response = await page.goto(path, { waitUntil: 'networkidle' });
  return response;
}

/** 見えている文字（main の中）。 */
export function mainText(page: Page): Promise<string> {
  return page.locator('main').innerText();
}

/** 見えている文字（ヘッダ、DataStatus、CommonNotes、フッタを含むページ全体）。 */
export function bodyText(page: Page): Promise<string> {
  return page.locator('body').innerText();
}

/** 期間のボタン（PeriodPicker）。 */
export function periodButton(page: Page, id: 'last7' | 'last28' | 'last90') {
  return page.getByRole('button', { name: t(`period.${id}`), exact: true });
}

/** YYYY-MM-DD に日数を足す（UTC で計算し、タイムゾーンに頼らない）。 */
export function addDays(isoDate: string, days: number): string {
  const time = Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000;
  return new Date(time).toISOString().slice(0, 10);
}
