/**
 * Benchmark Runner — iterates models × tasks, saves results
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { runToolLoop, type LoopResult } from './tool-loop.js';
import { timestamp, formatDuration } from './utils.js';

// ─── Config ───────────────────────────────────────────────────

const DEFAULT_MODELS = [
  'moonshotai/kimi-k2.5',
  'minimax/minimax-m2.5',
  'z-ai/glm-5',
];

const SYSTEM_PROMPT = `你是 VerifAIble 助手，专注于帮助用户查找信息并创建可验证引用。

## 可验证引用（核心任务）

你有以下工具：verifaible_web_search（搜索）、web_fetch（获取网页内容）、analyze_page（深度分析网页）、test_action_steps（测试操作步骤）、verifaible_cite（创建引用）。

**搜索建议**：优先使用英文关键词搜索，英文搜索结果质量更高、来源更权威。

搜索后，你**必须**为每个关键论点调用 verifaible_cite 创建引用，流程如下：
1. 调用 verifaible_web_search 搜索信息
2. 阅读搜索结果
3. 对每个关键论点，**逐一调用 verifaible_cite**（提供 claim、source_url、quoted_text、anchor）
4. verifaible_cite 会返回 user_seq（如 user_seq=42）
5. 在最终回答中用 [@v:42] 格式标记引用

**严禁编造引用 ID**。[@v:ID] 中的 ID 必须来自 verifaible_cite 的返回值。

字段要求：
- claim: 你的论点/结论
- source_url: 搜索结果中的原始链接
- quoted_text: 从搜索结果的 content 中逐字复制的原文片段
- anchor: 3-20字符，quoted_text 中最独特的部分（优先选精确数字、日期、专有名词）`;

// ─── Task type ────────────────────────────────────────────────

interface BenchTask {
  id: string;
  name: string;
  prompt: string;
  /** Expected minimum citations */
  minCitations?: number;
  /** Tags for categorization */
  tags?: string[];
}

// ─── Main ─────────────────────────────────────────────────────

async function main() {
  // Parse CLI args
  const args = process.argv.slice(2);
  const taskFile = args[0] || 'tasks/sample.json';
  const modelsArg = args[1]; // optional comma-separated model list

  const models = modelsArg ? modelsArg.split(',') : DEFAULT_MODELS;

  // Load tasks
  const tasksPath = path.resolve(taskFile);
  if (!fs.existsSync(tasksPath)) {
    console.error(`Task file not found: ${tasksPath}`);
    process.exit(1);
  }

  const tasks: BenchTask[] = JSON.parse(fs.readFileSync(tasksPath, 'utf-8'));
  console.log(`Loaded ${tasks.length} task(s) from ${taskFile}`);
  console.log(`Models: ${models.join(', ')}`);
  console.log(`Total runs: ${tasks.length * models.length}\n`);

  // Ensure results directory
  const resultsDir = path.resolve('results');
  fs.mkdirSync(resultsDir, { recursive: true });

  // Run all combinations
  const summary: Array<{
    model: string;
    task: string;
    roundTrips: number;
    toolCalls: number;
    inputTokens: number;
    outputTokens: number;
    citations: number;
    durationMs: number;
    error?: string;
  }> = [];

  for (const model of models) {
    for (const task of tasks) {
      const runId = `${sanitize(model)}_${task.id}_${timestamp()}`;
      const runDir = path.join(resultsDir, runId);
      fs.mkdirSync(runDir, { recursive: true });

      console.log(`═══ ${model} × ${task.name} ═══`);

      let result: LoopResult;
      try {
        result = await runToolLoop({
          model,
          systemPrompt: SYSTEM_PROMPT,
          userMessage: task.prompt,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`  ERROR: ${errorMsg}\n`);
        summary.push({
          model,
          task: task.id,
          roundTrips: 0,
          toolCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
          citations: 0,
          durationMs: 0,
          error: errorMsg,
        });
        // Save error
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

      // Save results
      fs.writeFileSync(
        path.join(runDir, 'conversation.json'),
        JSON.stringify(result.turns, null, 2),
      );

      const metrics = {
        model,
        task: task.id,
        taskName: task.name,
        roundTrips: result.roundTrips,
        toolCallCount: result.toolCallCount,
        citeCallCount,
        citationCount,
        inputTokens: result.totalUsage.input_tokens,
        outputTokens: result.totalUsage.output_tokens,
        durationMs: result.durationMs,
        duration: formatDuration(result.durationMs),
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

      console.log(
        `  Done: ${result.roundTrips} turns, ${result.toolCallCount} tool calls, ` +
          `${citeCallCount} cites, ${citationCount} [@v:] refs, ` +
          `${result.totalUsage.input_tokens}+${result.totalUsage.output_tokens} tokens, ` +
          `${formatDuration(result.durationMs)}`,
      );
      console.log(`  Saved to ${runDir}\n`);

      summary.push({
        model,
        task: task.id,
        roundTrips: result.roundTrips,
        toolCalls: result.toolCallCount,
        inputTokens: result.totalUsage.input_tokens,
        outputTokens: result.totalUsage.output_tokens,
        citations: citationCount,
        durationMs: result.durationMs,
      });
    }
  }

  // Print summary table
  console.log('\n════════════════════════════════════════════════');
  console.log('                   SUMMARY');
  console.log('════════════════════════════════════════════════');
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

  // Save summary
  fs.writeFileSync(
    path.join(resultsDir, `summary_${timestamp()}.json`),
    JSON.stringify(summary, null, 2),
  );
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
