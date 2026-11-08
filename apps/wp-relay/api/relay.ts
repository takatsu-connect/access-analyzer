// WP REST API の読み取り専用の中継（ADR 0011）。
// 検査の順序はトークン、メソッド、パスとクエリ。認証を通らない相手には理由も設定の状態も返さない。
// このディレクトリにほかのファイルを置かない（別の関数として公開されないようにする。ADR 0011 §1）。
import { createHash, timingSafeEqual } from 'node:crypto';

const UPSTREAM_ROOT = 'https://takatsu-connect.com/wp-json/wp/v2';
// バッチの WP_USER_AGENT と同じ値。contracts/constants.json でテストが突き合わせる
const USER_AGENT =
  'takatsu-connect-access-analyzer/0.1 (+https://github.com/takatsu-connect/access-analyzer)';
// 32 バイト以上の乱数の 16 進表現（ADR 0011 §3）
const MIN_TOKEN_LENGTH = 64;
const UPSTREAM_TIMEOUT_MS = 20_000;
// Vercel の 4.5 MB より手前で、種別の分かる 413 で止める
const MAX_BODY_BYTES = 4_000_000;
const TOTAL_HEADERS = ['X-WP-Total', 'X-WP-TotalPages'] as const;
const TOTAL_VALUE = /^[0-9]{1,10}$/;
const STATUS_NO_BODY = new Set([204, 205]);

const POST_FIELDS =
  'id,date_gmt,modified_gmt,link,title.rendered,author,categories,tags,content.protected';
const USERS_PATH = /^\/users\/[1-9][0-9]{0,9}$/;
const ID = '[1-9][0-9]{0,9}';
const MODIFIED_AFTER = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const INCLUDE = new RegExp(`^${ID}(,${ID}){0,99}$`);

type Outcome =
  | 'ok'
  | 'upstream_status'
  | 'unauthorized'
  | 'invalid'
  | 'too_large'
  | 'upstream_unreachable'
  | 'upstream_timeout'
  | 'misconfigured';

interface Rule {
  required: readonly string[];
  optional: readonly string[];
  fields: readonly string[];
}

const LIST_KEYS = ['_fields', 'per_page', 'page'] as const;
const POSTS: Rule = {
  required: ['status', ...LIST_KEYS],
  optional: ['modified_after', 'include'],
  fields: [POST_FIELDS, 'id', 'id,author'],
};
const CATEGORIES: Rule = { required: LIST_KEYS, optional: [], fields: ['id,name,parent'] };
const TAGS: Rule = { required: LIST_KEYS, optional: [], fields: ['id,name'] };
const USERS: Rule = { required: ['_fields'], optional: [], fields: ['name,slug,link'] };

function ruleFor(path: string): Rule | undefined {
  if (path === '/posts') return POSTS;
  if (path === '/categories') return CATEGORIES;
  if (path === '/tags') return TAGS;
  return USERS_PATH.test(path) ? USERS : undefined;
}

function inRange(value: string, pattern: RegExp, max: number): boolean {
  if (!pattern.test(value)) return false;
  const parsed = Number(value);
  return parsed >= 1 && parsed <= max;
}

function isValidValue(key: string, value: string, rule: Rule): boolean {
  switch (key) {
    case 'status':
      return value === 'publish';
    case '_fields':
      return rule.fields.includes(value);
    case 'per_page':
      return inRange(value, /^[0-9]{1,3}$/, 100);
    case 'page':
      return inRange(value, /^[0-9]{1,2}$/, 50);
    case 'modified_after':
      return MODIFIED_AFTER.test(value);
    case 'include':
      return INCLUDE.test(value);
    default:
      return false;
  }
}

