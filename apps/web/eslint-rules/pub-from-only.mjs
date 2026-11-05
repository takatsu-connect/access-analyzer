/**
 * S-02（docs/design/07_test_plan.md §7、ADR 0006、NFR-43）。
 *
 * - `.from(` の呼び出しは `src/data/pub/` の中だけで使える。
 * - 第 1 引数は `pub_` で始まる文字列リテラルだけ。変数、式、テンプレートリテラルはエラー。
 *
 * 設計どおり、呼び出し元のオブジェクトを区別しない。`Array.from(...)` なども対象になるので、
 * 配列への変換はスプレッド構文（`[...iterable]`）で書く。
 */
import path from 'node:path';

const DEFAULT_ALLOWED_DIR = 'src/data/pub/';
const TABLE_PREFIX = 'pub_';

/** `x.from(...)`、`x?.from(...)`、`x['from'](...)` のいずれかなら true。 */
function isFromCall(node) {
  const callee = node.callee;
  if (callee.type !== 'MemberExpression') return false;
  const property = callee.property;
  if (!callee.computed) {
    return property.type === 'Identifier' && property.name === 'from';
  }
  if (property.type === 'Literal') return property.value === 'from';
  if (property.type === 'TemplateLiteral' && property.expressions.length === 0) {
    return property.quasis[0]?.value.cooked === 'from';
  }
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
export const pubFromOnly = {
  meta: {
    type: 'problem',
    docs: {
      description:
        '`.from(` を src/data/pub/ の中に限り、第 1 引数を pub_ で始まる文字列リテラルに限る',
    },
    schema: [
      {
        type: 'object',
        properties: { allowedDir: { type: 'string' } },
        additionalProperties: false,
      },
    ],
    messages: {
      outsideDataDir:
        '`.from(` を使えるのは {{dir}} の中だけです（07 §7 S-02）。配列への変換はスプレッド構文で書いてください。',
      notPubLiteral:
        '`.from(` の第 1 引数は `pub_` で始まる文字列リテラルだけです。変数や式は渡せません（07 §7 S-02）。',
    },
  },
  create(context) {
    const allowedDir = context.options[0]?.allowedDir ?? DEFAULT_ALLOWED_DIR;
    const relativePath = path.relative(context.cwd, context.filename).replaceAll('\\', '/');
    const inAllowedDir = relativePath.startsWith(allowedDir);

    return {
      CallExpression(node) {
        if (!isFromCall(node)) return;

        if (!inAllowedDir) {
          context.report({ node, messageId: 'outsideDataDir', data: { dir: allowedDir } });
          return;
        }

        const first = node.arguments[0];
        const isPubLiteral =
          first !== undefined &&
          first.type === 'Literal' &&
          typeof first.value === 'string' &&
          first.value.startsWith(TABLE_PREFIX);
        if (!isPubLiteral) {
          context.report({ node: first ?? node, messageId: 'notPubLiteral' });
        }
      },
    };
  },
};
