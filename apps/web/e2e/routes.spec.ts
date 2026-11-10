import { expect, test } from '@playwright/test';

import { notesFor } from '../src/lib/common-notes';
import type { NoteId } from '../src/lib/common-notes';
import { SMALLPIECE_URL } from '../src/lib/derive';
import { dictionary, t } from '../src/lib/ui-text';

import { SCREENS, bodyText, mainText } from './support/screens';

/**
 * 画面の存在、404、共通の説明文、外部リンク（07 §6 の E-03、E-05、E-14、E-16）。
 */

// 404 になるべきパス（E-03）。存在しない ID、存在しない slug、不正な形式。
const NOT_FOUND_PATHS = [
  '/no-such-page',
  '/articles/999999',
  '/articles/abc',
  '/articles/101abc',
  '/articles/-1',
  '/authors/no-such-author',
  '/authors/A%20B',
  '/tags/999999',
  '/tags/abc',
  '/categories/11',
  '/reactions',
];

// エラー応答に出てはいけないもの（NFR-91）。スタックトレース、内部の URL、SQL。
const LEAK_PATTERNS: [string, RegExp][] = [
  [
    'スタックトレース',
    /\bat\s+[\w$.<>]+\s+\(|node_modules|\.tsx?:\d+|webpack-internal|turbopack:\/\//,
  ],
  ['内部の URL', /supabase|127\.0\.0\.1:54\d\d\d|localhost:54\d\d\d|postgres(ql)?:\/\//i],
  ['SQL', /\bselect\s+.+\s+from\b|\bpub_[a-z_]+\b|PGRST\d+/i],
];

test.describe('画面の存在、404、共通の説明文、外部リンク（E-03、E-05、E-14、E-16）', () => {
  test('E-05: S-01〜S-08 が 200 で開き、h1 が 05 §1 の問いの文言', async ({ page }) => {
    test.setTimeout(120_000);
    for (const screen of SCREENS.filter((item) => item.status === 200)) {
      const response = await page.goto(screen.path);
      expect.soft(response?.status(), `${screen.id} の状態コード`).toBe(200);
      const h1 = page.locator('h1');
      await expect.soft(h1, `${screen.id} の h1 の数`).toHaveCount(1);
      await expect.soft(h1.first(), `${screen.id} の h1`).toHaveText(screen.h1);
    }
  });

  test('E-05: 全画面（404 を含む）の title が 05 §2.7 の形（トップと 404 はサイトの名前だけ）', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // layout の title.template は同じ階層の page（トップ）に効かない。画面ごとに実物の title を見る。
    for (const screen of SCREENS) {
      await page.goto(screen.path);
      await expect.soft(page, `${screen.id} の title`).toHaveTitle(screen.title);
    }
  });

  test('E-05: ナビゲーションが 7 項目で、順位表・設定・ログイン・反応の項目がない', async ({
    page,
  }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: t('nav.aria'), exact: true });
    const labels = (await nav.getByRole('link').allInnerTexts()).map((label) => label.trim());
    expect(labels).toEqual([
      t('nav.dashboard'),
      t('nav.articles'),
      t('nav.events'),
      t('nav.authors'),
      t('nav.categories'),
      t('nav.tags'),
      t('nav.activity'),
    ]);
  });

  test('E-03: 存在しない記事 ID、slug、不正な形式が、同じ 404 と同じ本文になる', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // 本文（main）と、ページ全体の文字。
    const contents: string[] = [];
    const wholeByPrefix = new Map<string, { path: string; text: string }>();
    // 画面のパスの形をした 404（/articles/999999）でも、ブラウザのパスと静的な HTML が食い違って
    // 描き直し（ハイドレーションの不一致）にならない（src/components/useRenderedPathname.ts）。
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(String(error)));
    for (const path of NOT_FOUND_PATHS) {
      const response = await page.goto(path, { waitUntil: 'networkidle' });
      expect.soft(response?.status(), `${path} の状態コード`).toBe(404);
      await expect.soft(page.locator('h1'), `${path} の h1`).toHaveText(t('notFound.h1'));
      // 共通の説明文（CommonNotes）は出さない（助言 A-2）。/articles/999999 のように、画面の
      // パスの形をしていても、404 では画面の項目が出ない。
      await expect
        .soft(
          page.getByRole('heading', { name: t('notes.h2'), exact: true }),
          `${path} に CommonNotes がない`,
        )
        .toHaveCount(0);
      const whole = await bodyText(page);
      const start = whole.indexOf(t('notFound.h1'));
      expect.soft(start, `${path} の本文の位置`).toBeGreaterThan(-1);
      contents.push(whole.slice(start));

      // ヘッダは、パスの先頭（/articles など）でサブナビの有無が変わる。同じ先頭どうしでは、
      // ページ全体の文字が同じ（存在しない ID と不正な形式を、応答から見分けられない）。
      const prefix = path.split('/')[1] ?? '';
      const first = wholeByPrefix.get(prefix);
      if (first === undefined) wholeByPrefix.set(prefix, { path, text: whole });
      else expect.soft(whole, `${path} と ${first.path} のページ全体`).toBe(first.text);
    }
    // どのパスでも本文が同じ。
    for (const [index, content] of contents.entries()) {
      expect.soft(content, `${NOT_FOUND_PATHS[index] ?? ''} の本文`).toBe(contents[0]);
    }
    // 入力したパスを本文に写していない。
    expect.soft(contents[0]).not.toContain('999999');
    // 404 の応答そのもの（状態コード 404 の読み込み）のエラー以外に、描き直しなどのエラーがない。
    expect(errors.filter((text) => !/status of 404/.test(text))).toEqual([]);
  });

  test('E-03: 404 の応答に、スタックトレース、内部 URL、SQL がない', async ({ request }) => {
    for (const path of NOT_FOUND_PATHS) {
      const response = await request.get(path);
      expect.soft(response.status(), `${path} の状態コード`).toBe(404);
      const html = await response.text();
      for (const [name, pattern] of LEAK_PATTERNS) {
        expect.soft(pattern.test(html), `${path} の応答に ${name} がない`).toBe(false);
      }
    }
  });

  test('E-14: DataStatus は全画面（404 を含む）に 1 つ。CommonNotes は項目のある画面に 1 つで、S-04 と 404 にはない。どちらも main の外', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // DataStatus の文の、日付を差し込んだあとに続く部分。
    const statusTail = dictionary['status.asOf'].split(/\{[A-Za-z]+\}/).at(-1) ?? '';
    expect(statusTail.length).toBeGreaterThan(0);
    // 項目ごとの、本文の先頭の文（measureStart は日付を差し込む前の部分）。
    const noteHead: Record<NoteId, string> = {
      pageviews: t('notes.pageviews'),
      measureStart: dictionary['notes.measureStart'].split('{')[0] ?? '',
      masked: t('notes.masked'),
      // 帯の 3 つは本文の先頭が同じなので、「詳しく」の中の文で見分ける。
      band: t('notes.band.detail'),
      bandAll: t('notes.band.detail.all'),
      bandAuthor: t('notes.band.detail.author'),
      ratio: t('notes.ratio'),
      source: t('notes.source'),
      posting: t('notes.posting'),
    };
    // 画面ごとの決まり（助言 A-2）。表（src/lib/common-notes.ts）と食い違えば、ここで落ちる。
    const expectedCount = (screen: (typeof SCREENS)[number]): number => {
      if (screen.id === 'S-04' || screen.status === 404) return 0;
      if (screen.id === 'S-08') return 2;
      return notesFor(screen.path).length;
    };

    for (const screen of SCREENS) {
      await page.goto(screen.path);
      const main = page.locator('main');
      const notes = page.getByRole('heading', { name: t('notes.h2'), exact: true });
      const expected = notesFor(screen.path);
      expect.soft(expected.length, `${screen.id} の項目の数`).toBe(expectedCount(screen));
      await expect.soft(main, `${screen.id} の main`).toHaveCount(1);
      await expect.soft(page.getByText(statusTail), `${screen.id} の DataStatus`).toHaveCount(1);
      await expect
        .soft(main.getByRole('heading', { name: t('notes.h2'), exact: true }))
        .toHaveCount(0);
      const fold = page.locator('details', {
        has: page.locator('summary').getByRole('heading', { name: t('notes.h2'), exact: true }),
      });
      if (expected.length === 0) {
        // 項目がなければ、折りたたみごと出さない。
        await expect.soft(notes, `${screen.id} に CommonNotes がない`).toHaveCount(0);
        await expect.soft(fold, `${screen.id} に CommonNotes の折りたたみがない`).toHaveCount(0);
        continue;
      }
      await expect.soft(notes, `${screen.id} の CommonNotes`).toHaveCount(1);
      // 説明文は閉じた折りたたみ（見出しが summary）で出す。中身はその details の中にあり、
      // 見出しを押すと読める（レビュー C-6。依頼者の判断）。
      await expect.soft(fold, `${screen.id} の CommonNotes の折りたたみ`).toHaveCount(1);
      await expect
        .soft(fold, `${screen.id} の CommonNotes は閉じている`)
        .not.toHaveAttribute('open');
      await expect
        .soft(fold.locator(':scope > ul > li'), `${screen.id} の CommonNotes の項目の数`)
        .toHaveCount(expected.length);
      // その画面の項目だけがある（ほかの画面の項目が混ざっていない）。
      const body = (await fold.textContent()) ?? '';
      for (const id of Object.keys(noteHead) as NoteId[]) {
        const shown = body.includes(noteHead[id]);
        expect.soft(shown, `${screen.id} の notes.${id}`).toBe(expected.includes(id));
      }
    }
  });

  test('E-14: 全画面の DataStatus が同じ文（どのページも同じ時点のデータ）で、遅れの表示がない', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const statusTail = dictionary['status.asOf'].split(/\{[A-Za-z]+\}/).at(-1) ?? '';
    const delayedHead = dictionary['status.delayed'].split('{')[0] ?? '';
    const seen = new Map<string, string[]>();
    for (const screen of SCREENS) {
      await page.goto(screen.path);
      const status = (await page.getByText(statusTail).first().innerText()).trim();
      seen.set(status, [...(seen.get(status) ?? []), screen.id]);
      // フィクスチャは読み込んだ日のうちにビルドする（日をまたぐと pub_meta.is_stale が true になる）。
      await expect
        .soft(page.getByText(delayedHead), `${screen.id} に遅れの表示がない`)
        .toHaveCount(0);
    }
    // ページによって基準日や更新時刻が違えば、ビルドに古いデータが混ざっている。
    expect([...seen.entries()], 'DataStatus の文の種類').toHaveLength(1);
  });

  test('E-16: 全画面の外部リンクが https://takatsu-connect.com/ 配下と、フッタの制作者のリンクだけ', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    let externalCount = 0;
    for (const screen of SCREENS) {
      await page.goto(screen.path);
      const hrefs = await page
        .locator('a[href]')
        .evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute('href') ?? ''));
      for (const href of hrefs) {
        // サイト内は / で始まるパス（//host の形ではない）か、ページ内の # だけ。
        const internal = /^\/(?!\/)/.test(href) || href.startsWith('#');
        if (internal) continue;
        externalCount += 1;
        // 高津コネクトの外で許すのは、制作者（Small Piece）の決まった 1 つの URL だけ（ADR 0012）。
        if (href === SMALLPIECE_URL) continue;
        expect
          .soft(
            href.startsWith('https://takatsu-connect.com/'),
            `${screen.id} の外部リンク ${href}`,
          )
          .toBe(true);
      }
      // 制作者のリンクはフッタに 1 つだけ。
      await expect
        .soft(page.locator(`footer a[href="${SMALLPIECE_URL}"]`), `${screen.id} の制作者のリンク`)
        .toHaveCount(1);
      await expect
        .soft(
          page.locator(`a[href^="https://smallpiece.jp"]`),
          `${screen.id} の smallpiece.jp へのリンク`,
        )
        .toHaveCount(1);
      // 新しいタブで開くリンクは、開いた先から元のページを触れない。
      const unsafeBlank = await page
        .locator('a[target="_blank"]')
        .evaluateAll(
          (anchors) =>
            anchors.filter((anchor) => !(anchor.getAttribute('rel') ?? '').includes('noopener'))
              .length,
        );
      expect.soft(unsafeBlank, `${screen.id} の rel のない target=_blank`).toBe(0);
    }
    // 記事と著者のページに、外部リンクが実際にある（0 件で通っていない）。
    expect(externalCount).toBeGreaterThan(0);
  });

  // 外部リンク: サイト内の / で始まるパスでも、ページ内の # でもない href。
  const externalHrefs = (hrefs: string[]): string[] =>
    hrefs.filter((href) => !(/^\/(?!\/)/.test(href) || href.startsWith('#')));

  test('E-16: 記事の一覧（S-02a〜e、S-07b、S-05 の記事の一覧）に、外部リンクが 1 つもない', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // 一覧の行の題名はサイト内の記事詳細（S-03）へ。記事そのもの（高津コネクト）へは記事詳細から開く。
    for (const path of [
      '/articles',
      '/articles/top',
      '/articles/new',
      '/articles/long',
      '/articles/recent',
      '/tags/51',
    ]) {
      await page.goto(path);
      const hrefs = await page
        .locator('main a[href]')
        .evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute('href') ?? ''));
      // 一覧があること（0 件で通っていない）。
      expect
        .soft(
          hrefs.some((href) => href.startsWith('/articles/')),
          `${path} の記事への行`,
        )
        .toBe(true);
      expect.soft(externalHrefs(hrefs), `${path} の外部リンク`).toEqual([]);
      await expect
        .soft(page.locator('main a[target="_blank"]'), `${path} の新しいタブ`)
        .toHaveCount(0);
    }

    // S-05: 記事の一覧の節（h2 から次の節まで）。紹介ページへのリンクは見出しの側にあり、一覧の外。
    await page.goto('/authors/author-a');
    const list = page.locator('main section', {
      has: page.getByRole('heading', { level: 2, name: t('s05.posts.h2'), exact: true }),
    });
    await expect(list, 'S-05 の記事の一覧の節').toHaveCount(1);
    const listHrefs = await list
      .locator('a[href]')
      .evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute('href') ?? ''));
    expect
      .soft(
        listHrefs.some((href) => href.startsWith('/articles/')),
        'S-05 の記事への行',
      )
      .toBe(true);
    expect.soft(externalHrefs(listHrefs), 'S-05 の記事の一覧の外部リンク').toEqual([]);
    await expect.soft(list.locator('a[target="_blank"]')).toHaveCount(0);
  });

  test('E-16: 記事詳細の題名と、ライターのページの紹介ページは、新しいタブで開く外部リンクで、四角と矢印のアイコンが付く', async ({
    page,
  }) => {
    const cases: [string, string][] = [
      ['/articles/101', 'main p a[target="_blank"]'],
      ['/authors/author-a', 'main a[target="_blank"]'],
    ];
    for (const [path, selector] of cases) {
      await page.goto(path);
      const links = page.locator(selector);
      await expect.soft(links, `${path} の新しいタブで開くリンク`).toHaveCount(1);
      const link = links.first();
      const href = (await link.getAttribute('href')) ?? '';
      expect
        .soft(href.startsWith('https://takatsu-connect.com/'), `${path} の行き先 ${href}`)
        .toBe(true);
      expect.soft((await link.getAttribute('rel')) ?? '', `${path} の rel`).toContain('noopener');
      // 飾りのアイコン（読み上げない SVG）が、リンクの中に 1 つ。
      await expect
        .soft(link.locator('svg[aria-hidden="true"]'), `${path} のアイコン`)
        .toHaveCount(1);
      await expect.soft(link.locator('svg[aria-hidden="true"]').first()).toBeVisible();
    }
    // 記事詳細では、題名がリンクになっている。
    await page.goto('/articles/101');
    const title = page.locator('main p a[target="_blank"]').first();
    expect.soft(((await title.textContent()) ?? '').trim().length).toBeGreaterThan(0);
    // ライターのページでは、紹介ページへのリンクの文言。
    await page.goto('/authors/author-a');
    await expect
      .soft(page.locator('main a[target="_blank"]').first())
      .toContainText(t('s05.authorLink'));
  });

  test('E-16: 404 の本文は固定文で、main の文字が辞書どおり', async ({ page }) => {
    await page.goto('/no-such-page');
    const text = await mainText(page);
    for (const key of [
      'notFound.h1',
      'notFound.lead',
      'notFound.reasons.lead',
      'notFound.reason.notYet',
      'notFound.reason.removed',
      'notFound.reason.url',
      'notFound.link.dashboard',
      'notFound.link.search',
      'notFound.link.authors',
    ] as const) {
      expect.soft(text, key).toContain(t(key));
    }
  });
});
