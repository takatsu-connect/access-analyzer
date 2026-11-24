/**
 * このプロジェクトだけの ESLint 規則（プラグイン名 `local`）。
 */
import { internalLinkHref } from './internal-link-href.mjs';
import { noDynamicTag } from './no-dynamic-tag.mjs';
import { pubFromOnly } from './pub-from-only.mjs';

const localRules = {
  meta: { name: 'local' },
  rules: {
    'internal-link-href': internalLinkHref,
    'no-dynamic-tag': noDynamicTag,
    'pub-from-only': pubFromOnly,
  },
};

export default localRules;
