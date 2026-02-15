/**
 * video_transcript tool handler — fetch YouTube transcript via Supadata API
 */

import { sleep } from '../utils.js';

const SUPADATA_API_KEY = process.env.SUPADATA_API_KEY || '';
const SUPADATA_BASE = 'https://api.supadata.ai/v1';

interface TranscriptSegment {
  text: string;
  offset: number;   // milliseconds
  duration: number;
  lang: string;
}

interface TranscriptResponse {
  lang?: string;
  availableLangs?: string[];
  content?: TranscriptSegment[];
  jobId?: string;
}

interface JobStatusResponse {
  status: string;
  lang?: string;
  content?: TranscriptSegment[];
}

function formatTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

async function fetchTranscript(url: string): Promise<TranscriptResponse> {
  const apiUrl = `${SUPADATA_BASE}/transcript?url=${encodeURIComponent(url)}&text=false&lang=en`;
  const res = await fetch(apiUrl, {
    headers: { 'x-api-key': SUPADATA_API_KEY },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supadata API ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as TranscriptResponse;
}

async function pollJob(jobId: string, maxRetries = 10, intervalMs = 3000): Promise<TranscriptSegment[]> {
  for (let i = 0; i < maxRetries; i++) {
    await sleep(intervalMs);
    const res = await fetch(`${SUPADATA_BASE}/transcript/${jobId}`, {
      headers: { 'x-api-key': SUPADATA_API_KEY },
    });
    if (!res.ok) continue;
    const data = (await res.json()) as JobStatusResponse;
    if (data.content && data.content.length > 0) {
      return data.content;
    }
    if (data.status === 'failed') {
      throw new Error('Transcript job failed');
    }
    // status === 'active' → keep polling
  }
  throw new Error(`Transcript job timed out after ${maxRetries} retries`);
}

export async function handleVideoTranscript(args: Record<string, unknown>): Promise<string> {
  const url = args.url as string;
  if (!url) return 'Error: url is required';
  if (!SUPADATA_API_KEY) return 'Error: SUPADATA_API_KEY not configured';

  try {
    const data = await fetchTranscript(url);

    let segments: TranscriptSegment[];

    if (data.jobId) {
      // Async processing for longer videos
      segments = await pollJob(data.jobId);
    } else if (data.content && data.content.length > 0) {
      segments = data.content;
    } else {
      return 'No transcript available for this video. The video may not have subtitles.';
    }

    // Format as timestamped lines
    const lines: string[] = [];
    lines.push(`Language: ${data.lang || 'en'}`);
    lines.push(`Segments: ${segments.length}`);
    lines.push('');

    for (const seg of segments) {
      const ts = formatTimestamp(seg.offset);
      lines.push(`[${ts}] ${seg.text}`);
    }

    return lines.join('\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Transcript fetch failed: ${msg}`;
  }
}
