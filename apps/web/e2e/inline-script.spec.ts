import { expect, test } from '@playwright/test';

import { t } from '../src/lib/ui-text';

import { HTML_LIKE, SCREENS, mainText, openScreen, watchPage } from './support/screens';

/**
 * ADR 0010 の歯止め（「かわりに守ること」の 5 と 8）。
 *
 * script-src は 'unsafe-inline' を許すので、CSP はインラインの script を止めない。かわりに、
 * 配信される HTML のインラインの script が Next.js の出す形だけであること、イベント属性と
 * javascript: の URL がないこと、題名や名前が文字として描かれることを、ここで確かめる。
 * Next.js の更新でインラインの script の形が変わると、ここが落ちる（ADR 0010 の見直す条件）。
 */

type ScriptTag = { attributes: string; src: string | null; content: string };

/** 配信された HTML から script 要素を取り出す。 */
function scriptTags(html: string): ScriptTag[] {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].map((match) => {
    const attributes = match[1] ?? '';
    const src = /\ssrc\s*=\s*"([^"]*)"/i.exec(attributes)?.[1] ?? null;
    return { attributes, src, content: match[2] ?? '' };
  });
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const FLIGHT_INIT = '(self.__next_f=self.__next_f||[]).push([0])';
const FLIGHT_PUSH = 'self.__next_f.push(';
const CHUNK_PUSH = '(globalThis["TURBOPACK"] || (globalThis["TURBOPACK"] = [])).push(';

/**
 * インラインの script が Next.js の出す形か。形の名前を返す。当てはまらなければ null。
 * - flight-init: RSC のデータの入れ物を作る
 * - flight-data: RSC のデータ（[数, 文字列] の JSON だけ。式や関数の呼び出しを含まない）
 * - chunk-register: チャンクの登録（static/chunks/ 配下の .js の名前と、モジュールの番号だけ）
 */
function inlineScriptKind(content: string): string | null {
  const body = content.trim();
  if (body === FLIGHT_INIT) return 'flight-init';
  if (body.startsWith(FLIGHT_PUSH) && body.endsWith(')')) {
    const value = parseJson(body.slice(FLIGHT_PUSH.length, -1));
    const ok =
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'number' &&
      typeof value[1] === 'string';
    return ok ? 'flight-data' : null;
  }
  if (body.startsWith(CHUNK_PUSH) && body.endsWith(');')) {
    const value = parseJson(body.slice(CHUNK_PUSH.length, -2));
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const keysOk = Object.keys(record).every((key) =>
      ['otherChunks', 'runtimeModuleIds'].includes(key),
    );
    const chunks: unknown[] = Array.isArray(record.otherChunks) ? record.otherChunks : [];
    const ids: unknown[] = Array.isArray(record.runtimeModuleIds) ? record.runtimeModuleIds : [];
    const chunksOk = chunks.every(
      (chunk) => typeof chunk === 'string' && /^static\/chunks\/[\w.~-]+\.js$/.test(chunk),
    );
    const idsOk = ids.every((id) => typeof id === 'number');
    return keysOk && chunksOk && idsOk ? 'chunk-register' : null;
  }
  return null;
}

/** src つきの script が、同一オリジンの /_next/static/ 配下の .js か。 */
function isNextStaticScript(src: string): boolean {
  return /^\/_next\/static\/[\w./~-]+\.js$/.test(src) && !src.includes('..') && !src.includes('//');
}

/** script の中身を除いた HTML から、開始タグを取り出す。引用符の中の値は空にする。 */
function startTags(html: string): string[] {
  const withoutScripts = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  return (withoutScripts.match(/<[a-zA-Z][^<>]*>/g) ?? []).map((tag) =>
    tag.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''"),
  );
}

type AttrProbeWindow = Window & { __attrHandlerRan?: boolean };

