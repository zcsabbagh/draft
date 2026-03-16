import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { WebSocketServer, type WebSocket as WsWebSocket } from 'ws';

function importProxy(): Plugin {
  return {
    name: 'import-proxy',
    configureServer(server) {
      // Google Docs import — fetches the HTML export of a public doc
      server.middlewares.use('/api/import/gdocs', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }

        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', async () => {
          try {
            const { url } = JSON.parse(body);
            // Extract doc ID from various Google Docs URL formats
            const match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
            if (!match) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Invalid Google Docs URL. Expected format: https://docs.google.com/document/d/...' }));
              return;
            }
            const docId = match[1];
            const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=html`;

            const response = await fetch(exportUrl, { redirect: 'follow' });
            if (!response.ok) {
              res.statusCode = response.status;
              res.end(JSON.stringify({ error: `Google Docs returned ${response.status}. Make sure the document is shared as "Anyone with the link can view".` }));
              return;
            }

            const html = await response.text();
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ html }));
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(e) }));
          }
        });
      });

      // Notion import — fetches page content via Notion API
      server.middlewares.use('/api/import/notion', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }

        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', async () => {
          try {
            const { url } = JSON.parse(body);
            const notionKey = process.env.NOTION_API_KEY;

            if (!notionKey) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'NOTION_API_KEY not set in environment. Add a Notion integration token to use URL import.' }));
              return;
            }

            // Extract page ID from Notion URL
            // Formats: notion.so/Page-Title-{id}, notion.site/Page-Title-{id}, notion.so/{workspace}/{id}
            const cleaned = url.replace(/-/g, '').replace(/\?.*$/, '');
            const idMatch = cleaned.match(/([a-f0-9]{32})$/i);
            if (!idMatch) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Could not extract page ID from Notion URL.' }));
              return;
            }
            const pageId = idMatch[1].replace(
              /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
              '$1-$2-$3-$4-$5'
            );

            // Fetch page title
            const pageRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
              headers: {
                'Authorization': `Bearer ${notionKey}`,
                'Notion-Version': '2022-06-28',
              },
            });
            if (!pageRes.ok) {
              res.statusCode = pageRes.status;
              res.end(JSON.stringify({ error: `Notion API returned ${pageRes.status}. Make sure the page is shared with your integration.` }));
              return;
            }

            // Recursively fetch all blocks
            const blocks: any[] = [];
            let cursor: string | undefined;
            do {
              const blocksUrl = new URL(`https://api.notion.com/v1/blocks/${pageId}/children`);
              blocksUrl.searchParams.set('page_size', '100');
              if (cursor) blocksUrl.searchParams.set('start_cursor', cursor);

              const blocksRes = await fetch(blocksUrl.toString(), {
                headers: {
                  'Authorization': `Bearer ${notionKey}`,
                  'Notion-Version': '2022-06-28',
                },
              });
              if (!blocksRes.ok) break;
              const data = await blocksRes.json() as { results: any[]; has_more: boolean; next_cursor?: string };
              blocks.push(...data.results);
              cursor = data.has_more ? data.next_cursor : undefined;
            } while (cursor);

            // Convert Notion blocks to markdown-ish text
            const lines: string[] = [];
            for (const block of blocks) {
              const richTextToString = (rt: any[]) =>
                (rt || []).map((t: any) => {
                  let s = t.plain_text || '';
                  if (t.annotations?.bold) s = `**${s}**`;
                  if (t.annotations?.italic) s = `*${s}*`;
                  if (t.annotations?.strikethrough) s = `~~${s}~~`;
                  if (t.annotations?.code) s = `\`${s}\``;
                  if (t.href) s = `[${s}](${t.href})`;
                  return s;
                }).join('');

              switch (block.type) {
                case 'paragraph':
                  lines.push(richTextToString(block.paragraph.rich_text));
                  break;
                case 'heading_1':
                  lines.push(`# ${richTextToString(block.heading_1.rich_text)}`);
                  break;
                case 'heading_2':
                  lines.push(`## ${richTextToString(block.heading_2.rich_text)}`);
                  break;
                case 'heading_3':
                  lines.push(`### ${richTextToString(block.heading_3.rich_text)}`);
                  break;
                case 'bulleted_list_item':
                  lines.push(`- ${richTextToString(block.bulleted_list_item.rich_text)}`);
                  break;
                case 'numbered_list_item':
                  lines.push(`1. ${richTextToString(block.numbered_list_item.rich_text)}`);
                  break;
                case 'quote':
                  lines.push(`> ${richTextToString(block.quote.rich_text)}`);
                  break;
                case 'code':
                  lines.push(`\`\`\`\n${richTextToString(block.code.rich_text)}\n\`\`\``);
                  break;
                case 'divider':
                  lines.push('---');
                  break;
                case 'to_do':
                  lines.push(`- [${block.to_do.checked ? 'x' : ' '}] ${richTextToString(block.to_do.rich_text)}`);
                  break;
                case 'toggle':
                  lines.push(`- ${richTextToString(block.toggle.rich_text)}`);
                  break;
                case 'callout':
                  lines.push(`> ${richTextToString(block.callout.rich_text)}`);
                  break;
                default:
                  break;
              }
            }

            const markdown = lines.join('\n\n');
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ markdown }));
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(e) }));
          }
        });
      });
    },
  };
}

