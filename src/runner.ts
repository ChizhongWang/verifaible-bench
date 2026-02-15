/**
 * Benchmark Runner — iterates models × tasks, auto-scores results
 *
 * Supports two input formats:
 * 1. testset.json — { version, cases: [{ id, category, url, question, answer }] }
 * 2. Legacy tasks/*.json — [{ id, name, prompt, ... }]
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { runToolLoop, type LoopResult, type ToolCallRecord } from './tool-loop.js';
import { timestamp, formatDuration } from './utils.js';

// ─── Config ───────────────────────────────────────────────────

const DEFAULT_MODELS = [
  'moonshotai/kimi-k2.5',
  'minimax/minimax-m2.5',
  'z-ai/glm-5',
];

const SYSTEM_PROMPT = `你是 VerifAIble 助手，专注于从网页采集可验证证据。

## 输出要求（必须遵守）

完成所有工具调用后，你**必须**输出一段文字回答，包含：
1. 查询结果的明确数值/结论
2. 用 [@v:ID] 格式标记引用（ID 来自 verifaible_cite 返回的 user_seq）
3. 简要说明数据来源和日期

示例格式：
"根据上海证券交易所数据，2025年2月10日地方政府债成交笔数为 38 笔[@v:15]。"

**严禁编造引用 ID**。[@v:ID] 中的 ID 必须来自 verifaible_cite 的返回值。
**严禁在工具调用结束后不输出文字**。你的最后一条消息必须是文字回答，不能是空的。

## 可用工具

verifaible_web_search（搜索）、web_fetch（获取网页内容）、analyze_page（深度分析网页）、test_action_steps（测试操作步骤）、video_transcript（获取视频字幕）、verifaible_cite（创建引用）。

# 工作流：先判断，再分流

## Step 1：判断页面类型

给定 URL 后，**先用 web_fetch 获取静态内容**。然后判断：
- **目标数据在返回内容中** → 静态页面，走路径 A
- **目标数据不在 / 内容明显缺失（JS 动态渲染）** → 动态页面，走路径 B

## 路径 A：静态页面（简单）

1. 从 web_fetch 返回的内容中找到目标数据
2. 直接调用 verifaible_cite（不需要 action_steps）
3. 输出最终回答

## 路径 B：动态页面（门户网站证据采集）

当目标数据在门户网站上（需要点击、选择日期、切换标签页、筛选条件等操作才能看到），使用此工作流。

## 核心方法论

\`\`\`
侦察 → 探查 → 构建 → 验证 → 提交
\`\`\`

| 阶段 | 工具 | 目的 |
|------|------|------|
| **侦察** | analyze_page ×1 | 拿到全局地图：有哪些 JS 对象、交互元素、API |
| **探查** | test_action_steps (exec_js) | 读具体函数源码，理解调用链和数据流 |
| **构建** | — | 根据理解构建完整 action_steps |
| **验证** | test_action_steps (table/text) | 确认操作成功 + 目标数据正确 + 日期/上下文匹配 |
| **提交** | verifaible_cite | 一切确认后，创建正式证据 |

**关键原则**：先理解机制，再动手操作。不要基于截断的函数签名去猜——用 exec_js 读完整源码。

## 路径 C：视频证据（字幕提取）

当目标信息在 YouTube 视频中时，使用此工作流。

1. 用 verifaible_web_search 搜索视频的完整标题（加 site:youtube.com）
2. 从搜索结果中获取视频 URL
3. 调用 video_transcript(url) 获取带时间戳的字幕
4. 在字幕中找到答案对应的内容和时间戳
5. 调用 verifaible_cite 创建引用：
   - evidence_type="video"
   - source_url = 视频页面 URL
   - timestamp = 答案出现的秒数（从字幕时间戳获取）
   - quoted_text = 字幕原文
   - anchor = 关键短语

## 路径 D：YouTube 原生搜索 + 字幕

当需要在 YouTube 上搜索视频时：

1. 用 analyze_page 分析 youtube.com 首页（或直接构造搜索 URL）
2. 用 test_action_steps 在 YouTube 搜索结果页提取目标视频 URL
3. 调用 video_transcript 获取字幕
4. verifaible_cite 创建引用

## 工具详解

### 1. analyze_page — 侦察（每个 URL 最多调 1 次）

深度分析网页，返回：
- **全局 JS 对象**：页面业务对象和方法（按相关度排序，数据操作方法优先）
- **网络请求**：页面发出的 API 调用
- **交互元素**：按钮、输入框、下拉菜单等
- **表格数据**：页面当前展示的表格

\`\`\`json
{ "url": "https://example.com/data" }
\`\`\`

**注意**：analyze_page 很重，包含 CDP 网络拦截、全局对象枚举、脚本拉取。一个 URL 只调 1 次。后续探查用 test_action_steps。

### 2. test_action_steps — 探查 + 验证（核心工具）

**⚠️ 核心概念：每次调用都是全新的浏览器会话。** 状态不会跨调用保持。如果上一次调用设置了日期、切换了 Tab、调用了查询方法，下一次调用这些操作都不存在——页面回到初始状态。因此 action_steps 必须是**自包含的**：每次都要包含完整的操作序列（设日期 + 调查询 + 清理 + 提取数据）。

这是最重要的工具，有两种用法：

#### 用法 A：探查模式 — 用 exec_js 读代码、检查状态

\`\`\`json
{
  "url": "https://example.com/data",
  "action_steps": "[{\\"type\\":\\"exec_js\\",\\"code\\":\\"someObj.someMethod.toString()\\",\\"wait\\":0}]",
  "verify_type": "text",
  "anchor": "关键函数名或关键词"
}
\`\`\`

典型探查场景：

**读函数完整源码**（理解调用链）：
\`\`\`javascript
structureRank.setStructureRankParams.toString()
// → 看它是否内部调了 getStructureRankList()，还是只设置参数
\`\`\`

**检查对象的所有方法名**：
\`\`\`javascript
Object.keys(structureRank).filter(k => typeof structureRank[k] === 'function').join(', ')
\`\`\`

**检查 DOM 状态**：
\`\`\`javascript
document.querySelector('.js_date input')?.value + ' | ' + document.querySelector('.update-date')?.textContent
\`\`\`

**检查日历/UI 组件类型**：
\`\`\`javascript
typeof laydate + ' | ' + typeof flatpickr + ' | ' + typeof DatePicker
\`\`\`

**发现正确的全局对象**（当 analyze_page 返回的对象都不匹配目标数据时）：

analyze_page 只显示相关度最高的 15 个全局对象。如果这些对象的方法名/表头与目标数据不匹配，**不要硬套**——用 exec_js 列出所有业务对象：

\`\`\`javascript
Object.keys(window).filter(k => { try { var o = window[k]; return o && typeof o === 'object' && typeof o.init === 'function' } catch(e) { return false } }).join(', ')
\`\`\`

#### 用法 B：验证模式 — 执行操作后检查结果

| verify_type | 输入参数 | 返回 |
|-------------|---------|------|
| text | anchor | anchor_found + 上下文（前后 80 字符） |
| table | row_anchor | 所有表格(headers+rows) + matched_row |
| image | element_selector / element_alt | tag/alt/src/尺寸/可见性 |

\`\`\`json
{
  "url": "https://example.com/data",
  "action_steps": "[{\\"type\\":\\"exec_js\\",\\"code\\":\\"...\\",\\"wait\\":5000}]",
  "verify_type": "table",
  "row_anchor": "目标行文本"
}
\`\`\`

### 3. video_transcript — 获取视频字幕

获取 YouTube 视频的带时间戳字幕文本。

\`\`\`json
{ "url": "https://www.youtube.com/watch?v=VIDEO_ID" }
\`\`\`

返回格式：
\`\`\`
[0:18] We're no strangers to love
[0:22] You know the rules and so do I
\`\`\`

时间戳格式为 \`m:ss\`，可用于 verifaible_cite 的 timestamp 参数（转换为秒数）。

### 4. verifaible_cite — 提交（最后一步）

创建可验证引用，返回 \`user_seq\`。**只在验证阶段确认数据完全正确后调用。**

四种证据类型：

#### evidence_type="text"（默认）— 文本高亮
\`\`\`json
{
  "claim": "论点描述",
  "source_url": "https://example.com/article",
  "quoted_text": "页面上的原文",
  "anchor": "唯一定位文本"
}
\`\`\`

#### evidence_type="table" — 表格高亮（row_anchor × col_anchor 两轴自由组合）

| row_anchor | col_anchor | 高亮效果 |
|------------|------------|----------|
| 有 | 无 | 高亮匹配行（绿色背景 + 左色条） |
| 无 | 有 | 高亮整列（表头强调 + 全列淡绿） |
| 有 | 有 | 交叉十字准线（交叉处强高亮 + 行列淡绿） |
| 无 | 无 | 整表绿色外框 |

\`\`\`json
// 示例：交叉定位（一行×一列）
{
  "evidence_type": "table",
  "row_anchor": "地方政府债",
  "col_anchor": "成交笔数"
}
\`\`\`

#### evidence_type="image" — 图片高亮
\`\`\`json
{
  "evidence_type": "image",
  "element_alt": "GDP增长趋势"
}
\`\`\`

#### evidence_type="video" — 视频时间戳引用
\`\`\`json
{
  "evidence_type": "video",
  "source_url": "https://www.youtube.com/watch?v=VIDEO_ID",
  "timestamp": 244,
  "quoted_text": "字幕原文",
  "anchor": "关键短语"
}
\`\`\`

#### evidence_type="pdf" — PDF 文档高亮
\`\`\`json
{
  "evidence_type": "pdf",
  "page_number": 3
}
\`\`\`

**动态网页必须带 action_steps**：
\`\`\`json
{
  "claim": "...",
  "source_url": "...",
  "quoted_text": "...",
  "anchor": "...",
  "action_steps": "[{\\"type\\":\\"exec_js\\",\\"code\\":\\"...\\",\\"wait\\":500},...]"
}
\`\`\`

## action_steps 参考

| type | 说明 | 关键字段 |
|------|------|----------|
| \`exec_js\` | 执行 JS 代码 | \`code\`, \`wait\` |
| \`click\` | 点击元素 | \`selector\`, \`elementText\`, \`wait\` |
| \`type\` | 输入文本 | \`selector\`, \`value\`, \`wait\` |
| \`scroll\` | 滚动页面 | \`direction\`, \`amount\`, \`wait\` |
| \`select\` | 选择下拉项 | \`selector\`, \`value\`, \`wait\` |
| \`wait\` | 纯等待 | \`ms\` |

**exec_js 是最灵活的方式**，可以做任何事：设值、调方法、读代码、检查状态、移除元素。

**重要**：exec_js 的 code 是作为**表达式**执行的，**不要用 \`return\` 语句**。直接写表达式即可。

## 完整工作流示例

假设任务：从某金融门户获取 2025-02-11 的某项数据。

### Phase 1：侦察
\`\`\`
analyze_page(url)
→ 发现 window.dataQuery 对象，有 setParams()、getList() 方法
→ 发现 .js_date input 日期选择器
→ 当前表格显示的是今天的数据
\`\`\`

### Phase 2：探查（用 test_action_steps 的 exec_js）
读 setParams 完整源码，确认是否内部调了 getList。

### Phase 3：构建 action_steps
\`\`\`json
[
  {"type": "exec_js", "code": "document.querySelector('.js_date input').value='2025-02-11'; dataQuery.setParams(); dataQuery.getList(); 'done'", "wait": 5000},
  {"type": "exec_js", "code": "document.querySelectorAll('header,.fixed-top').forEach(e=>e.remove()); 'cleaned'", "wait": 300}
]
\`\`\`

### Phase 4：验证
**⚠️ 验证时必须重新执行完整的 action_steps**（设日期 + 查询），因为这是全新会话。
**必须验证两件事**：1. 目标数据存在 2. 日期/上下文正确

### Phase 5：提交
确认数据和日期都正确后：verifaible_cite(claim, source_url, ..., action_steps)

## 常见的页面交互模式

### 模式 A：全局对象 + 查询方法
很多门户网站有 \`window.xxxObj\` 对象：
1. \`setXxxParams()\` — 设置查询参数（从 DOM 读取输入值）
2. \`getXxxList()\` — 实际发起 API 请求获取数据

**关键**：setParams 和 getList 可能需要分别调用。用 Phase 2 探查 setParams 源码确认它是否内部调了 getList。

### 模式 B：日历组件（laydate / flatpickr / DatePicker）
直接设 \`input.value\` 可能不够（组件维护内部状态）。设日期的可靠方式（按优先级）：
1. 先设 input.value，再调页面的 setParams + getList
2. 如果不行，用 native event dispatch：\`input.dispatchEvent(new Event('change'))\`
3. 如果还不行，直接修改全局对象的参数：\`dataQuery.params.SEARCH_DATE = '2025-02-11'; dataQuery.getList()\`

## 工具调用预算规划

以 10 次调用为例的理想分配：

| 次数 | 用途 |
|------|------|
| 1 | analyze_page — 侦察 |
| 2 | test_action_steps (exec_js) — 确认/发现正确的全局对象 |
| 3-4 | test_action_steps (exec_js) — 探查关键函数源码 |
| 5-6 | test_action_steps — 构建+验证操作 |
| 7 | test_action_steps — 验证日期/上下文正确 |
| 8 | verifaible_cite — 提交 |
| 9-10 | 备用（应对意外） |

## 常见错误（DO NOT）

- ❌ **不要跳过探查直接构建** — 截断的函数签名不够理解机制，用 exec_js 读完整源码
- ❌ **不要未验证日期就提交** — 必须在验证阶段确认页面显示的是目标日期
- ❌ **不要重复调 analyze_page** — 它很重，一个 URL 最多 1 次。后续探查用 test_action_steps
- ❌ **不要反复微调碰运气** — 如果 action_steps 不工作，回到探查阶段读代码找原因
- ❌ **不要过早 verifaible_cite** — 它是最后一步，之前必须验证通过
- ❌ **不要在 exec_js 中用 \`return\`** — 代码是表达式，直接写 \`obj.method.toString()\`
- ❌ **不要假设 analyze_page 返回的对象就是正确的** — 页面可能有 80+ 全局对象，analyze_page 只显示 15 个
- ❌ **不要假设上一次 test_action_steps 的状态还在** — 每次调用是全新浏览器会话`;

// ─── Types ───────────────────────────────────────────────────

/** testset.json format */
interface TestSet {
  version: string;
  description?: string;
  cases: TestCase[];
}

