/**
 * next/link の href を、サイト内のパスだと読み取れる形に限る
 * （ADR 0010 の 3・6、監査 2026-11-09-pre-launch.md L-1）。
 *
 * next/link は a 要素を描くので、データ由来の値を href に渡すと、リンク先を検証する
 * ExternalLink を素通りして外部へのリンクが作れる。許すのは次の形だけ。
 *
 * - 「/」1 つか「#」で始まる文字列リテラル
 * - 先頭の固定部分が「/」+ 1 文字以上（2 文字目は「/」「\」以外）か「#」で始まるテンプレートリテラル
 *   （`/${x}` は、x が「/host」のとき別のサイトになるので許さない）
 * - `internalPath(...)` の呼び出し（src/lib/derive/links.ts。実行時に確かめ直す）
 * - 上のいずれかを `pathname` に持つオブジェクト（スプレッドなし）
 */
const LITERAL_PATTERN = /^(?:\/(?![/\\])|#)/;
const TEMPLATE_HEAD_PATTERN = /^(?:\/[^/\\]|#)/;
const VALIDATOR_NAME = 'internalPath';

/** TypeScript の `as` と `satisfies` と括弧を外す。 */
function unwrap(node) {
  let current = node;
  while (
    current &&
    (current.type === 'TSAsExpression' ||
      current.type === 'TSSatisfiesExpression' ||
      current.type === 'TSNonNullExpression')
  ) {
    current = current.expression;
  }
  return current;
}

function isSafePath(rawNode) {
  const node = unwrap(rawNode);
  if (!node) return false;
  if (node.type === 'Literal') {
    return typeof node.value === 'string' && LITERAL_PATTERN.test(node.value);
  }
  if (node.type === 'TemplateLiteral') {
    const head = node.quasis[0]?.value.cooked ?? '';
    return node.expressions.length === 0
      ? LITERAL_PATTERN.test(head)
      : TEMPLATE_HEAD_PATTERN.test(head);
  }
  if (node.type === 'CallExpression') {
    return node.callee.type === 'Identifier' && node.callee.name === VALIDATOR_NAME;
  }
  return false;
}

function isSafeHref(rawNode) {
  const node = unwrap(rawNode);
  if (!node) return false;
  if (node.type !== 'ObjectExpression') return isSafePath(node);
  let pathname = null;
  for (const property of node.properties) {
    if (property.type !== 'Property' || property.computed) return false;
    const key = property.key.type === 'Identifier' ? property.key.name : property.key.value;
    if (key === 'pathname') pathname = property.value;
  }
  return pathname !== null && isSafePath(pathname);
}

/** @type {import('eslint').Rule.RuleModule} */
export const internalLinkHref = {
  meta: {
    type: 'problem',
    docs: {
      description: 'next/link の href を、サイト内のパスだと読み取れる形に限る',
    },
    schema: [],
    messages: {
      notInternal:
        'next/link の href は、「/」か「#」で始まる文字列、または internalPath(...) を通した値だけです（ADR 0010 の 3）。外部へのリンクは ExternalLink を使います。',
    },
  },
  create(context) {
    /** next/link から import した名前（既定の import と、名前を付け替えた import）。 */
    const linkNames = new Set();

    return {
      ImportDeclaration(node) {
        if (node.source.value !== 'next/link') return;
        for (const specifier of node.specifiers) linkNames.add(specifier.local.name);
      },
      JSXOpeningElement(node) {
        if (node.name.type !== 'JSXIdentifier' || !linkNames.has(node.name.name)) return;
        for (const attribute of node.attributes) {
          if (attribute.type === 'JSXSpreadAttribute') {
            context.report({ node: attribute, messageId: 'notInternal' });
            continue;
          }
          if (attribute.name.type !== 'JSXIdentifier' || attribute.name.name !== 'href') continue;
          const value = attribute.value;
          const expression =
            value?.type === 'JSXExpressionContainer' ? value.expression : (value ?? null);
          if (!isSafeHref(expression)) {
            context.report({ node: attribute, messageId: 'notInternal' });
          }
        }
      },
    };
  },
};
