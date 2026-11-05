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