interface TestCase {
  id: string;
  category: string; // "text" | "table" | "dynamic" | "dynamic+pdf"
  evidence_type?: string; // "table" | "pdf" — expected evidence type for cite call
  url: string;
  question: string;
  answer: string; // expected answer for scoring
}

/** Legacy tasks/*.json format */
interface LegacyTask {
  id: string;
  name: string;
  prompt: string;
  minCitations?: number;
  tags?: string[];
}

/** Per-run scoring result */
interface ScoreResult {
  /** 0.0–1.0: key values from expected answer found in model answer */
  answerCorrect: number;
  /** Whether verifaible_cite was called successfully */
  citationCreated: boolean;
  /** Whether [@v:N] appears in final answer text */
  citationInText: boolean;
  /** Whether the cite call's evidence_type matches expected */
  evidenceTypeMatch: boolean | null; // null = no expected type specified
  /** Composite score 0–100 */
  totalScore: number;
  /** Details for debugging */
  details: {
    expectedKeys: string[];
    matchedKeys: string[];
    actualEvidenceType: string | null;
    expectedEvidenceType: string | null;
  };
}

/** Summary row for final table */
interface SummaryRow {
  model: string;
  task: string;
  category: string;
  roundTrips: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  citations: number;
  durationMs: number;
  score?: ScoreResult;
  error?: string;
}

