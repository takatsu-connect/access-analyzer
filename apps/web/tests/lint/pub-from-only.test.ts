import path from 'node:path';

import { Linter } from 'eslint';
import type { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

import localRules from '../../eslint-rules/index.mjs';

// S-02 の規則そのものの単体テスト。違反と正常の例を並べる。
const ROOT = process.cwd();
const IN_DATA_DIR = 'src/data/pub/posts.ts';
const OUTSIDE_DATA_DIR = 'src/lib/page-data.ts';

function lint(code: string, relativePath: string): string[] {
  const linter = new Linter({ cwd: ROOT, configType: 'flat' });
  const messages = linter.verify(
    code,
    [
      {
        files: ['**/*.ts'],
        plugins: { local: localRules as unknown as ESLint.Plugin },
        languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
        rules: { 'local/pub-from-only': 'error' },
      },
    ],
    { filename: path.join(ROOT, relativePath) },
  );
  return messages.map((message) => message.messageId ?? message.message);
}

describe('local/pub-from-only', () => {
  describe('正常', () => {
    it.each([
      ["client.from('pub_post').select('*');"],
      ['client.from("pub_site_daily");'],
      ["client?.from('pub_author');"],
      ["const rows = [...items]; const from = 'x'; fromHelper(from, rows);"],
    ])('%s', (code) => {
      expect(lint(code, IN_DATA_DIR)).toEqual([]);
    });
  });

  describe('違反: 第 1 引数', () => {
    it.each([
      ["client.from('post');"],
      ["client.from('article_stats');"],
      ["const table = 'pub_post'; client.from(table);"],
      ['client.from(`pub_post`);'],
      ["client.from('pub_' + name);"],
      ['client.from();'],
      ["client['from']('post');"],
      ['Array.from(items);'],
    ])('%s', (code) => {
      expect(lint(code, IN_DATA_DIR)).toEqual(['notPubLiteral']);
    });
  });

  describe('違反: 置き場所', () => {
    it.each([
      ["client.from('pub_post');"],
      ["client?.from('pub_post');"],
      ["client['from']('pub_post');"],
      ['Array.from(items);'],
    ])('%s', (code) => {
      expect(lint(code, OUTSIDE_DATA_DIR)).toEqual(['outsideDataDir']);
    });

    it('src/data の直下（pub の外）でも使えない', () => {
      expect(lint("client.from('pub_post');", 'src/data/index.ts')).toEqual(['outsideDataDir']);
    });
  });
});
