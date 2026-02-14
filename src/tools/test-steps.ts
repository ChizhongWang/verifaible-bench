/**
 * test_action_steps tool handler
 */

import { testActionSteps } from '../api-client.js';

export async function handleTestSteps(args: Record<string, unknown>): Promise<string> {
  const data = await testActionSteps({
    url: args.url as string,
    action_steps: args.action_steps as string,
    verify_type: (args.verify_type as 'text' | 'table' | 'image') ?? 'text',
    anchor: args.anchor as string | undefined,
    row_anchor: args.row_anchor as string | undefined,
    element_selector: args.element_selector as string | undefined,
    element_alt: args.element_alt as string | undefined,
  });

  const lines: string[] = ['## Action Steps 测试结果\n'];
  lines.push(`**页面标题**: ${data.page_title || '(无)'}`);

  // Step errors
  const stepErrors = data.step_errors as string[] | undefined;
  if (stepErrors?.length) {
    lines.push(`\n**步骤错误** (${stepErrors.length} 个):`);
    for (const err of stepErrors) lines.push(`  - ${err}`);
  } else {
    lines.push('\n所有步骤执行成功');
  }

  // exec_js results
  const execResults = data.exec_results as Array<{ step: number; result: string }> | undefined;
  if (execResults?.length) {
    lines.push('\n### exec_js 返回值');
    for (const { step, result: val } of execResults) {
      lines.push(`**Step ${step}**:\n\`\`\`\n${val}\n\`\`\``);
    }
  }

  const verifyType = (args.verify_type as string) || 'text';

  // text mode
  if (verifyType === 'text') {
    const found = data.anchor_found as boolean;
    lines.push(`\n**锚点搜索**: ${found ? '找到' : '未找到'}`);
    if (found && data.anchor_context) lines.push(`**上下文**: ${data.anchor_context}`);
  }

  // table mode
  if (verifyType === 'table') {
    const tables = data.tables as Array<{ headers?: string[]; rows?: string[][] }> | undefined;
    if (tables?.length) {
      lines.push(`\n### 表格数据 (${tables.length} 个)`);
      for (const table of tables) {
        if (table.headers?.length) lines.push(`列: ${table.headers.join(' | ')}`);
        if (table.rows) {
          for (const row of table.rows.slice(0, 15)) lines.push(`  ${row.join(' | ')}`);
          if (table.rows.length > 15) lines.push(`  ... 还有 ${table.rows.length - 15} 行`);
        }
        lines.push('');
      }
    } else {
      lines.push('\n未找到表格数据');
    }
    const matchedRow = data.matched_row as string[] | undefined;
    if (matchedRow) {
      lines.push(`**匹配行**: ${matchedRow.join(' | ')}`);
    } else if (args.row_anchor) {
      lines.push(`**匹配行**: 未找到包含 "${args.row_anchor}" 的行`);
    }
  }

  // image mode
  if (verifyType === 'image') {
    const found = data.element_found as boolean;
    lines.push(`\n**元素查找**: ${found ? '找到' : '未找到'}`);
    if (found && data.element_info) {
      const info = data.element_info as Record<string, unknown>;
      lines.push(`  标签: ${info.tag}, alt: ${info.alt || '(无)'}`);
      lines.push(`  尺寸: ${info.width}x${info.height}, 可见: ${info.visible ? '是' : '否'}`);
    }
  }

  return lines.join('\n');
}
