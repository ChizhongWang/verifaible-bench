/**
 * web_fetch tool handler
 */

import { webFetch } from '../api-client.js';

export async function handleWebFetch(args: Record<string, unknown>): Promise<string> {
  const data = await webFetch({ url: args.url as string });

  if (!data.success) return data.message || '获取失败';

  const content = data.content || '';
  const maxLen = 8000;
  const truncated = content.length > maxLen ? content.slice(0, maxLen) + '\n\n... [内容已截断]' : content;
  return `## ${args.url}\n\n${truncated}`;
}