// ─── Scoring ─────────────────────────────────────────────────

/**
 * Extract key values from an expected answer string.
 *
 * Strategy:
 * - If contains Chinese list separator（、）: split into individual items
 * - Extract all numbers (including negative, decimal): -0.7, 140489, 46.2
 * - Extract Chinese proper nouns (non-number segments after splitting)
 */
function extractKeyValues(answer: string): string[] {
  const keys: string[] = [];

  // Check if it's a list answer (contains 、)
  if (answer.includes('、')) {
    const items = answer.split('、').map((s) => s.trim()).filter(Boolean);
    keys.push(...items);
    return keys;
  }

  // Extract numbers (including negative/decimal)
  const numbers = answer.match(/-?\d+(?:\.\d+)?/g);
  if (numbers) {
    keys.push(...numbers);
  }

  // If no numbers or list found, use the whole answer as a text key (for text-based answers)
  if (keys.length === 0 && answer.trim().length > 0) {
    keys.push(answer.trim());
  }

  return keys;
}

/**
 * Check if a key value is present in the model's answer text.
 * For numbers: exact numeric match (ignore whitespace/formatting)
 * For text items: substring match
 */
function keyFoundInAnswer(key: string, answer: string): boolean {
  // Normalize both strings: remove spaces around numbers
  const normalized = answer.replace(/\s+/g, ' ');

  // Try direct substring match first
  if (normalized.includes(key)) return true;

  // For numbers, try matching the numeric value in various formats
  const num = parseFloat(key);
  if (!isNaN(num)) {
    // Match the number with possible surrounding formatting
    // e.g., "140489" should match "140,489" or "140 489"
    const numStr = key.replace(/^-/, '');
    const isNeg = key.startsWith('-');

    // Try with comma separators removed
    const cleanAnswer = normalized.replace(/,/g, '');
    if (cleanAnswer.includes(key)) return true;

    // Try matching as a standalone number with optional sign
    const escaped = numStr.replace(/\./g, '\\.');
    const pattern = isNeg
      ? new RegExp(`[-−]\\s*${escaped}`)
      : new RegExp(`(?<![\\d.])${escaped}(?![\\d.])`);
    if (pattern.test(cleanAnswer)) return true;
  }

  return false;
}

