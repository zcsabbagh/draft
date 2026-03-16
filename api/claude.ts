import type { VercelRequest, VercelResponse } from '@vercel/node';

const USAGE_API = process.env.VITE_COLLAB_URL
  ? process.env.VITE_COLLAB_URL.replace('wss://', 'https://').replace('ws://', 'http://')
  : null;
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'change-me-in-production';

async function checkBudget(): Promise<{ allowed: boolean; remaining_usd: number; total_usd: number; limit_usd: number }> {
  if (!USAGE_API) return { allowed: true, remaining_usd: 999, total_usd: 0, limit_usd: 999 };
  try {
    const res = await fetch(`${USAGE_API}/api/usage/check`);
    if (!res.ok) return { allowed: true, remaining_usd: 999, total_usd: 0, limit_usd: 999 };
    return await res.json();
  } catch {
    // If usage API is down, allow requests (fail open for dev)
    return { allowed: true, remaining_usd: 999, total_usd: 0, limit_usd: 999 };
  }
}

async function logUsage(inputTokens: number, outputTokens: number, model: string) {
  if (!USAGE_API) return;
  try {
    await fetch(`${USAGE_API}/api/usage/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ADMIN_SECRET}` },
      body: JSON.stringify({ input_tokens: inputTokens, output_tokens: outputTokens, model }),
    });
  } catch {
    // Non-critical — don't fail the request
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).end('Method not allowed');
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
  }

  // Check budget before making the call
  const budget = await checkBudget();
  if (!budget.allowed) {
    return res.status(429).json({
      error: `Budget limit reached ($${budget.total_usd.toFixed(2)} / $${budget.limit_usd.toFixed(2)}). Contact the admin to increase the limit.`,
    });
  }

  const { messages, system, max_tokens, stream } = req.body;
  const model = 'claude-sonnet-4-20250514';

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: max_tokens || 1024,
      system,
      messages,
      stream: !!stream,
    }),
  });

  if (stream && response.ok && response.body) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = (response.body as ReadableStream).getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullText += chunk;
        res.write(chunk);
      }
    } catch {
      // client disconnected
    }

    // Try to extract usage from the final SSE message
    try {
      const usageMatch = fullText.match(/"usage"\s*:\s*\{[^}]*"input_tokens"\s*:\s*(\d+)[^}]*"output_tokens"\s*:\s*(\d+)/);
      if (usageMatch) {
        logUsage(parseInt(usageMatch[1]), parseInt(usageMatch[2]), model);
      }
    } catch { /* ignore */ }

    return res.end();
  }

  const data = await response.text();

  // Log usage from non-streaming response
  if (response.ok) {
    try {
      const parsed = JSON.parse(data);
      if (parsed.usage) {
        logUsage(parsed.usage.input_tokens || 0, parsed.usage.output_tokens || 0, model);
      }
    } catch { /* ignore */ }
  }

  res.setHeader('Content-Type', 'application/json');
  return res.status(response.status).end(data);
}
