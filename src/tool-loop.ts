/**
 * Tool Loop — conversation loop between LLM and tool execution
 *
 * Flow: send message → model returns function_call(s) → execute tools →
 *       append function_call_output(s) → repeat until model returns text-only.
 */

import {
  sendResponses,
  type InputItem,
  type FunctionCall,
  type FunctionCallOutput,
  type OutputItem,
  type ToolDefinition,
  type Usage,
} from './openrouter.js';
import { getHandler, getToolDefinitions } from './tools/registry.js';

export interface ToolCallRecord {
  name: string;
  arguments: Record<string, unknown>;
  result: string;
  durationMs: number;
}

export interface TurnRecord {
  role: 'assistant' | 'tool';
  content: string;
  reasoning?: string;
  toolCalls?: ToolCallRecord[];
  usage?: Usage;
}

export interface LoopResult {
  /** Final assistant text response */
  answer: string;
  /** Complete turn-by-turn record */
  turns: TurnRecord[];
  /** Aggregated usage */
  totalUsage: { input_tokens: number; output_tokens: number };
  /** Number of LLM round-trips */
  roundTrips: number;
  /** Total tool calls executed */
  toolCallCount: number;
  /** Duration in ms */
  durationMs: number;
}

export interface LoopOptions {
  model: string;
  systemPrompt: string;
  userMessage: string;
  /** Max LLM round-trips before stopping (default 30) */
  maxRoundTrips?: number;
  tools?: ToolDefinition[];
  temperature?: number;
}

export async function runToolLoop(opts: LoopOptions): Promise<LoopResult> {
  const {
    model,
    systemPrompt,
    userMessage,
    maxRoundTrips = 30,
    tools = getToolDefinitions(),
    temperature = 0.3,
  } = opts;

  const startTime = Date.now();
  const turns: TurnRecord[] = [];
  const totalUsage = { input_tokens: 0, output_tokens: 0 };
  let roundTrips = 0;
  let toolCallCount = 0;

  // Build initial input
  const input: InputItem[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  let previousResponseId: string | undefined;

  while (roundTrips < maxRoundTrips) {
    roundTrips++;

    console.log(`  [Turn ${roundTrips}] Sending to ${model}...`);

    const response = await sendResponses({
      model,
      input,
      tools,
      previous_response_id: previousResponseId,
      temperature,
    });

    previousResponseId = response.id;

    // Accumulate usage
    if (response.usage) {
      totalUsage.input_tokens += response.usage.input_tokens;
      totalUsage.output_tokens += response.usage.output_tokens;
    }

    // Separate function_calls, text, and reasoning from outputs
    const functionCalls: FunctionCall[] = [];
    const textParts: string[] = [];
    const reasoningParts: string[] = [];

    for (const item of response.output) {
      if (item.type === 'function_call') {
        functionCalls.push(item);
      } else if (item.type === 'text') {
        textParts.push(item.text);
      } else if (item.type === 'message' && 'content' in item) {
        // OpenRouter message-style output: extract output_text items
        const msg = item as { content: Array<{ type: string; text?: string }> };
        for (const part of msg.content) {
          if (part.type === 'output_text' && part.text) {
            textParts.push(part.text);
          }
        }
      } else if (item.type === 'reasoning' && 'content' in item) {
        const r = item as { content?: Array<{ type: string; text?: string }> };
        for (const part of r.content ?? []) {
          if (part.text) reasoningParts.push(part.text);
        }
      }
    }

    const reasoning = reasoningParts.length > 0 ? reasoningParts.join('\n') : undefined;

    // If no function calls, we're done
    if (functionCalls.length === 0) {
      const answer = textParts.join('\n');
      turns.push({ role: 'assistant', content: answer, reasoning, usage: response.usage });
      return {
        answer,
        turns,
        totalUsage,
        roundTrips,
        toolCallCount,
        durationMs: Date.now() - startTime,
      };
    }

    // Execute tool calls
    const toolCallRecords: ToolCallRecord[] = [];
    const outputs: FunctionCallOutput[] = [];

    // Add function_call items to input first
    for (const fc of functionCalls) {
      input.push(fc);
    }

    for (const fc of functionCalls) {
      const handler = getHandler(fc.name);
      const callStart = Date.now();
      let result: string;

      if (!handler) {
        result = `Unknown tool: ${fc.name}`;
      } else {
        try {
          const parsedArgs = JSON.parse(fc.arguments);
          console.log(`    [Tool] ${fc.name}(${summarizeArgs(parsedArgs)})`);
          result = await handler(parsedArgs);
        } catch (err) {
          result = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
          console.error(`    [Tool Error] ${fc.name}:`, result);
        }
      }

      toolCallCount++;
      const durationMs = Date.now() - callStart;
      toolCallRecords.push({
        name: fc.name,
        arguments: safeParseJSON(fc.arguments),
        result: result.length > 2000 ? result.slice(0, 2000) + '...[truncated]' : result,
        durationMs,
      });

      outputs.push({
        type: 'function_call_output',
        call_id: fc.call_id,
        output: result,
      });
    }

    // Append function_call_outputs to input
    for (const out of outputs) {
      input.push(out);
    }

    // Record this turn
    turns.push({
      role: 'assistant',
      content: textParts.join('\n'),
      reasoning,
      toolCalls: toolCallRecords,
      usage: response.usage,
    });
  }

  // Max rounds exceeded
  return {
    answer: '[Max round-trips exceeded]',
    turns,
    totalUsage,
    roundTrips,
    toolCallCount,
    durationMs: Date.now() - startTime,
  };
}

function safeParseJSON(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return { raw: s };
  }
}

function summarizeArgs(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    parts.push(`${k}=${s.length > 60 ? s.slice(0, 57) + '...' : s}`);
  }
  return parts.join(', ');
}
