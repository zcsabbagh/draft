import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const MAX_TOKENS_CAP = 4096;
const MAX_SYSTEM_LENGTH = 8000;
const MAX_REQUESTS_PER_DOC = 50;
const BUDGET_LIMIT_USD = 1000;

// Supabase for cost tracking and rate limiting
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

function calculateCost(inputTokens: number, outputTokens: number): number {
  // Claude Sonnet 4: $3/M input, $15/M output
  return (inputTokens * 3 + outputTokens * 15) / 1_000_000;
}

async function checkBudget(documentId?: string): Promise<{ allowed: boolean; reason?: string }> {
  if (!supabase) return { allowed: true };

  try {
    // Check total spend
    const { data: costData } = await supabase.from('api_usage').select('cost_usd');
    const totalCost = (costData ?? []).reduce((sum, r) => sum + Number(r.cost_usd), 0);
    if (totalCost >= BUDGET_LIMIT_USD) {
      return { allowed: false, reason: `Total budget exceeded ($${totalCost.toFixed(2)} / $${BUDGET_LIMIT_USD})` };
    }

    // Check per-document limit
    if (documentId) {
      const { count } = await supabase
        .from('api_usage')
        .select('id', { count: 'exact', head: true })
        .eq('document_id', documentId);
      if ((count ?? 0) >= MAX_REQUESTS_PER_DOC) {
        return { allowed: false, reason: `Document request limit reached (${count}/${MAX_REQUESTS_PER_DOC})` };
      }
    }

    return { allowed: true };
  } catch {
    // If budget check fails, block (fail closed)
    return { allowed: false, reason: 'Budget check unavailable' };
  }
}

async function logUsage(sessionId: string | undefined, documentId: string | undefined, inputTokens: number, outputTokens: number, model: string, requestType: string) {
  if (!supabase) return;
  try {
    const cost = calculateCost(inputTokens, outputTokens);
    await supabase.from('api_usage').insert({
      session_id: sessionId || null,
      document_id: documentId || null,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      model,
      cost_usd: cost,
      request_type: requestType || 'unknown',
    });
  } catch { /* non-critical */ }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).end('Method not allowed');
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
  }

  const { messages, system, max_tokens, stream, session_id, document_id, request_type } = req.body;

  // Input validation
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }
  const cappedMaxTokens = Math.min(max_tokens || 1024, MAX_TOKENS_CAP);
  const cappedSystem = typeof system === 'string' ? system.slice(0, MAX_SYSTEM_LENGTH) : undefined;

  // Budget check (fail closed)
  const budget = await checkBudget(document_id);
  if (!budget.allowed) {
    return res.status(429).json({ error: budget.reason });
  }

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
      max_tokens: cappedMaxTokens,
      system: cappedSystem,
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
    } catch { /* client disconnected */ }

    // Extract usage from final SSE message and log
    try {
      const usageMatch = fullText.match(/"usage"\s*:\s*\{[^}]*"input_tokens"\s*:\s*(\d+)[^}]*"output_tokens"\s*:\s*(\d+)/);
      if (usageMatch) {
        logUsage(session_id, document_id, parseInt(usageMatch[1]), parseInt(usageMatch[2]), model, request_type);
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
        logUsage(session_id, document_id, parsed.usage.input_tokens || 0, parsed.usage.output_tokens || 0, model, request_type);
      }
    } catch { /* ignore */ }
  }

  res.setHeader('Content-Type', 'application/json');
  return res.status(response.status).end(data);
}