function editorWebSocketBridge(): Plugin {
  return {
    name: 'editor-ws-bridge',
    configureServer(server) {
      server.httpServer?.on('listening', () => {
        const wss = new WebSocketServer({ noServer: true });

        let editorSocket: WsWebSocket | null = null;
        const mcpSockets = new Set<WsWebSocket>();

        wss.on('connection', (socket) => {
          console.log('[WS Bridge] New connection');

          socket.on('message', (raw) => {
            let msg: Record<string, unknown>;
            try {
              msg = JSON.parse(raw.toString());
            } catch {
              return;
            }

            // Registration message
            if (msg.type === 'register') {
              if (msg.role === 'editor') {
                editorSocket = socket;
                console.log('[WS Bridge] Editor registered');
              } else if (msg.role === 'mcp') {
                mcpSockets.add(socket);
                console.log('[WS Bridge] MCP client registered');
              }
              return;
            }

            // Messages from MCP → forward to editor
            if (mcpSockets.has(socket)) {
              if (editorSocket && editorSocket.readyState === 1) {
                editorSocket.send(raw.toString());
              } else {
                socket.send(JSON.stringify({
                  id: msg.id,
                  error: 'Editor is not connected',
                }));
              }
              return;
            }

            // Messages from editor → forward to the MCP client that sent the request
            if (socket === editorSocket && msg.id) {
              for (const mcp of mcpSockets) {
                if (mcp.readyState === 1) {
                  mcp.send(raw.toString());
                }
              }
            }
          });

          socket.on('close', () => {
            if (socket === editorSocket) {
              editorSocket = null;
              console.log('[WS Bridge] Editor disconnected');
            }
            mcpSockets.delete(socket);
          });
        });

        // Handle upgrade requests on /ws/editor
        server.httpServer!.on('upgrade', (request, socket, head) => {
          if (request.url === '/ws/editor') {
            wss.handleUpgrade(request, socket, head, (ws) => {
              wss.emit('connection', ws, request);
            });
          }
        });

        console.log('[WS Bridge] WebSocket bridge ready on /ws/editor');
      });
    },
  };
}

function transcribeProxy(): Plugin {
  return {
    name: 'transcribe-proxy',
    configureServer(server) {
      server.middlewares.use('/api/transcribe', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }

        const groqKey = process.env.GROQ_API_KEY;
        if (!groqKey) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: 'GROQ_API_KEY not set in environment' }));
          return;
        }

        // Collect raw body as Buffer
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', async () => {
          try {
            const rawBody = Buffer.concat(chunks);
            const contentType = req.headers['content-type'] || '';

            const response = await fetch(
              'https://api.groq.com/openai/v1/audio/transcriptions',
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${groqKey}`,
                  'Content-Type': contentType,
                },
                body: rawBody,
              }
            );

            const data = await response.text();
            res.setHeader('Content-Type', 'application/json');
            res.statusCode = response.status;
            res.end(data);
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(e) }));
          }
        });
      });
    },
  };
}

function claudeProxy(): Plugin {
  return {
    name: 'claude-proxy',
    configureServer(server) {
      server.middlewares.use('/api/claude', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }

        // Budget check against collab server
        try {
          const budgetRes = await fetch('http://localhost:8888/api/usage/check');
          if (budgetRes.ok) {
            const budget = await budgetRes.json() as { allowed: boolean; total_usd: number; limit_usd: number };
            if (!budget.allowed) {
              res.statusCode = 429;
              res.end(JSON.stringify({ error: `Budget limit reached ($${budget.total_usd.toFixed(2)} / $${budget.limit_usd.toFixed(2)})` }));
              return;
            }
          }
        } catch { /* collab server not running — allow */ }

        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        req.on('end', async () => {
          try {
            const { messages, system, max_tokens, stream } = JSON.parse(body);
            const apiKey = process.env.ANTHROPIC_API_KEY;

            if (!apiKey) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set in environment' }));
              return;
            }

            const response = await fetch(
              'https://api.anthropic.com/v1/messages',
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-api-key': apiKey,
                  'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify({
                  model: 'claude-sonnet-4-20250514',
                  max_tokens: max_tokens || 1024,
                  system,
                  messages,
                  stream: !!stream,
                }),
              }
            );

            if (stream && response.ok) {
              res.setHeader('Content-Type', 'text/event-stream');
              res.setHeader('Cache-Control', 'no-cache');
              res.setHeader('Connection', 'keep-alive');
              res.statusCode = 200;

              const reader = (response.body as any).getReader();
              const decoder = new TextDecoder();
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  res.write(decoder.decode(value, { stream: true }));
                }
              } catch {
                // client disconnected
              }
              res.end();
            } else {
              const data = await response.text();
              // Log usage to collab server
              if (response.ok) {
                try {
                  const parsed = JSON.parse(data);
                  if (parsed.usage) {
                    fetch('http://localhost:8888/api/usage/log', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.ADMIN_SECRET || 'change-me-in-production'}` },
                      body: JSON.stringify({ input_tokens: parsed.usage.input_tokens, output_tokens: parsed.usage.output_tokens, model: 'claude-sonnet-4-20250514' }),
                    }).catch(() => {});
                  }
                } catch { /* ignore */ }
              }
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = response.status;
              res.end(data);
            }
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(e) }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), importProxy(), transcribeProxy(), claudeProxy(), editorWebSocketBridge()],
  server: {
    port: 3000,
  },
  resolve: {
    dedupe: ['yjs'],
  },
});
