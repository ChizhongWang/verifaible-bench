/**
 * VerifAIble API HTTP Client
 *
 * Wraps calls to the VerifAIble backend (through API gateway).
 */

const API_BASE = process.env.VERIFAIBLE_API_BASE || 'https://ai.verifaible.space/api/v1';
const USER_ID = process.env.VERIFAIBLE_USER_ID || '9';

interface RequestOptions {
  method?: string;
  body?: unknown;
  timeout?: number;
  /** Whether to send X-User-ID header (default true) */
  auth?: boolean;
}

async function request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'POST', body, timeout = 120_000, auth = true } = opts;
  const url = `${API_BASE}${path}`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) headers['X-User-ID'] = USER_ID;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`API ${res.status}: ${text.slice(0, 500)}`);
    }

    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Web Tools ────────────────────────────────────────────────

export interface WebSearchResult {
  title: string;
  url: string;
  content: string;
  published_date?: string;
}

export interface WebSearchResponse {
  success: boolean;
  answer?: string;
  results: WebSearchResult[];
  message?: string;
}

export async function webSearch(params: {
  query: string;
  max_results?: number;
  search_depth?: 'basic' | 'advanced';
  include_answer?: boolean;
}): Promise<WebSearchResponse> {
  return request<WebSearchResponse>('/agent/web/search', {
    body: {
      query: params.query,
      max_results: Math.min(params.max_results ?? 5, 10),
      search_depth: params.search_depth ?? 'basic',
      include_answer: params.include_answer ?? true,
    },
    auth: false,
  });
}

export interface WebFetchResponse {
  success: boolean;
  content?: string;
  message?: string;
}

export async function webFetch(params: { url: string }): Promise<WebFetchResponse> {
  return request<WebFetchResponse>('/agent/web/fetch', {
    body: { url: params.url },
    auth: false,
  });
}

// ─── Evidence Tools ───────────────────────────────────────────

export async function analyzePage(params: {
  url: string;
  action_steps?: string;
}): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>('/evidence/analyze', {
    body: params,
    timeout: 180_000,
    auth: false,
  });
}

export async function testActionSteps(params: {
  url: string;
  action_steps: string;
  verify_type?: 'text' | 'table' | 'image';
  anchor?: string;
  row_anchor?: string;
  element_selector?: string;
  element_alt?: string;
}): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>('/evidence/test-steps', {
    body: params,
    timeout: 180_000,
    auth: false,
  });
}

export interface CreateEvidenceResponse {
  evidence_id: number;
  user_seq: number;
  verifaible_url: string;
  screenshot_url?: string;
}

export async function createEvidence(params: {
  claim: string;
  source_url: string;
  quoted_text: string;
  anchor: string;
  source_title?: string;
  action_steps?: string;
  evidence_type?: string;
  table_selector?: string;
  row_anchor?: string;
  col_anchor?: string;
  element_selector?: string;
  element_alt?: string;
  page_number?: number;
  timestamp?: number;
  video_id?: string;
}): Promise<CreateEvidenceResponse> {
  // Filter out undefined values
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) body[k] = v;
  }
  return request<CreateEvidenceResponse>('/agent/evidence/create-from-web', { body });
}
