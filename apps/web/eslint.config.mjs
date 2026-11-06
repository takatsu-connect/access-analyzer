/**
 * ESLint の設定（flat config）。07 §7 の S-01〜S-04、S-07、S-12 の BI 側をここで検査する。
 * `next lint` は廃止されたので、ESLint を直接呼ぶ（package.json の lint）。
 *
 * CSP の script-src は 'unsafe-inline' を許している（ADR 0010）。インラインの script を
 * CSP が止めないので、値を HTML として描く出口をここで塞ぐ。規則を緩めるときは ADR 0010 を
 * 見直してからにする。
 */
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

import localRules from './eslint-rules/index.mjs';

const ENV_MESSAGE =
  'NEXT_PUBLIC_ で始まる環境変数は使いません（07 §7 S-01）。値はビルド時にサーバー側で読みます。';
const HTML_SINK_MESSAGE =
  '値を HTML として解釈させる書き方は使いません（ADR 0010）。値は React のテキストとして描きます。';
const NAVIGATION_MESSAGE =
  'スクリプトで移動先を作りません（ADR 0010 の 3）。サイト内は next/link、外部は ExternalLink を使います。';
const NEXT_SCRIPT_IMPORT = {
  name: 'next/script',
  message: 'next/script は使いません（ADR 0010）。',
};
const REACT_ELEMENT_IMPORT = {
  name: 'react',
  importNames: ['createElement', 'cloneElement'],
  message: '要素は JSX で書きます（ADR 0010）。',
};

/** HTML として解釈される出口（JSX の外）。 */
const HTML_SINK_PROPERTIES = [
  'innerHTML',
  'outerHTML',
  'insertAdjacentHTML',
  'srcdoc',
  'setHTMLUnsafe',
  'createContextualFragment',
];

