/**
 * analyze_page tool handler
 */

import { analyzePage } from '../api-client.js';
import { truncate } from '../utils.js';

export async function handleAnalyzePage(args: Record<string, unknown>): Promise<string> {
  const data = await analyzePage({
    url: args.url as string,
    action_steps: args.action_steps as string | undefined,
  });

  // PDF document
  if (data.content_type === 'pdf') {
    const lines: string[] = [`## PDF 文档: ${data.title || args.url}\n`, `总页数: ${data.total_pages}\n`];
    const pages = data.pages as Array<{ page_number: number; text: string }> | undefined;
    if (pages) {
      for (const page of pages) {
        lines.push(`### 第 ${page.page_number} 页`);
        const pageText = page.text.length > 3000 ? page.text.slice(0, 3000) + '\n... [文本已截断]' : page.text;
        lines.push(pageText, '');
      }
    }
    const result = lines.join('\n');
    return result.length > 12000 ? result.slice(0, 12000) + '\n\n... [PDF 内容已截断]' : result;
  }

  // HTML page
  const lines: string[] = [`## 页面分析: ${args.url}\n`];

  // Network requests
  const networkRequests = data.network_requests as Array<Record<string, unknown>> | undefined;
  if (networkRequests?.length) {
    lines.push(`### 网络请求 (${networkRequests.length} 条)`);
    for (const req of networkRequests.slice(0, 20)) {
      lines.push(`- [${req.method || 'GET'}] ${truncate(String(req.url), 120)} (${req.type}, ${req.status})`);
    }
    if (networkRequests.length > 20) lines.push(`  ... 还有 ${networkRequests.length - 20} 条请求`);
    lines.push('');
  }

  // Global objects
  const globalObjects = data.global_objects as Record<string, Record<string, unknown>> | undefined;
  if (globalObjects && Object.keys(globalObjects).length > 0) {
    lines.push(`### 全局对象 (${Object.keys(globalObjects).length} 个)`);
    for (const [name, obj] of Object.entries(globalObjects).slice(0, 15)) {
      lines.push(`**${name}**: ${truncate(JSON.stringify(obj), 300)}`);
    }
    lines.push('');
  }

  // Interactive elements
  const interactiveElements = data.interactive_elements as Array<Record<string, unknown>> | undefined;
  if (interactiveElements?.length) {
    lines.push(`### 交互元素 (${interactiveElements.length} 个)`);
    for (const el of interactiveElements.slice(0, 30)) {
      let desc = `- <${el.tag}`;
      if (el.role) desc += ` role="${el.role}"`;
      desc += '>';
      if (el.text) desc += ` "${truncate(String(el.text), 50)}"`;
      if (el.selector) desc += ` → ${el.selector}`;
      lines.push(desc);
    }
    lines.push('');
  }

  // Tables
  const tables = data.tables as Array<Record<string, unknown>> | undefined;
  if (tables?.length) {
    lines.push(`### 表格 (${tables.length} 个)`);
    for (const table of tables.slice(0, 5)) {
      if (table.title) lines.push(`**${table.title}**`);
      const headers = table.headers as string[] | undefined;
      const rows = table.rows as string[][] | undefined;
      if (headers) lines.push(`列: ${headers.join(' | ')}`);
      if (rows) {
        for (const row of rows.slice(0, 10)) {
          lines.push(`  ${row.join(' | ')}`);
        }
        if (rows.length > 10) lines.push(`  ... 还有 ${rows.length - 10} 行`);
      }
      lines.push('');
    }
  }

  // Accessibility tree
  const accessibilityTree = data.accessibility_tree as string | undefined;
  if (accessibilityTree) {
    lines.push('### Accessibility Tree (摘要)', truncate(accessibilityTree, 2000), '');
  }

  if (lines.length <= 1) {
    return `页面分析无有效内容。URL: ${args.url}`;
  }

  const result = lines.join('\n');
  return result.length > 12000 ? result.slice(0, 12000) + '\n\n... [分析结果已截断]' : result;
}