test.describe('ADR 0010 の歯止め（インラインの script、イベント属性、値の描き方）', () => {
  test('検査の関数が、Next.js の形でない script を見分ける', () => {
    expect(inlineScriptKind(FLIGHT_INIT)).toBe('flight-init');
    expect(inlineScriptKind('self.__next_f.push([1,"a:\\"b\\"\\n"])')).toBe('flight-data');
    expect(inlineScriptKind('alert(1)')).toBeNull();
    expect(inlineScriptKind('self.__next_f.push([1,"a"]);alert(1)')).toBeNull();
    expect(inlineScriptKind('self.__next_f.push([1,"a"],alert(1))')).toBeNull();
    expect(
      inlineScriptKind(`${CHUNK_PUSH}{"otherChunks":["https://evil.example/a.js"]});`),
    ).toBeNull();
    expect(scriptTags('<p>a</p><script>alert(2)</script>').map((tag) => tag.content)).toEqual([
      'alert(2)',
    ]);
    expect(isNextStaticScript('/_next/static/chunks/a-1_b.js')).toBe(true);
    expect(isNextStaticScript('//evil.example/_next/static/a.js')).toBe(false);
    expect(isNextStaticScript('https://evil.example/a.js')).toBe(false);
    expect(startTags('<a title="x onclick=1" href="/a">')).toEqual(['<a title="" href="">']);
  });

  test('全画面の HTML で、インラインの script が Next.js の出す形だけ', async ({ request }) => {
    const kinds = new Set<string>();
    for (const screen of SCREENS) {
      const html = await (await request.get(screen.path)).text();
      const inline = scriptTags(html).filter((tag) => tag.src === null);
      expect.soft(inline.length, `${screen.id} のインラインの script の数`).toBeGreaterThan(0);
      for (const tag of inline) {
        const kind = inlineScriptKind(tag.content);
        if (kind !== null) kinds.add(kind);
        // 失敗したときは、中身ではなく先頭の 60 文字だけを出す。
        expect
          .soft(kind, `${screen.id} のインラインの script: ${tag.content.slice(0, 60)}`)
          .not.toBeNull();
        // 属性は、なし、または Next.js が付ける id だけ（type="application/ld+json" などを足していない）。
        expect
          .soft(tag.attributes.trim(), `${screen.id} のインラインの script の属性`)
          .toMatch(/^(id="[\w:-]+")?$/);
      }
    }
    // 3 つの形がどれも実際に出ている（検査が空振りしていない）。
    expect([...kinds].sort()).toEqual(['chunk-register', 'flight-data', 'flight-init']);
  });

  test('全画面の HTML で、src つきの script が同一オリジンの /_next/ 配下だけ', async ({
    request,
  }) => {
    for (const screen of SCREENS) {
      const html = await (await request.get(screen.path)).text();
      const external = scriptTags(html).filter((tag) => tag.src !== null);
      expect.soft(external.length, `${screen.id} の src つきの script の数`).toBeGreaterThan(0);
      for (const tag of external) {
        expect
          .soft(
            isNextStaticScript(tag.src ?? ''),
            `${screen.id} の script の src: ${tag.src ?? ''}`,
          )
          .toBe(true);
        expect.soft(tag.content.trim(), `${screen.id} の src つきの script は中身が空`).toBe('');
      }
      // link の preload / stylesheet / modulepreload も同一オリジンだけ。
      const linkHrefs = [...html.matchAll(/<link\b[^>]*\shref\s*=\s*"([^"]*)"/gi)].map(
        (match) => match[1] ?? '',
      );
      for (const href of linkHrefs) {
        expect.soft(/^\/(?!\/)/.test(href), `${screen.id} の link の href: ${href}`).toBe(true);
      }
      // 埋め込みの要素がない（ADR 0010 の 1）。
      for (const name of ['iframe', 'object', 'embed', 'base', 'form']) {
        const pattern = new RegExp(`<${name}\\b`, 'i');
        const withoutScripts = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
        expect.soft(pattern.test(withoutScripts), `${screen.id} に ${name} 要素がない`).toBe(false);
      }
    }
  });

  test('全画面の HTML に、on で始まるイベント属性と javascript: の URL がない', async ({
    request,
  }) => {
    for (const screen of SCREENS) {
      const html = await (await request.get(screen.path)).text();
      const tags = startTags(html);
      expect.soft(tags.length, `${screen.id} のタグの数`).toBeGreaterThan(50);
      const withEvent = tags.filter((tag) => /\son[a-z]+\s*=/i.test(tag));
      expect.soft(withEvent, `${screen.id} のイベント属性`).toEqual([]);
      const urls = [
        ...html.matchAll(/\s(?:href|src|action|formaction|xlink:href)\s*=\s*"([^"]*)"/gi),
      ].map((match) => match[1] ?? '');
      const scripted = urls.filter((url) => /^\s*(javascript|data|vbscript):/i.test(url));
      expect.soft(scripted, `${screen.id} の javascript: などの URL`).toEqual([]);
    }
  });

  test('全画面の DOM（ハイドレーション後）に、イベント属性と javascript: の URL がない', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    for (const screen of SCREENS) {
      await openScreen(page, screen.path);
      const found = await page.evaluate(() => {
        const eventAttributes: string[] = [];
        const scriptedUrls: string[] = [];
        for (const element of document.querySelectorAll('*')) {
          for (const attribute of element.attributes) {
            const name = attribute.name.toLowerCase();
            if (name.startsWith('on')) eventAttributes.push(`${element.tagName} ${name}`);
            const isUrl = ['href', 'src', 'action', 'formaction', 'xlink:href'].includes(name);
            if (isUrl && /^\s*(javascript|vbscript):/i.test(attribute.value)) {
              scriptedUrls.push(`${element.tagName} ${name}`);
            }
          }
        }
        return { eventAttributes, scriptedUrls };
      });
      expect.soft(found.eventAttributes, `${screen.id} のイベント属性`).toEqual([]);
      expect.soft(found.scriptedUrls, `${screen.id} の javascript: の URL`).toEqual([]);
    }
  });

  test("script-src-attr 'none' が効く（onclick 属性のハンドラが動かず、CSP 違反が出る）", async ({
    page,
  }) => {
    const watch = await watchPage(page);
    await openScreen(page, '/');
    expect(await watch.violations(), '操作の前は違反なし').toEqual([]);

    // ページの中で、onclick 属性を持つボタンを足す（値を HTML として描く不具合があった場合の代わり）。
    await page.evaluate(() => {
      (window as AttrProbeWindow).__attrHandlerRan = false;
      const button = document.createElement('button');
      button.id = 'e2e-attr-probe';
      button.textContent = 'probe';
      const handler = document.createAttribute('onclick');
      handler.value = 'window.__attrHandlerRan = true';
      button.setAttributeNode(handler);
      document.body.append(button);
    });
    await page.locator('#e2e-attr-probe').click();

    // ハンドラは動かない。
    const ran = await page.evaluate(() => (window as AttrProbeWindow).__attrHandlerRan);
    expect(ran, 'onclick 属性のハンドラが動いていない').toBe(false);

    // ブラウザが script-src-attr の違反を報告する。
    await expect
      .poll(async () => (await watch.violations()).map((violation) => violation.directive))
      .toContain('script-src-attr');
  });

  test('題名が HTML の形の記事: 題名が文字として出て、img 要素ができない', async ({ page }) => {
    const watch = await watchPage(page);
    await openScreen(page, '/articles/102');
    expect(await mainText(page)).toContain(HTML_LIKE.title);
    expect(await page.title()).toBe(`${HTML_LIKE.title} | ${t('site.title')}`);
    // 外部リンクは記事の URL のまま。
    await expect(page.locator('main a[href^="http"]').first()).toHaveAttribute(
      'href',
      'https://takatsu-connect.com/102/',
    );
    await expect(page.locator('img')).toHaveCount(0);
    expect(watch.dialogs).toEqual([]);
    expect(await watch.violations()).toEqual([]);
  });

  // 監査 2026-11-05-build3-review.md M-1: 匿名の第三者がリンク 1 本で持ち込める文字列は、
  // 記事を探す画面の検索語（?q=）だけ。HTML として解釈されず、入力欄の値としてだけ扱われる。
  test('検索語（?q=）が HTML の形でも、入力欄の値としてだけ扱われ、要素にならない', async ({
    page,
  }) => {
    const watch = await watchPage(page);
    const payloads = [
      '<img src=x onerror=alert(5)>',
      '"><script>alert(6)</script>',
      'javascript:alert(7)',
    ];
    for (const payload of payloads) {
      await openScreen(page, `/articles?q=${encodeURIComponent(payload)}`);
      const box = page.getByRole('searchbox', { name: t('s02e.filter.q') });
      await expect(box, payload).toHaveValue(payload);
      await expect(page.locator('main img'), payload).toHaveCount(0);
      expect(await page.locator('main script').count(), payload).toBe(0);
      // リンク先は、どれもサイト内のパスか takatsu-connect.com のまま。
      const hrefs = await page
        .locator('main a')
        .evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute('href') ?? ''));
      expect(
        hrefs.filter((href) => !/^(\/(?!\/)|https:\/\/takatsu-connect\.com\/|#)/.test(href)),
        payload,
      ).toEqual([]);
    }
    expect(watch.dialogs).toEqual([]);
    expect(await watch.violations()).toEqual([]);
  });

  test('題名・著者名・カテゴリ名・タグ名が HTML の形でも、どの画面でも文字として出る', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const watch = await watchPage(page);
    // 画面と、そこに出るはずの文字。
    const cases: [string, string[]][] = [
      ['/articles', [HTML_LIKE.title, HTML_LIKE.author, HTML_LIKE.category]],
      ['/articles/new', [HTML_LIKE.title]],
      ['/articles/102', [HTML_LIKE.title, HTML_LIKE.category, HTML_LIKE.tag]],
      ['/articles/104', [HTML_LIKE.author, HTML_LIKE.tag]],
      ['/authors', [HTML_LIKE.author]],
      ['/authors/author-d', [HTML_LIKE.author]],
      ['/authors/author-a', [HTML_LIKE.title, HTML_LIKE.category]],
      ['/categories', [HTML_LIKE.category]],
      ['/tags', [HTML_LIKE.tag]],
      ['/tags/52', [HTML_LIKE.tag, HTML_LIKE.title]],
      ['/activity', [HTML_LIKE.category]],
    ];
    for (const [path, strings] of cases) {
      await openScreen(page, path);
      // 表の列を隠していない幅（既定の 1280）で、main の文字を見る。
      const text = await mainText(page);
      for (const value of strings) {
        expect.soft(text, `${path} に「${value}」が文字として出る`).toContain(value);
      }
      // エンティティの形は、戻さずにそのまま出す（<img にならない）。
      expect.soft(text, `${path} でエンティティを戻していない`).not.toContain('お店の紹介 <img');

      const dom = await page.evaluate(() => ({
        images: document.querySelectorAll('img').length,
        scripts: [...document.scripts].map((script) => ({
          src: script.getAttribute('src'),
          text: script.textContent ?? '',
        })),
        scriptedLinks: [...document.querySelectorAll('a[href]')].filter((anchor) =>
          /^\s*javascript:/i.test(anchor.getAttribute('href') ?? ''),
        ).length,
        eventAttributes: [...document.querySelectorAll('*')].filter((element) =>
          [...element.attributes].some((attribute) =>
            attribute.name.toLowerCase().startsWith('on'),
          ),
        ).length,
      }));
      expect.soft(dom.images, `${path} に img 要素がない`).toBe(0);
      expect.soft(dom.scriptedLinks, `${path} に javascript: のリンクがない`).toBe(0);
      expect.soft(dom.eventAttributes, `${path} にイベント属性がない`).toBe(0);
      for (const script of dom.scripts) {
        const ok =
          script.src === null
            ? inlineScriptKind(script.text) !== null
            : isNextStaticScript(script.src);
        expect
          .soft(ok, `${path} の script: ${(script.src ?? script.text).slice(0, 60)}`)
          .toBe(true);
      }
      expect.soft(await watch.violations(), `${path} の CSP 違反`).toEqual([]);
    }
    // alert などが 1 度も呼ばれていない。
    expect(watch.dialogs).toEqual([]);
    expect(watch.pageErrors).toEqual([]);
  });

  test('名前が javascript: で始まるタグ: リンク先はサイト内のパスのまま', async ({ page }) => {
    await openScreen(page, '/tags');
    const link = page.getByRole('link', { name: HTML_LIKE.tag });
    await expect(link.first()).toHaveAttribute('href', '/tags/52');
    await openScreen(page, '/authors');
    const author = page.getByRole('link', { name: HTML_LIKE.author });
    await expect(author.first()).toHaveAttribute('href', '/authors/author-d');
  });
});
