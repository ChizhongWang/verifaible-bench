/**
 * Tool Loop — conversation loop between LLM and tool execution
 *
 * Flow: send message → model returns function_call(s) → execute tools →
 *       append function_call_output(s) → repeat until model returns text-only.
 */

import {
  sendResponses as openrouterSend,
  type InputItem,
  type FunctionCall,
  type FunctionCallOutput,
  type OutputItem,
  type SendOptions,
  type ResponsesResult,
  type ToolDefinition,
  type Usage,
} from './openrouter.js';
import { getHandler, getToolDefinitions } from './tools/registry.js';
import { randomUUID } from 'node:crypto';

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
  /** Custom send function (default: OpenRouter sendResponses) */
  sendFn?: (opts: SendOptions) => Promise<ResponsesResult>;
}

export async function runToolLoop(opts: LoopOptions): Promise<LoopResult> {
  const {
    model,
    systemPrompt,
    userMessage,
    maxRoundTrips = 30,
    tools = getToolDefinitions(),
    temperature = 0.3,
    sendFn = openrouterSend,
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

    const response = await sendFn({
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

    // If no function calls from API, check if model embedded tool calls in text content
    // (DeepSeek-R1 sometimes writes tool calls in content text with special tokens)
    if (functionCalls.length === 0) {
      const rawText = textParts.join('\n');
      const parsedCalls = parseToolCallsFromContent(rawText);
      if (parsedCalls.length > 0) {
        console.log(`    [R1-compat] Parsed ${parsedCalls.length} tool call(s) from content text`);
        functionCalls.push(...parsedCalls);
        // Strip the tool call JSON block from the visible text
        const cleanedText = stripToolCallBlocks(rawText);
        textParts.length = 0;
        textParts.push(cleanedText);
        // Clear previousResponseId — the API's stored response doesn't contain
        // our synthetic function_call items, so we must rely on the full input array
        previousResponseId = undefined;
      }
    }

    // If still no function calls after fallback parsing, we're done
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

/* ------------------------------------------------------------------ *
 * DeepSeek-R1 compatibility: parse tool calls embedded in content text
 * ------------------------------------------------------------------ */

/**
 * DeepSeek-R1 sometimes embeds tool calls in the content text instead of
 * returning proper function_call output items.  The pattern looks like:
 *
 *   ```json
 *   [{"name": "tool_name", "arguments": {...}}]
 *   ```<｜tool▁call▁end｜><｜tool▁calls▁end｜>
 *
 * or sometimes without backtick fences, just the JSON followed by the special tokens.
 */
function parseToolCallsFromContent(text: string): FunctionCall[] {
  // Detect DeepSeek special end-tokens — both full-width and half-width variants
  const hasDeepSeekTokens =
    text.includes('<｜tool') || text.includes('<|tool');

  if (!hasDeepSeekTokens) return [];

  const calls: FunctionCall[] = [];

  // Strategy 1: Extract JSON array/object from markdown code blocks
  const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    const block = match[1].trim();
    const parsed = tryParseToolCalls(block);
    if (parsed.length > 0) {
      calls.push(...parsed);
    }
  }

  // Strategy 2: If no code blocks matched, try to find raw JSON array/object
  // before the DeepSeek tokens
  if (calls.length === 0) {
    const tokenRegex = /<[｜|]tool[▁_]call[▁_]end[｜|]>/;
    const tokenMatch = tokenRegex.exec(text);
    if (tokenMatch) {
      // Look backwards from the token position for a JSON block
      const beforeToken = text.slice(0, tokenMatch.index).trimEnd();
      // Find the start of JSON (last [ or { that isn't nested)
      const jsonStart = findJsonStart(beforeToken);
      if (jsonStart >= 0) {
        const jsonStr = beforeToken.slice(jsonStart).trim();
        const parsed = tryParseToolCalls(jsonStr);
        if (parsed.length > 0) {
          calls.push(...parsed);
        }
      }
    }
  }

  return calls;
}

/** Try to parse a string as a tool call array or single tool call object. */
function tryParseToolCalls(jsonStr: string): FunctionCall[] {
  try {
    const parsed = JSON.parse(jsonStr);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const calls: FunctionCall[] = [];

    for (const item of items) {
      if (item && typeof item.name === 'string' && item.arguments !== undefined) {
        const callId = `call_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
        calls.push({
          type: 'function_call',
          id: callId,
          call_id: callId,
          name: item.name,
          arguments: typeof item.arguments === 'string'
            ? item.arguments
            : JSON.stringify(item.arguments),
        });
      }
    }

    return calls;
  } catch {
    return [];
  }
}

/** Find the start index of a JSON array or object in a string (scanning backwards). */
function findJsonStart(text: string): number {
  // Look for the last unmatched '[' or '{'
  let depth = 0;
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === ']' || ch === '}') depth++;
    else if (ch === '[' || ch === '{') {
      depth--;
      if (depth < 0) return i;  // Found the opening bracket
    }
  }
  return -1;
}

/** Strip embedded tool call JSON blocks and DeepSeek tokens from visible text. */
function stripToolCallBlocks(text: string): string {
  // Remove code blocks containing tool calls + DeepSeek tokens
  let cleaned = text;

  // Remove ```json ... ```<tokens> patterns
  cleaned = cleaned.replace(
    /```(?:json)?\s*\n?[\s\S]*?```\s*(?:<[｜|]tool[^\n]*>)*/g,
    ''
  );

  // Remove standalone DeepSeek tokens
  cleaned = cleaned.replace(/<[｜|]tool[▁_][^>]*>/g, '');

  return cleaned.trim();
}
