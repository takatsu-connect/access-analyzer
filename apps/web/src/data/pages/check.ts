/**
 * ページのデータを zod のスキーマで確かめる（04 §4、U-21）。
 *
 * zod の例外の文面には、行の値（記事の題名や著者の名前）が入りうる。ビルドのログに行データを
 * 出さないため（.claude/rules/security.md「ログに出すのは件数、所要時間、エラーの種別まで」、
 * 監査 2026-11-05-build3-review.md L-5）、失敗したときはスキーマの名前と、合わなかった項目の
 * 数だけを持つ固定の文の例外にする。読み出しの層（pub/load.ts）と同じ扱い。
 */
import type { z } from 'zod';

export class PageDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PageDataError';
  }
}

export function checkPage<Schema extends z.ZodType>(
  schema: Schema,
  data: unknown,
  name: string,
): z.infer<Schema> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new PageDataError(
      `ページのデータが ${name} に合いません（${result.error.issues.length} 項目）`,
    );
  }
  return result.data;
}