export default defineConfig([
  globalIgnores([
    '.next/**',
    'out/**',
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
    'next-env.d.ts',
  ]),
  ...nextVitals,
  ...nextTs,
  {
    name: 'access-analyzer/no-inline-config',
    // 無効化コメント（eslint-disable）で規則を外せないようにする（ADR 0010 の 7）。
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error' },
  },
  {
    name: 'access-analyzer/static-rules',
    files: ['**/*.{js,jsx,mjs,ts,tsx,mts}'],
    plugins: { local: localRules },
    rules: {
      'no-restricted-syntax': [
        'error',
        // S-01: ブラウザに渡る名前の環境変数を参照しない（NFR-42）。
        {
          selector:
            "MemberExpression[object.type='MemberExpression'][object.object.name='process'][object.property.name='env'][property.name=/^NEXT_PUBLIC_/]",
          message: ENV_MESSAGE,
        },
        {
          selector:
            "MemberExpression[object.type='MemberExpression'][object.object.name='process'][object.property.name='env'][property.value=/^NEXT_PUBLIC_/]",
          message: ENV_MESSAGE,
        },
        // ADR 0010 の 1・6: script を作らない、イベントハンドラを属性で付けない。
        {
          selector:
            "CallExpression[callee.property.name='createElement'][arguments.0.value='script']",
          message: 'script 要素は作りません（ADR 0010）。',
        },
        {
          selector: "ImportExpression[source.value='next/script']",
          message: 'next/script は使いません（ADR 0010）。',
        },
        {
          selector: "CallExpression[callee.property.name='setAttribute'][arguments.0.value=/^on/i]",
          message: 'イベントハンドラを属性で付けません（ADR 0010）。React の props を使います。',
        },
        // 監査 2026-11-05-build3-review.md M-2: JSX の外から HTML や要素を作る抜け道を塞ぐ。
        {
          selector: "Property[key.name='dangerouslySetInnerHTML']",
          message: HTML_SINK_MESSAGE,
        },
        {
          selector:
            'CallExpression[callee.name=/^(createElement|cloneElement)$/], CallExpression[callee.property.name=/^(createElement|cloneElement)$/]',
          message: '要素は JSX で書きます（ADR 0010）。createElement / cloneElement は使いません。',
        },
        {
          selector: 'CallExpression[callee.property.name=/^setAttribute(NS|Node)?$/]',
          message: '属性は JSX の props で付けます（ADR 0010）。setAttribute は使いません。',
        },
        // ADR 0010 の 3: 値から移動先の URL を作らない（JSX の外の出口）。
        {
          selector:
            "CallExpression[callee.property.name=/^(assign|replace)$/][callee.object.name='location'], CallExpression[callee.property.name=/^(assign|replace)$/][callee.object.property.name='location']",
          message: NAVIGATION_MESSAGE,
        },
        {
          selector: "CallExpression[callee.property.name='open'][callee.object.name='window']",
          message: NAVIGATION_MESSAGE,
        },
        {
          selector: "AssignmentExpression[left.property.name='href']",
          message: NAVIGATION_MESSAGE,
        },
      ],
      // 監査 M-2: DOM 要素へのスプレッドは、dangerouslySetInnerHTML や style の禁止を素通りする。
      // 自前の部品へのスプレッドは許す。
      'react/jsx-props-no-spreading': [
        'error',
        { html: 'enforce', custom: 'ignore', explicitSpread: 'ignore' },
      ],
      // S-02: 公開ビュー（pub_*）以外を読まない。
      'local/pub-from-only': 'error',
      // S-03: CSP の style-src 'self' を保つ（ADR 0008）。SVG 要素も対象。
      'react/forbid-dom-props': ['error', { forbid: ['style'] }],
      'react/no-danger': 'error',
      // S-04: 文言は src/lib/ui-text.ts を経由する。属性値は許す。
      'react/jsx-no-literals': ['error', { noStrings: true, ignoreProps: true }],
      // S-07: 直接のログ出力をしない（NFR-44）。
      'no-console': 'error',
      // ADR 0010 の 1: インラインの script や、別の文書を埋め込む要素を足さない。
      // a は検証つきの部品（src/components/ExternalLink.tsx）と next/link だけが描く。
      'react/forbid-elements': [
        'error',
        {
          forbid: [
            {
              element: 'script',
              message: 'script 要素は足しません（ADR 0010）。JSON-LD も同じです。',
            },
            { element: 'iframe', message: '別の文書を埋め込みません（ADR 0010）。' },
            { element: 'object', message: '別の文書を埋め込みません（ADR 0010）。' },
            { element: 'embed', message: '別の文書を埋め込みません（ADR 0010）。' },
            { element: 'base', message: 'base 要素は足しません（ADR 0010）。' },
            {
              element: 'a',
              message:
                'a 要素は直接書きません。サイト内は next/link、外部は ExternalLink（リンク先を検証する）を使います（06 §7）。',
            },
          ],
        },
      ],
      'no-restricted-imports': ['error', { paths: [NEXT_SCRIPT_IMPORT, REACT_ELEMENT_IMPORT] }],
      // ADR 0010 の 6: JSX の外の出口。
      'no-restricted-properties': [
        'error',
        ...HTML_SINK_PROPERTIES.map((property) => ({ property, message: HTML_SINK_MESSAGE })),
        { object: 'document', property: 'write', message: HTML_SINK_MESSAGE },
        { object: 'document', property: 'writeln', message: HTML_SINK_MESSAGE },
      ],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      // ADR 0010 の 3: javascript: の URL を書かない。
      'no-script-url': 'error',
      'react/jsx-no-script-url': 'error',
    },
  },
  {
    name: 'access-analyzer/no-data-in-client',
    // 監査 L-4: 画面の部品（Client Component）から読み出しの層を import しない。
    // supabase-js と読み出しのコードがブラウザ向けに束ねられるのを防ぐ。
    files: ['src/screens/**', 'src/components/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [NEXT_SCRIPT_IMPORT, REACT_ELEMENT_IMPORT],
          patterns: [
            {
              group: ['@/data', '@/data/*', '**/data/pub/*'],
              message:
                '画面の部品から読み出しの層を import しません。データは page.tsx から props で受けます。',
            },
          ],
        },
      ],
    },
  },
  {
    name: 'access-analyzer/ui-text',
    files: ['src/lib/ui-text.ts'],
    rules: { 'react/jsx-no-literals': 'off' },
  },
  {
    name: 'access-analyzer/tests',
    // テストは、止めたい文字列（javascript: の URL など）を入力のデータとして持つ。
    files: ['tests/**', 'e2e/**'],
    rules: { 'no-script-url': 'off' },
  },
  {
    name: 'access-analyzer/e2e-csp-probe',
    // e2e は、CSP が onclick 属性を止めることを確かめるために、ページの中で要素と属性を作る。
    files: ['e2e/**'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    name: 'access-analyzer/external-link',
    // リンク先を検証してから a を描く、ただ 1 つの部品。
    files: ['src/components/ExternalLink.tsx'],
    rules: {
      'react/forbid-elements': [
        'error',
        { forbid: ['script', 'iframe', 'object', 'embed', 'base'] },
      ],
    },
  },
]);