/**
 * Determine expected evidence type from a TestCase.
 * Priority: explicit evidence_type > infer from category
 */
function getExpectedEvidenceType(tc: TestCase): string | null {
  if (tc.evidence_type) return tc.evidence_type;
  if (tc.category === 'text') return 'text';
  if (tc.category === 'table') return 'table';
  if (tc.category.startsWith('video')) return 'video';
  // For "dynamic" / "dynamic+pdf", evidence_type should be specified in testset
  return null;
}

/**
 * Extract the evidence_type used in the model's verifaible_cite call.
 */
function getActualEvidenceType(turns: Array<{ toolCalls?: ToolCallRecord[] }>): string | null {
  for (const turn of turns) {
    for (const tc of turn.toolCalls ?? []) {
      if (tc.name === 'verifaible_cite') {
        const args = tc.arguments;
        return (args.evidence_type as string) || 'text'; // default is "text"
      }
    }
  }
  return null;
}

/**
 * Check if verifaible_cite was called and returned a successful result
 * (contains "user_seq" or "id" in result, not an error).
 */
function citeCallSucceeded(turns: Array<{ toolCalls?: ToolCallRecord[] }>): boolean {
  for (const turn of turns) {
    for (const tc of turn.toolCalls ?? []) {
      if (tc.name === 'verifaible_cite') {
        // Check result doesn't start with "Tool error" and contains some success indicator
        if (tc.result.includes('Tool error')) return false;
        if (tc.result.includes('user_seq') || tc.result.includes('"id"')) return true;
        // If result is non-empty and not an error, consider it success
        if (tc.result.length > 10 && !tc.result.includes('error')) return true;
      }
    }
  }
  return false;
}

