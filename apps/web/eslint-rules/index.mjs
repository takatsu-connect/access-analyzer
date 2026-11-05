/**
 * このプロジェクトだけの ESLint 規則（プラグイン名 `local`）。
 */
import { pubFromOnly } from './pub-from-only.mjs';

const localRules = {
  meta: { name: 'local' },
  rules: {
    'pub-from-only': pubFromOnly,
  },
};

export default localRules;
