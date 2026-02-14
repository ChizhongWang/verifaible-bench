/**
 * OpenRouter Responses API client
 *
 * Uses the Responses API format: POST /api/v1/responses
 * Handles function_call → function_call_output loops.
 */

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

export interface FunctionCallOutput {
  type: 'function_call_output';
  call_id: string;
  output: string;
}

export interface FunctionCall {
  type: 'function_call';
  id: string;        // call_id for response
  call_id: string;
  name: string;
  arguments: string;  // JSON string
}

export interface TextOutput {
  type: 'text';
  text: string;
}

/** OpenRouter message-style output (wraps output_text items) */
export interface MessageOutput {
  type: 'message';
  content: Array<{ type: string; text?: string }>;
  status?: string;
}

export interface ReasoningOutput {
  type: 'reasoning';
  id: string;
  summary: { type: 'summary_text'; text: string }[];
  content?: Array<{ type: string; text?: string }>;
}

export type OutputItem = FunctionCall | TextOutput | MessageOutput | ReasoningOutput;

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export interface ResponsesResult {
  id: string;
  output: OutputItem[];
  usage: Usage;
  status: string;
  error?: { message: string };
}

export type InputItem =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }
  | FunctionCallOutput
  | FunctionCall;

export interface ToolDefinition {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface SendOptions {
  model: string;
  input: InputItem[];
  tools?: ToolDefinition[];
  /** Previous response ID for multi-turn (optional) */
  previous_response_id?: string;
  temperature?: number;
  max_output_tokens?: number;
}

export async function sendResponses(opts: SendOptions): Promise<ResponsesResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const body: Record<string, unknown> = {
    model: opts.model,
    input: opts.input,
  };

  if (opts.tools?.length) body.tools = opts.tools;
  if (opts.previous_response_id) body.previous_response_id = opts.previous_response_id;
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.max_output_tokens) body.max_output_tokens = opts.max_output_tokens;

  const res = await fetch(`${OPENROUTER_BASE}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://verifaible.space',
      'X-Title': 'verifaible-bench',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 1000)}`);
  }

  return (await res.json()) as ResponsesResult;
}