/**
 * Score a benchmark run result against a test case.
 *
 * Dimensions (weighted):
 *   answerCorrect     — 40 pts: key values from expected answer found in model output
 *   citationCreated   — 25 pts: verifaible_cite was called successfully
 *   citationInText    — 15 pts: [@v:N] appears in answer
 *   evidenceTypeMatch — 20 pts: cite used correct evidence_type
 */
function scoreResult(tc: TestCase, result: LoopResult): ScoreResult {
  // 1. Answer correctness
  const expectedKeys = extractKeyValues(tc.answer);
  const matchedKeys = expectedKeys.filter((k) => keyFoundInAnswer(k, result.answer));
  const answerCorrect = expectedKeys.length > 0 ? matchedKeys.length / expectedKeys.length : 0;

  // 2. Citation created
  const citationCreated = citeCallSucceeded(result.turns);

  // 3. Citation in text
  const citationInText = /\[@v:\d+\]/.test(result.answer);

  // 4. Evidence type match
  const expectedType = getExpectedEvidenceType(tc);
  const actualType = getActualEvidenceType(result.turns);
  let evidenceTypeMatch: boolean | null = null;
  if (expectedType && actualType) {
    evidenceTypeMatch = actualType === expectedType;
  } else if (expectedType && !actualType) {
    // No cite call at all → mismatch
    evidenceTypeMatch = false;
  }

  // Composite score
  let totalScore = 0;
  totalScore += answerCorrect * 40;
  totalScore += citationCreated ? 25 : 0;
  totalScore += citationInText ? 15 : 0;
  if (evidenceTypeMatch === true) totalScore += 20;
  else if (evidenceTypeMatch === null) totalScore += 20; // no expected type = full marks

  return {
    answerCorrect,
    citationCreated,
    citationInText,
    evidenceTypeMatch,
    totalScore: Math.round(totalScore),
    details: {
      expectedKeys,
      matchedKeys,
      actualEvidenceType: actualType,
      expectedEvidenceType: expectedType,
    },
  };
}

