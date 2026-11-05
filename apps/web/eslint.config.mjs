/**
 * ESLint の設定（flat config）。07 §7 の S-01〜S-04、S-07、S-12 の BI 側をここで検査する。
 * `next lint` は廃止されたので、ESLint を直接呼ぶ（package.json の lint）。
 */
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

import localRules from './eslint-rules/index.mjs';

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
    name: 'access-analyzer/static-rules',
    files: ['**/*.{js,jsx,mjs,ts,tsx,mts}'],
    plugins: { local: localRules },
    rules: {
      // S-01: ブラウザに渡る名前の環境変数を参照しない（NFR-42）。
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[object.type='MemberExpression'][object.object.name='process'][object.property.name='env'][property.name=/^NEXT_PUBLIC_/]",
          message:
            'NEXT_PUBLIC_ で始まる環境変数は使いません（07 §7 S-01）。値はビルド時にサーバー側で読みます。',
        },
        {
          selector:
            "MemberExpression[object.type='MemberExpression'][object.object.name='process'][object.property.name='env'][property.value=/^NEXT_PUBLIC_/]",
          message:
            'NEXT_PUBLIC_ で始まる環境変数は使いません（07 §7 S-01）。値はビルド時にサーバー側で読みます。',
        },
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
    },
  },
  {
    name: 'access-analyzer/ui-text',
    files: ['src/lib/ui-text.ts'],
    rules: { 'react/jsx-no-literals': 'off' },
  },
]);
