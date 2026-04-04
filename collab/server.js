import { Hocuspocus } from '@hocuspocus/server';
import { Database } from '@hocuspocus/extension-database';
import SQLite from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new SQLite(join(__dirname, 'data', 'documents.db'));

// ── Tables ──────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    name TEXT PRIMARY KEY,
    data BLOB,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    model TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS budget (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`);

// Set default budget limit if not exists ($2 to start — change this)
const getBudget = db.prepare('SELECT value FROM budget WHERE key = ?');
const setBudget = db.prepare('INSERT OR REPLACE INTO budget (key, value) VALUES (?, ?)');
if (!getBudget.get('limit_usd')) {
  setBudget.run('limit_usd', '2.00');
}

const getStmt = db.prepare('SELECT data FROM documents WHERE name = ?');
const upsertStmt = db.prepare(`
  INSERT INTO documents (name, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(name) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP
`);

const logUsageStmt = db.prepare(`
  INSERT INTO usage (input_tokens, output_tokens, cost_usd, model) VALUES (?, ?, ?, ?)
`);

const getTotalCostStmt = db.prepare('SELECT COALESCE(SUM(cost_usd), 0) as total FROM usage');

// ── Cost calculation (Sonnet 4 pricing) ─────────────────────────────

function calculateCost(inputTokens, outputTokens, model = 'claude-sonnet-4-20250514') {
  // Sonnet: $3/M input, $15/M output
  const rates = {
    'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
    'claude-haiku-4-5-20251001': { input: 1.0, output: 5.0 },
  };
  const rate = rates[model] || rates['claude-sonnet-4-20250514'];
  return (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
}

// ── HTTP API for usage tracking ─────────────────────────────────────

function handleUsageApi(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const ADMIN_SECRET = process.env.ADMIN_SECRET || 'change-me-in-production';

  // GET /api/usage/check — returns budget status
  if (url.pathname === '/api/usage/check' && req.method === 'GET') {
    const { total } = getTotalCostStmt.get();
    const limitRow = getBudget.get('limit_usd');
    const limit = parseFloat(limitRow?.value || '2.00');
    const remaining = Math.max(0, limit - total);
    const allowed = total < limit;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      total_usd: Math.round(total * 10000) / 10000,
      limit_usd: limit,
      remaining_usd: Math.round(remaining * 10000) / 10000,
      allowed,
    }));
    return;
  }

  // Auth helper — checks Authorization: Bearer <secret>
  const isAuthed = () => {
    const auth = req.headers.authorization;
    return auth === `Bearer ${ADMIN_SECRET}`;
  };

  // POST /api/usage/log — log token usage after a call (requires auth)
  if (url.pathname === '/api/usage/log' && req.method === 'POST') {
    if (!isAuthed()) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const { input_tokens, output_tokens, model } = JSON.parse(body);
        const cost = calculateCost(input_tokens || 0, output_tokens || 0, model);
        logUsageStmt.run(input_tokens || 0, output_tokens || 0, cost, model || 'unknown');

        const { total } = getTotalCostStmt.get();
        const limitRow = getBudget.get('limit_usd');
        const limit = parseFloat(limitRow?.value || '2.00');

        console.log(`[usage] +$${cost.toFixed(4)} (${input_tokens}in/${output_tokens}out) — total: $${total.toFixed(4)}/$${limit}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ logged: true, cost_usd: cost, total_usd: total }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e) }));
      }
    });
    return;
  }

  // POST /api/usage/set-limit — update the budget limit (requires auth)
  if (url.pathname === '/api/usage/set-limit' && req.method === 'POST') {
    if (!isAuthed()) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const { limit_usd } = JSON.parse(body);
        setBudget.run('limit_usd', String(limit_usd));
        console.log(`[usage] Budget limit set to $${limit_usd}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ limit_usd }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e) }));
      }
    });
    return;
  }

  // POST /api/usage/reset — reset usage counter (requires auth)
  if (url.pathname === '/api/usage/reset' && req.method === 'POST') {
    if (!isAuthed()) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    db.exec('DELETE FROM usage');
    console.log('[usage] Usage counter reset');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ reset: true }));
    return;
  }

  // Health check
  if (url.pathname === '/' || url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const { total } = getTotalCostStmt.get();
    const limitRow = getBudget.get('limit_usd');
    res.end(JSON.stringify({ status: 'ok', usage_usd: total, limit_usd: parseFloat(limitRow?.value || '2.00') }));
    return;
  }

  // Not found — let Hocuspocus handle WebSocket upgrades
  return false;
}

// ── HTTP + WebSocket server ─────────────────────────────────────────

const port = parseInt(process.env.PORT || '8888');

const httpServer = createServer((req, res) => {
  const handled = handleUsageApi(req, res);
  if (handled === false) {
    res.writeHead(404);
    res.end('Not found');
  }
});

// ── Hocuspocus ──────────────────────────────────────────────────────

const hocuspocus = new Hocuspocus({
  extensions: [
    new Database({
      fetch: async ({ documentName }) => {
        const row = getStmt.get(documentName);
        return row ? row.data : null;
      },
      store: async ({ documentName, state }) => {
        upsertStmt.run(documentName, state);
      },
    }),
  ],

  async onAuthenticate({ token }) {
    try {
      const user = JSON.parse(token);
      return {
        user: {
          name: user.name || 'Anonymous',
          color: user.color || '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'),
          role: user.role || 'editor',
        },
      };
    } catch {
      return {
        user: {
          name: 'Anonymous',
          color: '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'),
          role: 'editor',
        },
      };
    }
  },

  async onConnect({ documentName, context }) {
    console.log(`[collab] ${context.user?.name || 'unknown'} connected to "${documentName}"`);
  },

  async onDisconnect({ documentName, context }) {
    console.log(`[collab] ${context.user?.name || 'unknown'} disconnected from "${documentName}"`);
  },
});

// WebSocket server — upgrade HTTP connections, then hand to Hocuspocus
const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    hocuspocus.handleConnection(ws, request);
  });
});

httpServer.listen(port, () => {
  const { total } = getTotalCostStmt.get();
  const limitRow = getBudget.get('limit_usd');
  const limit = parseFloat(limitRow?.value || '2.00');
  console.log(`[collab] Hocuspocus + Usage API running on port ${port}`);
  console.log(`[usage]  Budget: $${total.toFixed(4)} / $${limit} spent`);
});
