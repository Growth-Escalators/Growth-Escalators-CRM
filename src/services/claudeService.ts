/**
 * Tiny Claude API helper — raw fetch, no SDK.
 *
 * Extracted from the pattern used across the codebase (11+ call sites).
 * Centralizes the headers, URL, and response parsing so Wizmatch calls
 * don't duplicate the boilerplate.
 *
 * Models (per repo convention):
 *   - Haiku:  'claude-haiku-4-5-20251001'  (fast, cheap — classification)
 *   - Sonnet: 'claude-sonnet-4-6'           (quality — email drafts, analysis)
 */

const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';

export const CLAUDE_MODELS = {
  HAIKU: 'claude-haiku-4-5-20251001',
  SONNET: 'claude-sonnet-4-6',
} as const;

export interface ClaudeResponse {
  text: string;
  raw: { id: string; type: string; role: string; content: Array<{ type: string; text: string }>; model: string; stop_reason: string | null; usage: { input_tokens: number; output_tokens: number } };
}

export async function callClaude(
  prompt: string,
  model: string = CLAUDE_MODELS.HAIKU,
  maxTokens: number = 500,
  system?: string,
  timeoutMs: number = 60000,
): Promise<ClaudeResponse> {
  const apiKey = process.env.WIZMATCH_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error('No Anthropic API key configured (WIZMATCH_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY)');

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  };
  if (system) body.system = system;

  const res = await fetch(CLAUDE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => 'unknown error');
    throw new Error(`Claude API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const raw = (await res.json()) as ClaudeResponse['raw'];
  const text = raw.content?.[0]?.text ?? '';

  return { text, raw };
}

/**
 * Content-block variant of callClaude — lets callers send images or documents
 * (e.g. an uploaded PDF/scanned JD) alongside text, so Claude reads the file
 * natively without any local PDF/OCR parsing dependency.
 */
export type ClaudeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } };

export async function callClaudeWithContent(
  content: ClaudeContentBlock[],
  model: string = CLAUDE_MODELS.SONNET,
  maxTokens: number = 1500,
  system?: string,
): Promise<ClaudeResponse> {
  const apiKey = process.env.WIZMATCH_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error('No Anthropic API key configured (WIZMATCH_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY)');

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content }],
  };
  if (system) body.system = system;

  const res = await fetch(CLAUDE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    signal: AbortSignal.timeout(90000),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => 'unknown error');
    throw new Error(`Claude API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const raw = (await res.json()) as ClaudeResponse['raw'];
  const text = raw.content?.[0]?.text ?? '';
  return { text, raw };
}

/** Parse JSON from Claude response, stripping markdown fences if present. */
export function parseClaudeJSON<T = unknown>(text: string): T {
  let cleaned = text.trim();
  // Strip markdown code fences if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return JSON.parse(cleaned) as T;
}