/** 検証を通ったら転送先の URL を、受信した文字列を使わずに組み立てて返す。 */
function buildUpstreamUrl(request: Request): string | undefined {
  const path = request.headers.get('X-WP-Path');
  if (path === null) return undefined;
  const rule = ruleFor(path);
  if (rule === undefined) return undefined;

  const received = new URL(request.url).searchParams;
  const keys = [...received.keys()];
  const allowed = [...rule.required, ...rule.optional];
  if (new Set(keys).size !== keys.length) return undefined;
  if (keys.some((key) => !allowed.includes(key))) return undefined;
  if (rule.required.some((key) => !received.has(key))) return undefined;

  const query = new URLSearchParams();
  for (const key of allowed) {
    const value = received.get(key);
    if (value === null) continue;
    if (!isValidValue(key, value, rule)) return undefined;
    query.set(key, value);
  }
  return `${UPSTREAM_ROOT}${path}?${query.toString()}`;
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** 長さの違いで分岐しないように、ハッシュどうしを比べる。 */
function isAuthorized(request: Request, token: string): boolean {
  const received = request.headers.get('Authorization') ?? '';
  return timingSafeEqual(sha256(received), sha256(`Bearer ${token}`));
}

function respond(
  outcome: Outcome,
  status: number,
  startedAt: number,
  body: Uint8Array<ArrayBuffer> | null = null,
  totals: Headers = new Headers(),
): Response {
  // 1 リクエスト 1 行。トークン、クエリの値、パスの ID、上流の本文やヘッダは出さない（ADR 0011 §5）
  console.log(JSON.stringify({ outcome, status, duration_ms: Date.now() - startedAt }));
  const headers = new Headers(totals);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  headers.set('Referrer-Policy', 'no-referrer');
  return new Response(body, { status, headers });
}

function pickTotals(upstream: Headers): Headers {
  const totals = new Headers();
  for (const name of TOTAL_HEADERS) {
    const value = upstream.get(name);
    if (value !== null && TOTAL_VALUE.test(value)) totals.set(name, value);
  }
  return totals;
}

async function discardBody(response: globalThis.Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // 読み捨ての失敗は応答に関係しない
  }
}

/** 本文を数えながら読む。上限を超えたら読むのをやめて undefined を返す。 */
async function readLimited(
  response: globalThis.Response,
): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const merged = new Uint8Array(MAX_BODY_BYTES);
  let total = 0;
  if (response.body === null) return merged.slice(0, 0);
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return merged.slice(0, total);
    if (total + value.byteLength > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    merged.set(value, total);
    total += value.byteLength;
  }
}

/** redirect: 'manual' で状態コードが見えない環境（0）でも、3xx として即失敗にする。 */
function upstreamStatus(status: number): number {
  return status === 0 ? 302 : status;
}

async function forward(url: string, startedAt: number): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  // 応答ヘッダまでではなく、本文の読み終わりまでの時間を測る
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
      cache: 'no-store',
    });
    const status = upstreamStatus(upstream.status);
    if (status < 200 || status > 299) {
      await discardBody(upstream);
      if (status < 200 || status > 599) {
        return respond('upstream_unreachable', 502, startedAt);
      }
      return respond('upstream_status', status, startedAt);
    }
    const body = await readLimited(upstream);
    if (body === undefined) return respond('too_large', 413, startedAt);
    return respond(
      'ok',
      status,
      startedAt,
      STATUS_NO_BODY.has(status) ? null : body,
      pickTotals(upstream.headers),
    );
  } catch {
    return timedOut
      ? respond('upstream_timeout', 504, startedAt)
      : respond('upstream_unreachable', 502, startedAt);
  } finally {
    clearTimeout(timer);
  }
}

async function handle(request: Request): Promise<Response> {
  const startedAt = Date.now();
  const token = process.env.WP_RELAY_TOKEN;
  if (token === undefined || token.length < MIN_TOKEN_LENGTH) {
    return respond('misconfigured', 401, startedAt);
  }
  if (!isAuthorized(request, token)) return respond('unauthorized', 401, startedAt);
  if (request.method !== 'GET') return respond('invalid', 405, startedAt);
  let url: string | undefined;
  try {
    url = buildUpstreamUrl(request);
  } catch {
    // URL が解釈できないときも、基盤の 500 にせず検証の失敗として返す
    url = undefined;
  }
  if (url === undefined) return respond('invalid', 400, startedAt);
  return forward(url, startedAt);
}

// GET 以外もトークンを検査してから 405 にするため、すべてのメソッドで同じ処理を通す（ADR 0011 §3）
export async function GET(request: Request): Promise<Response> {
  return handle(request);
}
export async function HEAD(request: Request): Promise<Response> {
  return handle(request);
}
export async function POST(request: Request): Promise<Response> {
  return handle(request);
}
export async function PUT(request: Request): Promise<Response> {
  return handle(request);
}
export async function PATCH(request: Request): Promise<Response> {
  return handle(request);
}
export async function DELETE(request: Request): Promise<Response> {
  return handle(request);
}
export async function OPTIONS(request: Request): Promise<Response> {
  return handle(request);
}
