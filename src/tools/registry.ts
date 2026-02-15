/**
 * Tool Registry — schema definitions + handler dispatch
 */

import type { ToolDefinition } from '../openrouter.js';
import { handleWebSearch } from './web-search.js';
import { handleWebFetch } from './web-fetch.js';
import { handleAnalyzePage } from './analyze-page.js';
import { handleTestSteps } from './test-steps.js';
import { handleCite } from './cite.js';
import { handleVideoTranscript } from './video-transcript.js';

export interface ToolHandler {
  (args: Record<string, unknown>): Promise<string>;
}

interface ToolEntry {
  definition: ToolDefinition;
  handler: ToolHandler;
}

const registry: Record<string, ToolEntry> = {};

function register(def: ToolDefinition, handler: ToolHandler) {
  registry[def.name] = { definition: def, handler };
}

// ─── Register all tools ───────────────────────────────────────

register(
  {
    type: 'function',
    name: 'verifaible_web_search',
    description:
      '搜索互联网获取最新信息。适用：查找新闻/数据/事件、确认事实、寻找来源网站。搜索后用 verifaible_cite 创建可验证引用。动态网页请配合 analyze_page。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索查询词' },
        max_results: { type: 'number', description: '返回结果数量（默认 5，最大 10）' },
        search_depth: {
          type: 'string',
          enum: ['basic', 'advanced'],
          description: '搜索深度：basic（快速）或 advanced（更全面）',
        },
        include_answer: { type: 'boolean', description: '是否包含 AI 生成的答案摘要' },
      },
      required: ['query'],
    },
  },
  handleWebSearch,
);

register(
  {
    type: 'function',
    name: 'web_fetch',
    description:
      '获取指定 URL 的静态文本内容（Markdown 格式）。适用：读取文章、博客、文档的文字内容。注意：JS 动态加载的内容请用 analyze_page。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '要获取的网页 URL' },
      },
      required: ['url'],
    },
  },
  handleWebFetch,
);

register(
  {
    type: 'function',
    name: 'analyze_page',
    description:
      '深度分析网页，返回网络请求、全局 JS 对象（含方法源码）、交互元素、表格数据、accessibility tree。适用：动态网页（金融行情、政府数据平台等需要 JS 渲染的页面）。工作流：先 analyze_page 了解页面结构 → 构建 action_steps → 用 verifaible_cite 创建引用。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '要分析的网页 URL' },
        action_steps: {
          type: 'string',
          description: '可选的 action_steps JSON 字符串，在分析前先回放这些操作',
        },
      },
      required: ['url'],
    },
  },
  handleAnalyzePage,
);

register(
  {
    type: 'function',
    name: 'test_action_steps',
    description: `轻量验证 action_steps 的执行结果（纯文本，无截图，用于快速迭代）。
两种用法：
A. 探查模式：用 exec_js 读取函数源码或检查页面状态。
B. 验证模式：执行操作后通过 verify_type 检查结果。
返回：page_title + step_errors + exec_js 返回值 + 验证数据。
verify_type 说明：
- "text": 在页面全文中搜索 anchor
- "table": 提取所有表格数据
- "image": 查找目标元素`,
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '目标网页 URL' },
        action_steps: { type: 'string', description: '要测试的 action_steps JSON 字符串' },
        verify_type: {
          type: 'string',
          enum: ['text', 'table', 'image'],
          description: '验证类型：text=搜索文本, table=提取表格, image=查找元素',
        },
        anchor: { type: 'string', description: '要搜索的文本（text 模式）' },
        row_anchor: { type: 'string', description: '表格行定位文本（table 模式）' },
        element_selector: { type: 'string', description: 'CSS 选择器（image 模式）' },
        element_alt: { type: 'string', description: '图片 alt / 视频 title 匹配文本（image 模式）' },
      },
      required: ['url', 'action_steps'],
    },
  },
  handleTestSteps,
);

register(
  {
    type: 'function',
    name: 'video_transcript',
    description:
      '获取 YouTube 视频的字幕文本（带时间戳）。返回格式：[m:ss] 字幕文本。适用：从视频中提取信息作为证据。工作流：先用 web_search 找到视频 URL → video_transcript 获取字幕 → verifaible_cite 创建引用。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'YouTube 视频 URL' },
      },
      required: ['url'],
    },
  },
  handleVideoTranscript,
);

register(
  {
    type: 'function',
    name: 'verifaible_cite',
    description: `为论点创建可验证引用，返回 user_seq 用于标记 [@v:user_seq]。
静态页面：提供 source_url + quoted_text + anchor。
动态页面：先 analyze_page 探索，再提供 action_steps。
表格：evidence_type="table"，用 row_anchor × col_anchor 控制高亮。
图片/视频：evidence_type="image"/"video" + element_selector。
PDF：evidence_type="pdf" + page_number。`,
    parameters: {
      type: 'object',
      properties: {
        claim: { type: 'string', description: '论点：回答中的具体结论/陈述' },
        source_url: { type: 'string', description: '来源网页 URL' },
        quoted_text: { type: 'string', description: '原文引用片段，必须逐字引用' },
        anchor: { type: 'string', description: '定位锚点（3-20字符）' },
        source_title: { type: 'string', description: '来源网页标题' },
        action_steps: { type: 'string', description: '动作序列 JSON 字符串（动态网页回放）' },
        evidence_type: {
          type: 'string',
          enum: ['text', 'table', 'image', 'video', 'pdf'],
          description: '证据类型（默认 text）',
        },
        table_selector: { type: 'string', description: '表格 CSS selector' },
        row_anchor: { type: 'string', description: '行定位文本（或 JSON 数组字符串用于多行）' },
        col_anchor: { type: 'string', description: '列定位文本（或 JSON 数组字符串用于多列）' },
        element_selector: { type: 'string', description: '目标元素 CSS selector' },
        element_alt: { type: 'string', description: '图片 alt 或视频标题' },
        page_number: { type: 'number', description: 'PDF 页码（1-indexed）' },
        timestamp: { type: 'number', description: '视频时间戳（秒），用于截图跳转到对应时间点' },
        video_id: { type: 'string', description: '视频 ID（如 YouTube video ID）' },
      },
      required: ['claim', 'source_url', 'quoted_text', 'anchor'],
    },
  },
  handleCite,
);

// ─── Exports ──────────────────────────────────────────────────

export function getToolDefinitions(): ToolDefinition[] {
  return Object.values(registry).map((e) => e.definition);
}

export function getHandler(name: string): ToolHandler | undefined {
  return registry[name]?.handler;
}

export function getToolNames(): string[] {
  return Object.keys(registry);
}
