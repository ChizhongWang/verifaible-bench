/**
 * verifaible_cite tool handler
 */

import { createEvidence } from '../api-client.js';

export async function handleCite(args: Record<string, unknown>): Promise<string> {
  const data = await createEvidence({
    claim: args.claim as string,
    source_url: args.source_url as string,
    quoted_text: args.quoted_text as string,
    anchor: args.anchor as string,
    source_title: args.source_title as string | undefined,
    action_steps: args.action_steps as string | undefined,
    evidence_type: args.evidence_type as string | undefined,
    table_selector: args.table_selector as string | undefined,
    row_anchor: args.row_anchor as string | undefined,
    col_anchor: args.col_anchor as string | undefined,
    element_selector: args.element_selector as string | undefined,
    element_alt: args.element_alt as string | undefined,
    page_number: args.page_number as number | undefined,
  });

  let result = `引用已创建 (user_seq=${data.user_seq})。在回答中使用 [@v:${data.user_seq}] 标记此引用。`;
  if (data.screenshot_url) {
    result += `\n预览截图: ${data.screenshot_url}`;
  }
  return result;
}
