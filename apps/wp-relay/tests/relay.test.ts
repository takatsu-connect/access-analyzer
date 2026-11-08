// 中継の単体テスト（ADR 0011）。上流は偽の fetch で、実サイトには接続しない。
import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT } from '../api/relay.js';

const TOKEN = 'fake-relay-token-'.padEnd(64, '0');
const RELAY = 'https://relay.example/api/relay';
const UPSTREAM = 'https://takatsu-connect.com/wp-json/wp/v2';
const POST_FIELDS =
  'id,date_gmt,modified_gmt,link,title.rendered,author,categories,tags,content.protected';
const LIST = { _fields: 'id', status: 'publish', per_page: '100', page: '1' };
const FIXED_HEADERS = [
  'cache-control',
  'content-security-policy',
  'referrer-policy',
  'x-content-type-options',
];

interface RelayRequest {
  kind: string;
  path: string;
  query: Record<string, string>;
}

function readContract<T>(name: string): T {
  const url = new URL(`../../../contracts/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as T;
}

type Fetch = typeof fetch;
const upstreamFetch = vi.fn<Fetch>();
let logs: string[];

function okResponse(init: ResponseInit = {}, body: string | null = '[]'): Response {
  return new Response(body, { status: 200, ...init });
}

function request(
  path: string | null,
  query: Record<string, string> | string = {},
  options: { method?: string; token?: string | null } = {},
): Request {
  const search = typeof query === 'string' ? query : new URLSearchParams(query).toString();
  const headers = new Headers();
  const token = options.token === undefined ? TOKEN : options.token;
  if (token !== null) headers.set('Authorization', `Bearer ${token}`);
  if (path !== null) headers.set('X-WP-Path', path);
  return new Request(`${RELAY}?${search}`, { method: options.method ?? 'GET', headers });
}

function calledUrl(): URL {
  const first = upstreamFetch.mock.calls[0];
  if (first === undefined) throw new Error('上流が呼ばれていない');
  return new URL(String(first[0]));
}

function calledInit(): RequestInit {
  const init = upstreamFetch.mock.calls[0]?.[1];
  if (init === undefined) throw new Error('上流が呼ばれていない');
  return init;
}

function lastLog(): Record<string, unknown> {
  const line = logs.at(-1);
  if (line === undefined) throw new Error('ログがない');
  return JSON.parse(line) as Record<string, unknown>;
}

async function expectEmpty(response: Response, status: number): Promise<void> {
  expect(response.status).toBe(status);
  expect(await response.text()).toBe('');
}

beforeEach(() => {
  upstreamFetch.mockReset();
  upstreamFetch.mockImplementation(async () => okResponse());
  vi.stubGlobal('fetch', upstreamFetch);
  vi.stubEnv('WP_RELAY_TOKEN', TOKEN);
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
    logs.push(String(line));
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('トークン', () => {
  it.each([
    ['違う値', 'wrong-token'],
    ['前方一致', TOKEN.slice(0, 10)],
    ['余分な文字', `${TOKEN}x`],
  ])('%s は 401 で上流を呼ばない', async (_name, token) => {
    await expectEmpty(await GET(request('/posts', LIST, { token })), 401);
    expect(upstreamFetch).not.toHaveBeenCalled();
    expect(lastLog().outcome).toBe('unauthorized');
  });

  it('ヘッダがないときは 401', async () => {
    await expectEmpty(await GET(request('/posts', LIST, { token: null })), 401);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('Bearer 以外の形は 401', async () => {
    const headers = new Headers({ Authorization: TOKEN, 'X-WP-Path': '/posts' });
    const search = new URLSearchParams(LIST).toString();
    await expectEmpty(await GET(new Request(`${RELAY}?${search}`, { headers })), 401);
  });

  it.each([
    ['未設定', undefined],
    ['空', ''],
  ])('環境変数が%sなら 401 で全拒否し、ログだけ misconfigured', async (_name, value) => {
    vi.stubEnv('WP_RELAY_TOKEN', value as string);
    await expectEmpty(await GET(request('/posts', LIST)), 401);
    expect(upstreamFetch).not.toHaveBeenCalled();
    expect(lastLog().outcome).toBe('misconfigured');
  });

  it('環境変数が 64 文字未満なら、一致するトークンでも 401 で misconfigured', async () => {
    const short = 'a'.repeat(63);
    vi.stubEnv('WP_RELAY_TOKEN', short);
    await expectEmpty(await GET(request('/posts', LIST, { token: short })), 401);
    expect(upstreamFetch).not.toHaveBeenCalled();
    expect(lastLog().outcome).toBe('misconfigured');
  });

  it('環境変数がちょうど 64 文字なら通る', async () => {
    const exact = 'a'.repeat(64);
    vi.stubEnv('WP_RELAY_TOKEN', exact);
    expect((await GET(request('/posts', LIST, { token: exact }))).status).toBe(200);
  });

  it('環境変数が空のとき、空のトークンでも通らない', async () => {
    vi.stubEnv('WP_RELAY_TOKEN', '');
    await expectEmpty(await GET(request('/posts', LIST, { token: '' })), 401);
  });

  it('トークンの検査はメソッドとパスの検証より先', async () => {
    await expectEmpty(await POST(request(null, '', { method: 'POST', token: 'wrong' })), 401);
    await expectEmpty(await GET(request('/wp-admin', {}, { token: 'wrong' })), 401);
  });
});

describe('メソッド', () => {
  it.each([
    ['POST', POST],
    ['PUT', PUT],
    ['PATCH', PATCH],
    ['DELETE', DELETE],
    ['OPTIONS', OPTIONS],
    ['HEAD', HEAD],
  ])('%s は 405', async (method, handler) => {
    await expectEmpty(await handler(request('/posts', LIST, { method })), 405);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});

describe('パス', () => {
  it.each([
    null,
    '',
    '/',
    '/posts/',
    '/posts/1',
    '/posts/../users/1',
    '/%70osts',
    '/posts%2F',
    '/posts?x=1',
    '/Posts',
    '//posts',
    'posts',
    '/users',
    '/users/',
    '/users/0',
    '/users/01',
    '/users/12345678901',
    '/users/1/',
    '/users/abc',
    '/users/1/application-passwords',
    '/settings',
    '/media',
    '/comments',
  ])('%s は 400', async (path) => {
    const query = path?.startsWith('/users') === true ? { _fields: 'name,slug,link' } : LIST;
    await expectEmpty(await GET(request(path, query)), 400);
    expect(upstreamFetch).not.toHaveBeenCalled();
    expect(lastLog().outcome).toBe('invalid');
  });

  it.each(['/users/1', '/users/1234567890'])('%s は通る', async (path) => {
    const response = await GET(request(path, { _fields: 'name,slug,link' }));
    expect(response.status).toBe(200);
  });

  it('転送先は定数のホストに検証済みのパスを連結したもの', async () => {
    await GET(request('/users/7', { _fields: 'name,slug,link' }));
    expect(`${calledUrl().origin}${calledUrl().pathname}`).toBe(`${UPSTREAM}/users/7`);
  });
});

describe('クエリのキー', () => {
  it('表にないキーは 400', async () => {
    await expectEmpty(await GET(request('/posts', { ...LIST, orderby: 'date' })), 400);
    await expectEmpty(await GET(request('/posts', { ...LIST, context: 'edit' })), 400);
  });

  it('同じキーの重複は 400', async () => {
    const search = `${new URLSearchParams(LIST).toString()}&page=2`;
    await expectEmpty(await GET(request('/posts', search)), 400);
  });

  it('エンコードで綴りを変えた重複も 400', async () => {
    const search = `${new URLSearchParams(LIST).toString()}&p%61ge=2`;
    await expectEmpty(await GET(request('/posts', search)), 400);
  });

  it.each(['status', '_fields', 'per_page', 'page'] as const)(
    '/posts の必須キー %s が欠けると 400',
    async (key) => {
      const query: Record<string, string> = { ...LIST };
      delete query[key];
      await expectEmpty(await GET(request('/posts', query)), 400);
      expect(upstreamFetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['/categories', { _fields: 'id,name,parent', per_page: '100' }],
    ['/categories', { _fields: 'id,name,parent', page: '1' }],
    ['/categories', { per_page: '100', page: '1' }],
    ['/tags', { _fields: 'id,name', per_page: '100' }],
    ['/tags', { per_page: '100', page: '1' }],
    ['/users/7', {}],
  ])('%s の必須キーが欠けると 400（%j）', async (path, query) => {
    await expectEmpty(await GET(request(path, query as Record<string, string>)), 400);
  });

  it('/categories と /tags と /users に /posts のキーを足すと 400', async () => {
    const base = { per_page: '100', page: '1' };
    await expectEmpty(
      await GET(request('/categories', { ...base, _fields: 'id,name,parent', status: 'publish' })),
      400,
    );
    await expectEmpty(
      await GET(request('/tags', { ...base, _fields: 'id,name', include: '1' })),
      400,
    );
    await expectEmpty(await GET(request('/users/7', { ...base, _fields: 'name,slug,link' })), 400);
  });

  it('クエリは検証済みの組から組み立て直し、余計な符号を流用しない', async () => {
    await GET(request('/posts', `page=1&per_page=100&_fields=id&status=publ%69sh`));
    expect(Object.fromEntries(calledUrl().searchParams)).toEqual(LIST);
    expect(calledUrl().search).not.toContain('%69');
  });
});

describe('クエリの値', () => {
  it.each([
    ['status', 'draft'],
    ['status', 'publish,draft'],
    ['status', ''],
    ['_fields', 'id,content'],
    ['_fields', 'content.rendered'],
    ['_fields', ''],
    ['_fields', 'id,name,parent'],
    ['per_page', '0'],
    ['per_page', '101'],
    ['per_page', '1000'],
    ['per_page', '-1'],
    ['per_page', '1e2'],
    ['per_page', '１００'],
    ['page', '0'],
    ['page', '51'],
    ['page', '100'],
    ['page', ''],
  ])('/posts の %s=%s は 400', async (key, value) => {
    await expectEmpty(await GET(request('/posts', { ...LIST, [key]: value })), 400);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it.each([
    '2026-11-03',
    '2026-11-03T18:30:15',
    '2026-11-03T18:30:15+09:00',
    '2026-11-03T18:30:15.000Z',
    '2026-11-03T18:30:15Z\n',
    '',
  ])('modified_after=%j は 400', async (value) => {
    await expectEmpty(await GET(request('/posts', { ...LIST, modified_after: value })), 400);
  });

  it.each([
    '',
    '0',
    '01',
    '1,',
    ',1',
    '1,,2',
    '1, 2',
    'a',
    '-1',
    '12345678901',
    Array.from({ length: 101 }, (_, index) => index + 1).join(','),
  ])('include=%s は 400', async (value) => {
    await expectEmpty(await GET(request('/posts', { ...LIST, include: value })), 400);
  });

  it.each([
    ['/posts', 'status', 'publish', POST_FIELDS],
    ['/posts', 'status', 'publish', 'id'],
    ['/posts', 'status', 'publish', 'id,author'],
  ])('%s の許可された _fields は通る', async (path, key, value, fields) => {
    const response = await GET(
      request(path, { [key]: value, _fields: fields, per_page: '100', page: '1' }),
    );
    expect(response.status).toBe(200);
  });

  it('per_page と page の境界と、100 個の include は通る', async () => {
    const include = Array.from({ length: 100 }, (_, index) => index + 1).join(',');
    for (const query of [
      { ...LIST, per_page: '1', page: '50' },
      { ...LIST, include },
      { ...LIST, modified_after: '2026-11-03T18:30:15Z' },
    ]) {
      expect((await GET(request('/posts', query))).status).toBe(200);
    }
  });

  it.each([
    ['/categories', 'id,name'],
    ['/tags', 'id'],
    ['/users/7', 'name,slug'],
    ['/users/7', 'name,slug,link,email'],
    ['/users/7', 'id'],
  ])('%s の _fields=%s は 400', async (path, fields) => {
    const list = path.startsWith('/users') ? {} : { per_page: '100', page: '1' };
    await expectEmpty(await GET(request(path, { ...list, _fields: fields })), 400);
  });
});

describe('転送', () => {
  it('受信したヘッダを転送せず、リダイレクトを追わない', async () => {
    const headers = new Headers({
      Authorization: `Bearer ${TOKEN}`,
      Cookie: 'session=fake',
      'X-Forwarded-For': '203.0.113.5',
      'User-Agent': 'caller',
      'X-WP-Path': '/posts',
    });
    const search = new URLSearchParams(LIST).toString();
    await GET(new Request(`${RELAY}?${search}`, { headers }));
    const init = calledInit();
    expect(init.redirect).toBe('manual');
    expect(init.method).toBe('GET');
    expect(Object.keys(init.headers as Record<string, string>)).toEqual(['User-Agent']);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it('中継の中で再試行しない', async () => {
    upstreamFetch.mockImplementation(async () => new Response('x', { status: 503 }));
    await GET(request('/posts', LIST));
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });
});

describe('応答', () => {
  it('2xx は本文と総数のヘッダだけを返し、ほかの上流ヘッダを落とす', async () => {
    upstreamFetch.mockImplementation(async () =>
      okResponse(
        {
          headers: {
            'X-WP-Total': '123',
            'X-WP-TotalPages': '2',
            'Set-Cookie': 'wp=fake',
            Server: 'fake',
            Link: '<https://example.test>',
            Location: 'https://example.test',
            'Content-Type': 'application/json',
          },
        },
        '[{"id":1}]',
      ),
    );
    const response = await GET(request('/posts', LIST));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('[{"id":1}]');
    expect([...response.headers.keys()].sort()).toEqual(
      [...FIXED_HEADERS, 'x-wp-total', 'x-wp-totalpages'].sort(),
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('Content-Security-Policy')).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(lastLog().outcome).toBe('ok');
  });

  it.each(['abc', '12345678901', '1 2', '-1'])(
    '総数のヘッダが %s なら返さない',
    async (value) => {
      upstreamFetch.mockImplementation(async () =>
        okResponse({ headers: { 'X-WP-Total': value, 'X-WP-TotalPages': value } }),
      );
      const response = await GET(request('/posts', LIST));
      expect(response.headers.has('X-WP-Total')).toBe(false);
      expect(response.headers.has('X-WP-TotalPages')).toBe(false);
    },
  );

  it.each([204, 205])('%s は本文なしで返す', async (status) => {
    upstreamFetch.mockImplementation(async () => new Response(null, { status }));
    expect((await GET(request('/posts', LIST))).status).toBe(status);
  });

  it.each([301, 302, 307, 308, 400, 401, 403, 404, 410, 429, 500, 502, 503, 504])(
    '上流の %s は状態コードのまま、本文とヘッダなしで返す',
    async (status) => {
      upstreamFetch.mockImplementation(
        async () =>
          new Response(status >= 400 ? '<html>secret page</html>' : null, {
            status,
            headers: {
              Location: 'https://elsewhere.example/',
              'X-WP-Total': '5',
              'Set-Cookie': 'wp=fake',
            },
          }),
      );
      const response = await GET(request('/posts', LIST));
      await expectEmpty(response, status);
      expect([...response.headers.keys()].sort()).toEqual(FIXED_HEADERS);
      expect(lastLog()).toMatchObject({ outcome: 'upstream_status', status });
    },
  );

  it('状態コードが 0 に見える redirect も 3xx として返す', async () => {
    const opaque = { status: 0, headers: new Headers(), body: null } as unknown as Response;
    upstreamFetch.mockImplementation(async () => opaque);
    await expectEmpty(await GET(request('/posts', LIST)), 302);
  });

  it('本文がちょうど上限なら返す', async () => {
    upstreamFetch.mockImplementation(async () => okResponse({}, 'a'.repeat(4_000_000)));
    const response = await GET(request('/posts', LIST));
    expect(response.status).toBe(200);
    expect((await response.arrayBuffer()).byteLength).toBe(4_000_000);
  });

  it('本文が上限を超えたら 413 で打ち切り、Content-Length を信用しない', async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1_000_000));
      },
    });
    upstreamFetch.mockImplementation(
      async () => new Response(stream, { status: 200, headers: { 'Content-Length': '10' } }),
    );
    await expectEmpty(await GET(request('/posts', LIST)), 413);
    expect(lastLog().outcome).toBe('too_large');
    expect(pulled).toBeLessThan(10);
  });

  it('上流に接続できないときは 502', async () => {
    upstreamFetch.mockRejectedValue(new TypeError('fetch failed https://internal.example'));
    await expectEmpty(await GET(request('/posts', LIST)), 502);
    expect(lastLog().outcome).toBe('upstream_unreachable');
  });

  it('本文の途中で切れたときも 502', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('connection reset'));
      },
    });
    upstreamFetch.mockImplementation(async () => new Response(stream, { status: 200 }));
    await expectEmpty(await GET(request('/posts', LIST)), 502);
  });

  it('応答待ちが 20 秒を超えたら 504', async () => {
    vi.useFakeTimers();
    upstreamFetch.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const pending = GET(request('/posts', LIST));
    await vi.advanceTimersByTimeAsync(19_999);
    expect(logs).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await expectEmpty(await pending, 504);
    expect(lastLog().outcome).toBe('upstream_timeout');
  });

  it('本文の読み終わりが 20 秒を超えても 504', async () => {
    vi.useFakeTimers();
    upstreamFetch.mockImplementation(async (_url, init) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener('abort', () => {
            controller.error(new DOMException('aborted', 'AbortError'));
          });
        },
      });
      return new Response(stream, { status: 200 });
    });
    const pending = GET(request('/posts', LIST));
    await vi.advanceTimersByTimeAsync(20_000);
    await expectEmpty(await pending, 504);
  });
});

describe('ログ', () => {
  it('outcome、status、duration_ms だけを出し、値を出さない', async () => {
    upstreamFetch.mockImplementation(async () =>
      okResponse({ headers: { 'X-WP-Total': '987654' } }, '"upstream-body"'),
    );
    await GET(request('/users/424242', { _fields: 'name,slug,link' }));
    await GET(request('/posts', { ...LIST, include: '999111' }));
    await GET(request('/nope/777333', LIST));
    await GET(request('/posts', LIST, { token: 'wrong-fake-value' }));
    expect(logs).toHaveLength(4);
    for (const line of logs) {
      expect(Object.keys(JSON.parse(line) as object).sort()).toEqual([
        'duration_ms',
        'outcome',
        'status',
      ]);
      for (const word of [
        TOKEN,
        'wrong-fake-value',
        '424242',
        '999111',
        '777333',
        'upstream-body',
        '987654',
      ]) {
        expect(line).not.toContain(word);
      }
    }
  });
});

describe('URL の解釈の失敗', () => {
  it('request.url が解釈できないときは invalid の 400', async () => {
    const broken = {
      method: 'GET',
      url: 'not a url',
      headers: new Headers({ Authorization: `Bearer ${TOKEN}`, 'X-WP-Path': '/posts' }),
    } as unknown as Request;
    await expectEmpty(await GET(broken), 400);
    expect(upstreamFetch).not.toHaveBeenCalled();
    expect(lastLog()).toMatchObject({ outcome: 'invalid', status: 400 });
  });
});

describe('構成', () => {
  const root = new URL('../', import.meta.url);
  const vercel = JSON.parse(readFileSync(new URL('vercel.json', root), 'utf8')) as {
    regions: string[];
    functions: Record<string, { maxDuration: number }>;
  };

  it('リージョンは hnd1 だけ', () => {
    expect(vercel.regions).toEqual(['hnd1']);
  });

  it('maxDuration は 30 秒未満（バッチの timeout より短い）', () => {
    expect(vercel.functions['api/relay.ts']?.maxDuration).toBeLessThan(30);
  });

  it('api/ のファイルは relay.ts だけ', () => {
    expect(readdirSync(new URL('api/', root), { recursive: true })).toEqual(['relay.ts']);
  });
});

describe('バッチとの突き合わせ（contracts/）', () => {
  it.each(readContract<RelayRequest[]>('wp_relay_requests.json'))(
    'バッチが送る $kind が許可リストを通り、同じ組が上流へ転送される',
    async ({ path, query }) => {
      const response = await GET(request(path, query));
      expect(response.status).toBe(200);
      expect(calledUrl().pathname).toBe(`/wp-json/wp/v2${path}`);
      expect(Object.fromEntries(calledUrl().searchParams)).toEqual(query);
    },
  );

  it('一覧に 8 種がそろっている', () => {
    const kinds = readContract<RelayRequest[]>('wp_relay_requests.json').map((item) => item.kind);
    expect(new Set(kinds).size).toBe(8);
  });

  describe('constants.json の値', () => {
    interface WpRelayContract {
      SITE_API_ROOT: string;
      USER_AGENT: string;
      PER_PAGE: number;
      MAX_PAGES: number;
      POST_FIELDS: string;
      ID_FIELDS: string;
      ID_AUTHOR_FIELDS: string;
      CATEGORY_FIELDS: string;
      TAG_FIELDS: string;
      USER_FIELDS: string;
    }
    const contract = readContract<{ WP_RELAY: WpRelayContract }>('constants.json').WP_RELAY;

    it('User-Agent と転送先が一致する', async () => {
      await GET(request('/posts', LIST));
      expect((calledInit().headers as Record<string, string>)['User-Agent']).toBe(
        contract.USER_AGENT,
      );
      expect(`${calledUrl().origin}${calledUrl().pathname}`).toBe(
        `${contract.SITE_API_ROOT}/posts`,
      );
    });

    it('per_page と page の上限が一致する', async () => {
      const at = (per: number, page: number) =>
        GET(request('/posts', { ...LIST, per_page: String(per), page: String(page) }));
      expect((await at(contract.PER_PAGE, contract.MAX_PAGES)).status).toBe(200);
      expect((await at(contract.PER_PAGE + 1, 1)).status).toBe(400);
      expect((await at(contract.PER_PAGE, contract.MAX_PAGES + 1)).status).toBe(400);
    });

    it.each([
      ['/posts', 'POST_FIELDS'],
      ['/posts', 'ID_FIELDS'],
      ['/posts', 'ID_AUTHOR_FIELDS'],
      ['/categories', 'CATEGORY_FIELDS'],
      ['/tags', 'TAG_FIELDS'],
      ['/users/7', 'USER_FIELDS'],
    ] as const)('%s は %s を受け付ける', async (path, key) => {
      const query: Record<string, string> = { _fields: contract[key] };
      if (path === '/posts') query.status = 'publish';
      if (!path.startsWith('/users')) Object.assign(query, { per_page: '100', page: '1' });
      expect((await GET(request(path, query))).status).toBe(200);
    });
  });
});
