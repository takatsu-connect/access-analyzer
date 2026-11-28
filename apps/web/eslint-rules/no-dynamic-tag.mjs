/**
 * 変数に入れたタグ名で、禁止した要素を描けないようにする
 * （ADR 0010 の 1・6、監査 2026-11-05-build3-review.md M-2 の 4、2026-11-09-pre-launch.md L-1）。
 *
 * `const Tag = 'a'` として `<Tag>` と書くと、react/forbid-elements（script、iframe、a など）を
 * 素通りする。JSX の要素名が変数のときは、次のどれかでなければエラーにする。
 *
 * - import した名前、関数宣言、クラス宣言
 * - 関数式、アロー関数、関数の呼び出し（memo など）、クラス式で初期化した const
 * - 禁止した要素の名前になりえない文字列で初期化した const
 *   （文字列リテラル、その条件式、先頭の固定部分が禁止した名前の書き出しと重ならないテンプレート。
 *   見出しの `h${level}` はこれに当たる）
 *
 * 引数や props で受けたタグ名、`<obj.Tag>` の形（obj が import でないもの）は中身が読み取れないので
 * エラーにする。
 */
const DEFAULT_FORBIDDEN = ['script', 'iframe', 'object', 'embed', 'base', 'a'];

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

const COMPONENT_INIT_TYPES = new Set([
  'ArrowFunctionExpression',
  'FunctionExpression',
  'ClassExpression',
  'CallExpression',
]);

/** 初期化の式が、禁止した要素の名前になりえない文字列だと読み取れれば true。 */
function isSafeTagString(rawNode, forbidden) {
  const node = unwrap(rawNode);
  if (!node) return false;
  if (node.type === 'Literal') {
    return typeof node.value === 'string' && !forbidden.includes(node.value.toLowerCase());
  }
  if (node.type === 'ConditionalExpression') {
    return (
      isSafeTagString(node.consequent, forbidden) && isSafeTagString(node.alternate, forbidden)
    );
  }
  if (node.type === 'TemplateLiteral') {
    const head = (node.quasis[0]?.value.cooked ?? '').toLowerCase();
    if (node.expressions.length === 0) return !forbidden.includes(head);
    // 先頭の固定部分で始まる禁止の名前が 1 つもなければ、式が何であっても禁止の名前にならない。
    return head !== '' && !forbidden.some((name) => name.startsWith(head));
  }
  return false;
}

function findVariable(scope, name) {
  for (let current = scope; current; current = current.upper) {
    const variable = current.set.get(name);
    if (variable) return variable;
  }
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
export const noDynamicTag = {
  meta: {
    type: 'problem',
    docs: {
      description: '変数に入れたタグ名で、禁止した要素を描けないようにする',
    },
    schema: [
      {
        type: 'object',
        properties: { forbid: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
    ],
    messages: {
      dynamicTag:
        '要素名「{{name}}」の中身が読み取れません。変数のタグ名は、禁止した要素（script、a など）にならないと分かる文字列だけにします（ADR 0010）。',
    },
  },
  create(context) {
    const forbidden = (context.options[0]?.forbid ?? DEFAULT_FORBIDDEN).map((name) =>
      name.toLowerCase(),
    );

    function isSafeVariable(variable) {
      if (variable.defs.length === 0) return false;
      return variable.defs.every((def) => {
        if (def.type === 'ImportBinding' || def.type === 'FunctionName') return true;
        if (def.type === 'ClassName') return true;
        if (def.type !== 'Variable') return false;
        if (def.parent?.kind !== 'const' || def.name.type !== 'Identifier') return false;
        const init = unwrap(def.node.init);
        if (!init) return false;
        return COMPONENT_INIT_TYPES.has(init.type) || isSafeTagString(init, forbidden);
      });
    }

    return {
      JSXOpeningElement(node) {
        let root = node.name;
        while (root.type === 'JSXMemberExpression') root = root.object;
        if (root.type !== 'JSXIdentifier') return;
        const isMember = node.name.type === 'JSXMemberExpression';
        // 小文字で始まる名前は HTML の要素そのもの（react/forbid-elements が見る）。
        if (!isMember && /^[a-z]/.test(root.name)) return;

        const variable = findVariable(context.sourceCode.getScope(node), root.name);
        // 定義が見つからない名前（グローバル）は、no-undef と型検査に任せる。
        if (variable === null) return;

        const safe = isMember
          ? variable.defs.length > 0 && variable.defs.every((def) => def.type === 'ImportBinding')
          : isSafeVariable(variable);
        if (!safe) {
          context.report({
            node: node.name,
            messageId: 'dynamicTag',
            data: { name: context.sourceCode.getText(node.name) },
          });
        }
      },
    };
  },
};
