/**
 * verifaible_web_search tool handler
 */

import { webSearch } from '../api-client.js';
import { truncate } from '../utils.js';

export async function handleWebSearch(args: Record<string, unknown>): Promise<string> {
  const data = await webSearch({
    query: args.query as string,
    max_results: args.max_results as number | undefined,
    search_depth: args.search_depth as 'basic' | 'advanced' | undefined,
    include_answer: args.include_answer as boolean | undefined,
  });

  if (!data.success) return data.message || '搜索失败';

  const lines: string[] = [];

  if (data.answer) {
    lines.push('## 答案摘要', data.answer, '');
  }

  if (data.results?.length) {
    lines.push('## 搜索结果', '');
    for (let i = 0; i < data.results.length; i++) {
      const r = data.results[i];
      lines.push(`### ${i + 1}. ${r.title}`, `链接: ${r.url}`);
      if (r.published_date) lines.push(`发布时间: ${r.published_date}`);
      lines.push('', truncate(r.content, 500), '');
    }
  } else {
    lines.push('未找到相关结果');
  }

  return lines.join('\n');
}