// ─── Prompt Generation ───────────────────────────────────────

function generatePrompt(tc: TestCase): string {
  // Video category: hint to use video workflow
  if (tc.category.startsWith('video')) {
    return `请从视频中获取信息并创建可验证引用：

URL：${tc.url}
问题：${tc.question}

要求：
1. 先搜索找到目标视频，然后用 video_transcript 获取字幕
2. 在字幕中找到答案，记录对应的时间戳（秒数）
3. 创建 evidence_type="video" 的可验证引用（verifaible_cite），包含 timestamp 参数
4. 在最终回答中包含具体答案和 [@v:ID] 引用标记`;
  }

  return `请从以下网页获取数据并创建可验证引用：

URL：${tc.url}
问题：${tc.question}

要求：
1. 访问上述 URL，找到问题对应的数据
2. 创建可验证的证据引用（verifaible_cite）
3. 在最终回答中包含具体数据和 [@v:ID] 引用标记`;
}

// ─── Main ─────────────────────────────────────────────────────

async function main() {
  // Parse CLI args
  const args = process.argv.slice(2);
  const taskFile = args[0] || 'testset.json';
  const modelsArg = args[1]; // optional comma-separated model list
  const filterArg = args[2]; // optional task ID filter (comma-separated)

  const models = modelsArg ? modelsArg.split(',') : DEFAULT_MODELS;
  const taskFilter = filterArg ? filterArg.split(',') : null;

  // Load tasks
  const tasksPath = path.resolve(taskFile);
  if (!fs.existsSync(tasksPath)) {
    console.error(`Task file not found: ${tasksPath}`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(tasksPath, 'utf-8'));

  // Detect format: testset.json has { version, cases }, legacy is array
  let cases: TestCase[];
  let isTestSet = false;

  if (raw.cases && Array.isArray(raw.cases)) {
    // testset.json format
    isTestSet = true;
    cases = raw.cases as TestCase[];
    console.log(`Loaded testset v${raw.version}: ${raw.description || ''}`);
  } else if (Array.isArray(raw)) {
    // Legacy format: convert to TestCase-like structure
    cases = (raw as LegacyTask[]).map((t) => ({
      id: t.id,
      category: 'unknown',
      url: '',
      question: t.name,
      answer: '',
      _prompt: t.prompt, // carry original prompt
    })) as any;
    console.log(`Loaded ${cases.length} legacy task(s)`);
  } else {
    console.error('Unrecognized task file format');
    process.exit(1);
  }

  // Apply task ID filter
  if (taskFilter) {
    cases = cases.filter((c) => taskFilter.includes(c.id));
  }

  console.log(`Tasks: ${cases.map((c) => c.id).join(', ')}`);
  console.log(`Models: ${models.join(', ')}`);
  console.log(`Total runs: ${cases.length * models.length}\n`);

  // Ensure results directory
  const resultsDir = path.resolve('results');
  fs.mkdirSync(resultsDir, { recursive: true });

  // Run all combinations
  const summary: SummaryRow[] = [];

  for (const model of models) {
    for (const tc of cases) {
      const runId = `${sanitize(model)}_${tc.id}_${timestamp()}`;
      const runDir = path.join(resultsDir, runId);
      fs.mkdirSync(runDir, { recursive: true });

      const prompt = isTestSet ? generatePrompt(tc) : (tc as any)._prompt || tc.question;
      console.log(`═══ ${model} × ${tc.id} (${tc.category}) ═══`);

      let result: LoopResult;
      try {
        result = await runToolLoop({
          model,
          systemPrompt: SYSTEM_PROMPT,
          userMessage: prompt,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`  ERROR: ${errorMsg}\n`);
        summary.push({
          model,
          task: tc.id,
          category: tc.category,
          roundTrips: 0,
          toolCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
          citations: 0,
          durationMs: 0,
          error: errorMsg,
        });
        fs.writeFileSync(path.join(runDir, 'error.txt'), errorMsg);
        continue;
      }

      // Count citations in answer
      const citationMatches = result.answer.match(/\[@v:\d+\]/g);
      const citationCount = citationMatches ? citationMatches.length : 0;

      // Count verifaible_cite calls
      const citeCallCount = result.turns.reduce((acc, t) => {
        return acc + (t.toolCalls?.filter((c) => c.name === 'verifaible_cite').length ?? 0);
      }, 0);

      // Auto-score if we have an expected answer
      let score: ScoreResult | undefined;
      if (tc.answer) {
        score = scoreResult(tc, result);
      }

      // Save results
      fs.writeFileSync(
        path.join(runDir, 'conversation.json'),
        JSON.stringify(result.turns, null, 2),
      );

      const metrics = {
        model,
        task: tc.id,
        category: tc.category,
        question: tc.question,
        expectedAnswer: tc.answer,
        modelAnswer: result.answer,
        roundTrips: result.roundTrips,
        toolCallCount: result.toolCallCount,
        citeCallCount,
        citationCount,
        inputTokens: result.totalUsage.input_tokens,
        outputTokens: result.totalUsage.output_tokens,
        durationMs: result.durationMs,
        duration: formatDuration(result.durationMs),
        score,
      };
      fs.writeFileSync(path.join(runDir, 'metrics.json'), JSON.stringify(metrics, null, 2));

      fs.writeFileSync(
        path.join(runDir, 'evidence.json'),
        JSON.stringify(
          {
            answer: result.answer,
            citationCount,
            citeCallCount,
            citeCalls: result.turns
              .flatMap((t) => t.toolCalls ?? [])
              .filter((c) => c.name === 'verifaible_cite'),
          },
          null,
          2,
        ),
      );

      const scoreStr = score ? ` | Score: ${score.totalScore}/100` : '';
      console.log(
        `  Done: ${result.roundTrips} turns, ${result.toolCallCount} tools, ` +
          `${citeCallCount} cites, ${citationCount} refs${scoreStr}`,
      );
      if (score) {
        console.log(
          `  Answer: ${(score.answerCorrect * 100).toFixed(0)}% ` +
            `(${score.details.matchedKeys.join(',')}/${score.details.expectedKeys.join(',')}) | ` +
            `Cite: ${score.citationCreated ? 'Y' : 'N'} | ` +
            `Ref: ${score.citationInText ? 'Y' : 'N'} | ` +
            `Type: ${score.evidenceTypeMatch === null ? '-' : score.evidenceTypeMatch ? 'Y' : 'N'} ` +
            `(${score.details.actualEvidenceType || 'none'}→${score.details.expectedEvidenceType || 'any'})`,
        );
      }
      console.log(
        `  ${result.totalUsage.input_tokens}+${result.totalUsage.output_tokens} tokens, ` +
          `${formatDuration(result.durationMs)}`,
      );
      console.log(`  → ${runDir}\n`);

      summary.push({
        model,
        task: tc.id,
        category: tc.category,
        roundTrips: result.roundTrips,
        toolCalls: result.toolCallCount,
        inputTokens: result.totalUsage.input_tokens,
        outputTokens: result.totalUsage.output_tokens,
        citations: citationCount,
        durationMs: result.durationMs,
        score,
      });
    }
  }

  // ─── Print Summary Table ─────────────────────────────────

  console.log('\n' + '═'.repeat(120));
  console.log('  BENCHMARK SUMMARY');
  console.log('═'.repeat(120));

  const hasScores = summary.some((r) => r.score);

  if (hasScores) {
    console.log(
      padRight('Model', 25) +
        padRight('Task', 18) +
        padRight('Cat', 12) +
        padRight('Ans%', 6) +
        padRight('Cite', 6) +
        padRight('Ref', 5) +
        padRight('Type', 6) +
        padRight('Total', 7) +
        padRight('Turns', 6) +
        padRight('Tools', 6) +
        padRight('Tokens', 14) +
        padRight('Time', 8) +
        'Error',
    );
    console.log('─'.repeat(120));

    for (const row of summary) {
      const s = row.score;
      console.log(
        padRight(row.model, 25) +
          padRight(row.task, 18) +
          padRight(row.category, 12) +
          padRight(s ? `${(s.answerCorrect * 100).toFixed(0)}%` : '-', 6) +
          padRight(s ? (s.citationCreated ? 'Y' : 'N') : '-', 6) +
          padRight(s ? (s.citationInText ? 'Y' : 'N') : '-', 5) +
          padRight(s ? (s.evidenceTypeMatch === null ? '-' : s.evidenceTypeMatch ? 'Y' : 'N') : '-', 6) +
          padRight(s ? `${s.totalScore}` : '-', 7) +
          padRight(String(row.roundTrips), 6) +
          padRight(String(row.toolCalls), 6) +
          padRight(`${row.inputTokens}+${row.outputTokens}`, 14) +
          padRight(formatDuration(row.durationMs), 8) +
          (row.error || ''),
      );
    }

    // Per-model averages
    console.log('─'.repeat(120));
    const modelGroups = new Map<string, SummaryRow[]>();
    for (const row of summary) {
      if (!row.score) continue;
      const group = modelGroups.get(row.model) ?? [];
      group.push(row);
      modelGroups.set(row.model, group);
    }

    for (const [model, rows] of modelGroups) {
      const avgScore = rows.reduce((s, r) => s + (r.score?.totalScore ?? 0), 0) / rows.length;
      const avgAns = rows.reduce((s, r) => s + (r.score?.answerCorrect ?? 0), 0) / rows.length;
      const citeRate = rows.filter((r) => r.score?.citationCreated).length / rows.length;
      const refRate = rows.filter((r) => r.score?.citationInText).length / rows.length;
      const avgTokens = rows.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0) / rows.length;
      const avgTime = rows.reduce((s, r) => s + r.durationMs, 0) / rows.length;

      console.log(
        padRight(`AVG ${model}`, 25) +
          padRight(`(${rows.length} runs)`, 18) +
          padRight('', 12) +
          padRight(`${(avgAns * 100).toFixed(0)}%`, 6) +
          padRight(`${(citeRate * 100).toFixed(0)}%`, 6) +
          padRight(`${(refRate * 100).toFixed(0)}%`, 5) +
          padRight('', 6) +
          padRight(`${avgScore.toFixed(1)}`, 7) +
          padRight('', 6) +
          padRight('', 6) +
          padRight(`~${Math.round(avgTokens)}`, 14) +
          padRight(formatDuration(avgTime), 8),
      );
    }
  } else {
    // Legacy mode: no scores
    console.log(
      padRight('Model', 30) +
        padRight('Task', 12) +
        padRight('Turns', 7) +
        padRight('Tools', 7) +
        padRight('Cites', 7) +
        padRight('InTok', 9) +
        padRight('OutTok', 9) +
        padRight('Time', 10) +
        'Error',
    );
    console.log('-'.repeat(100));

    for (const row of summary) {
      console.log(
        padRight(row.model, 30) +
          padRight(row.task, 12) +
          padRight(String(row.roundTrips), 7) +
          padRight(String(row.toolCalls), 7) +
          padRight(String(row.citations), 7) +
          padRight(String(row.inputTokens), 9) +
          padRight(String(row.outputTokens), 9) +
          padRight(formatDuration(row.durationMs), 10) +
          (row.error || ''),
      );
    }
  }

  // Save summary
  fs.writeFileSync(
    path.join(resultsDir, `summary_${timestamp()}.json`),
    JSON.stringify(summary, null, 2),
  );
  console.log(`\nSummary saved to results/summary_${timestamp()}.json`);
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
