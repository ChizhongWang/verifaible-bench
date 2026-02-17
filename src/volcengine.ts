/**
 * Volcengine ARK API client (doubao-seed-2.0)
 *
 * Uses OpenAI Chat Completions compatible format.
 * Converts InputItem[] / ToolDefinition[] from the Responses API shape
 * used by the rest of the codebase into Chat Completions request/response.
 */

import {
  type InputItem,
  type FunctionCall,
  type FunctionCallOutput,
  type OutputItem,
  type TextOutput,
  type ToolDefinition,
  type SendOptions,
  type ResponsesResult,
  type Usage,
} from './openrouter.js';
import { randomUUID } from 'node:crypto';

const ARK_BASE = 'https://ark.cn-beijing.volces.com/api/v3';

// ── Request types (OpenAI Chat Completions) ──────────────────

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
}

interface ChatToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface ChatTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

// ── Response types ───────────────────────────────────────────

interface ChatChoice {
  message: {
    role: string;
    content?: string | null;
    tool_calls?: ChatToolCall[];
  };
  finish_reason: string;
}

interface ChatCompletionResponse {
  id: string;
  choices: ChatChoice[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

// ── Conversion: InputItem[] → ChatMessage[] ──────────────────

function inputToMessages(input: InputItem[]): ChatMessage[] {
  const messages: ChatMessage[] = [];

  let i = 0;
  while (i < input.length) {
    const item = input[i];

    if ('role' in item && (item.role === 'system' || item.role === 'user' || item.role === 'assistant')) {
      messages.push({ role: item.role, content: item.content });
      i++;
      continue;
    }

    // Collect consecutive FunctionCall items into one assistant message
    if ((item as FunctionCall).type === 'function_call') {
      const toolCalls: ChatToolCall[] = [];
      while (i < input.length && (input[i] as FunctionCall).type === 'function_call') {
        const fc = input[i] as FunctionCall;
        toolCalls.push({
          id: fc.call_id,
          type: 'function',
          function: { name: fc.name, arguments: fc.arguments },
        });
        i++;
      }
      messages.push({ role: 'assistant', content: null, tool_calls: toolCalls });
      continue;
    }

    // FunctionCallOutput → tool message
    if ((item as FunctionCallOutput).type === 'function_call_output') {
      const fco = item as FunctionCallOutput;
      messages.push({ role: 'tool', content: fco.output, tool_call_id: fco.call_id });
      i++;
      continue;
    }

    // Fallback: skip unknown items
    i++;
  }

  return messages;
}

// ── Conversion: ToolDefinition[] → ChatTool[] ────────────────

function toolsToChatTools(tools: ToolDefinition[]): ChatTool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

// ── Conversion: ChatCompletionResponse → ResponsesResult ─────

function chatResponseToResult(resp: ChatCompletionResponse): ResponsesResult {
  const output: OutputItem[] = [];
  const choice = resp.choices?.[0];

  if (choice?.message?.content) {
    output.push({ type: 'text', text: choice.message.content } as TextOutput);
  }

  if (choice?.message?.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      const callId = tc.id || `call_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
      output.push({
        type: 'function_call',
        id: callId,
        call_id: callId,
        name: tc.function.name,
        arguments: tc.function.arguments,
      } as FunctionCall);
    }
  }

  const usage: Usage = {
    input_tokens: resp.usage?.prompt_tokens ?? 0,
    output_tokens: resp.usage?.completion_tokens ?? 0,
    total_tokens: resp.usage?.total_tokens ?? 0,
  };

  return {
    id: resp.id || `ark-${randomUUID()}`,
    output,
    usage,
    status: 'completed',
  };
}

// ── Public API (same signature as openrouter.ts) ─────────────

export async function sendResponses(opts: SendOptions): Promise<ResponsesResult> {
  const apiKey = process.env.ARK_API_KEY;
  if (!apiKey) throw new Error('ARK_API_KEY not set');

  const messages = inputToMessages(opts.input);
  const body: Record<string, unknown> = {
    model: opts.model,
    messages,
  };

  if (opts.tools?.length) {
    body.tools = toolsToChatTools(opts.tools);
  }
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.max_output_tokens) body.max_tokens = opts.max_output_tokens;

  const MAX_RETRIES = 5;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${ARK_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        const wait = Math.min(15 * (attempt + 1), 60);
        console.log(`  [ARK Network] ${(err as Error).message}, waiting ${wait}s before retry ${attempt + 1}/${MAX_RETRIES}...`);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      throw new Error(`ARK network error after ${MAX_RETRIES} retries: ${(err as Error).message}`);
    }

    if (res.status === 429 && attempt < MAX_RETRIES) {
      const wait = Math.min(30 * (attempt + 1), 120);
      console.log(`  [ARK 429] Rate limited, waiting ${wait}s before retry ${attempt + 1}/${MAX_RETRIES}...`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`ARK ${res.status}: ${text.slice(0, 1000)}`);
    }

    const json = (await res.json()) as ChatCompletionResponse;
    return chatResponseToResult(json);
  }

  throw new Error('ARK: max retries exceeded');
}
