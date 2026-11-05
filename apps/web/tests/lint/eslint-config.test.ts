import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// eslint.config.mjs の静的な規則（07 §7 S-01〜S-04、S-07）が実際に効くことを確かめる。
const eslint = new ESLint({ cwd: process.cwd() });

async function ruleIds(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((message) => message.ruleId ?? message.message);
}

const TIMEOUT_MS = 60_000;

describe('eslint.config.mjs', () => {
  it(
    'S-01: process.env の NEXT_PUBLIC_ を禁止する',
    async () => {
      const code = 'export const value = process.env.NEXT_PUBLIC_EXAMPLE;\n';
      expect(await ruleIds(code, 'src/lib/probe.ts')).toContain('no-restricted-syntax');
    },
    TIMEOUT_MS,
  );

  it(
    'S-01: NEXT_PUBLIC_ を付けない環境変数は許す',
    async () => {
      const code = 'export const value = process.env.SUPABASE_URL;\n';
      expect(await ruleIds(code, 'src/lib/probe.ts')).toEqual([]);
    },
    TIMEOUT_MS,
  );

  it(
    'S-02: src/data/pub の外の .from( を禁止する',
    async () => {
      const code = "export const run = (client: any) => client.from('pub_post');\n";
      expect(await ruleIds(code, 'src/lib/probe.ts')).toContain('local/pub-from-only');
    },
    TIMEOUT_MS,
  );

  it(
    'S-03: HTML 要素の style を禁止する',
    async () => {
      const code = 'export const View = () => <div style={{ color: "blue" }} />;\n';
      expect(await ruleIds(code, 'src/components/Probe.tsx')).toContain('react/forbid-dom-props');
    },
    TIMEOUT_MS,
  );

  it(
    'S-03: SVG 要素の style を禁止する',
    async () => {
      const code =
        'export const View = () => (<svg><rect style={{ fill: "blue" }} width={1} height={1} /></svg>);\n';
      expect(await ruleIds(code, 'src/components/Probe.tsx')).toContain('react/forbid-dom-props');
    },
    TIMEOUT_MS,
  );

  it(
    'S-03: dangerouslySetInnerHTML を禁止する',
    async () => {
      const code = 'export const View = () => <div dangerouslySetInnerHTML={{ __html: "" }} />;\n';
      expect(await ruleIds(code, 'src/components/Probe.tsx')).toContain('react/no-danger');
    },
    TIMEOUT_MS,
  );

  it(
    'S-04: JSX の中の文字列リテラルを禁止する',
    async () => {
      const code = 'export const View = () => <p>text</p>;\n';
      expect(await ruleIds(code, 'src/components/Probe.tsx')).toContain('react/jsx-no-literals');
    },
    TIMEOUT_MS,
  );

  it(
    'S-04: 属性値の文字列リテラルは許す',
    async () => {
      const code = 'export const View = () => <button type="button" className="a" />;\n';
      expect(await ruleIds(code, 'src/components/Probe.tsx')).toEqual([]);
    },
    TIMEOUT_MS,
  );

  it(
    'S-07: console を禁止する',
    async () => {
      const code = 'console.log(1);\n';
      expect(await ruleIds(code, 'src/lib/probe.ts')).toContain('no-console');
    },
    TIMEOUT_MS,
  );
});

// ADR 0010: script-src に 'unsafe-inline' を許すかわりに、値を HTML として描く出口を塞ぐ。
describe('eslint.config.mjs（ADR 0010 の歯止め）', () => {
  const component = 'src/components/Probe.tsx';
  const cases: [string, string, string, string][] = [
    [
      'script 要素',
      'export const View = () => <script src="/a.js" />;\n',
      component,
      'react/forbid-elements',
    ],
    [
      'JSON-LD の script 要素',
      'export const View = () => <script type="application/ld+json" />;\n',
      component,
      'react/forbid-elements',
    ],
    [
      'iframe 要素',
      'export const View = () => <iframe title="x" />;\n',
      component,
      'react/forbid-elements',
    ],
    ['object 要素', 'export const View = () => <object />;\n', component, 'react/forbid-elements'],
    ['embed 要素', 'export const View = () => <embed />;\n', component, 'react/forbid-elements'],
    [
      'base 要素',
      'export const View = () => <base href="/" />;\n',
      component,
      'react/forbid-elements',
    ],
    [
      '生の a 要素',
      'export const View = ({ url }: { url: string }) => <a href={url} />;\n',
      component,
      'react/forbid-elements',
    ],
    [
      'next/script の import',
      "import Script from 'next/script';\nexport default Script;\n",
      component,
      'no-restricted-imports',
    ],
    [
      'next/script の動的 import',
      "export const load = () => import('next/script');\n",
      'src/lib/probe.ts',
      'no-restricted-syntax',
    ],
    [
      'innerHTML',
      'export const run = (el: HTMLElement, value: string) => {\n  el.innerHTML = value;\n};\n',
      'src/lib/probe.ts',
      'no-restricted-properties',
    ],
    [
      'outerHTML',
      'export const run = (el: HTMLElement, value: string) => {\n  el.outerHTML = value;\n};\n',
      'src/lib/probe.ts',
      'no-restricted-properties',
    ],
    [
      'insertAdjacentHTML',
      "export const run = (el: HTMLElement, value: string) => el.insertAdjacentHTML('beforeend', value);\n",
      'src/lib/probe.ts',
      'no-restricted-properties',
    ],
    [
      'document.write',
      'export const run = (value: string) => document.write(value);\n',
      'src/lib/probe.ts',
      'no-restricted-properties',
    ],
    [
      'createElement("script")',
      "export const run = () => document.createElement('script');\n",
      'src/lib/probe.ts',
      'no-restricted-syntax',
    ],
    [
      'setAttribute("onclick")',
      "export const run = (el: HTMLElement) => el.setAttribute('onclick', 'x()');\n",
      'src/lib/probe.ts',
      'no-restricted-syntax',
    ],
    ['eval', 'export const run = (value: string) => eval(value);\n', 'src/lib/probe.ts', 'no-eval'],
    [
      'new Function',
      'export const run = (value: string) => new Function(value);\n',
      'src/lib/probe.ts',
      'no-new-func',
    ],
    [
      '文字列を渡す setTimeout',
      "export const run = () => setTimeout('x()', 1);\n",
      'src/lib/probe.ts',
      'no-implied-eval',
    ],
    [
      'javascript: の URL',
      "export const url = 'javascript:alert(1)';\n",
      'src/lib/probe.ts',
      'no-script-url',
    ],
  ];

  it.each(cases)(
    '%s を禁止する',
    async (_name, code, filePath, ruleId) => {
      expect(await ruleIds(code, filePath)).toContain(ruleId);
    },
    TIMEOUT_MS,
  );

  it(
    '無効化コメントで規則を外せない',
    async () => {
      const code =
        '// eslint-disable-next-line react/no-danger\nexport const View = () => <div dangerouslySetInnerHTML={{ __html: "" }} />;\n';
      expect(await ruleIds(code, component)).toContain('react/no-danger');
    },
    TIMEOUT_MS,
  );

  it(
    'a 要素を描けるのは、リンク先を検証する部品だけ',
    async () => {
      const code = 'export const View = ({ url }: { url: string }) => <a href={url} />;\n';
      expect(await ruleIds(code, 'src/components/ExternalLink.tsx')).not.toContain(
        'react/forbid-elements',
      );
    },
    TIMEOUT_MS,
  );
});
