import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import WebSocket from 'ws';

// ── WebSocket connection to the editor ──────────────────────────────

let ws = null;
let connected = false;
const pending = new Map(); // id → { resolve, reject, timer }
let messageId = 0;

function connectToEditor() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  ws = new WebSocket('ws://localhost:3000/ws/editor');

  ws.on('open', () => {
    connected = true;
    ws.send(JSON.stringify({ type: 'register', role: 'mcp' }));
    console.error('[MCP] Connected to editor WebSocket bridge');
  });

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) {
        p.reject(new Error(msg.error));
      } else {
        p.resolve(msg.result);
      }
    }
  });

  ws.on('close', () => {
    connected = false;
    console.error('[MCP] WebSocket disconnected, reconnecting in 2s...');
    setTimeout(connectToEditor, 2000);
  });

  ws.on('error', (err) => {
    console.error('[MCP] WebSocket error:', err.message);
  });
}

function sendCommand(type, params = {}, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (!connected || !ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('Not connected to editor. Make sure the Vite dev server is running and the editor is open in a browser.'));
      return;
    }
    const id = String(++messageId);
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Timed out waiting for editor response'));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, type, ...params }));
  });
}

// ── MCP Server ──────────────────────────────────────────────────────

const server = new McpServer({
  name: 'draft-editor',
  version: '1.0.0',
});

// 1. read_document
server.tool(
  'read_document',
  'Returns the full document as JSON and as plain text',
  {},
  async () => {
    try {
      const result = await sendCommand('get_document');
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 2. read_selection
server.tool(
  'read_selection',
  'Returns the currently selected text and selection range',
  {},
  async () => {
    try {
      const result = await sendCommand('get_selection');
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 3. edit_text
server.tool(
  'edit_text',
  'Find text in the document and replace it with new text. Preserves surrounding formatting.',
  {
    search: z.string().describe('The text to find in the document'),
    replacement: z.string().describe('The text to replace it with'),
  },
  async ({ search, replacement }) => {
    try {
      const result = await sendCommand('replace_text', { search, replacement, replaceAll: false });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 4. insert_text
server.tool(
  'insert_text',
  'Insert text at a specific position in the document',
  {
    text: z.string().describe('The text to insert'),
    position: z.string().optional().describe('Where to insert: "start", "end", "after_selection", or a path like "0,1"'),
  },
  async ({ text, position }) => {
    try {
      const result = await sendCommand('insert_text', { text, position: position || 'end' });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 5. insert_block
server.tool(
  'insert_block',
  'Insert a block element (paragraph, heading, blockquote, etc.)',
  {
    type: z.string().describe('Block type: p, h1, h2, h3, blockquote, hr, etc.'),
    text: z.string().optional().describe('Text content for the block'),
    position: z.string().optional().describe('Where to insert: "start", "end", or a path like "2"'),
  },
  async ({ type, text, position }) => {
    try {
      const node = { type, children: [{ text: text || '' }] };
      const result = await sendCommand('insert_node', { node, position: position || 'end' });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 6. apply_formatting
server.tool(
  'apply_formatting',
  'Apply marks (bold, italic, underline, etc.) to found text',
  {
    search: z.string().describe('The text to format'),
    marks: z.record(z.boolean()).describe('Marks to apply, e.g. {"bold": true, "italic": true}'),
  },
  async ({ search, marks }) => {
    try {
      const result = await sendCommand('set_marks', { search, marks });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 7. find_and_replace
server.tool(
  'find_and_replace',
  'Find all occurrences of text and replace them',
  {
    search: z.string().describe('Text to find'),
    replacement: z.string().describe('Text to replace with'),
    replaceAll: z.boolean().optional().describe('Replace all occurrences (default: true)'),
  },
  async ({ search, replacement, replaceAll }) => {
    try {
      const result = await sendCommand('replace_text', {
        search,
        replacement,
        replaceAll: replaceAll !== false,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 8. insert_citation
server.tool(
  'insert_citation',
  'Insert a citation link into the document',
  {
    text: z.string().describe('The text to associate with the citation'),
    source: z.string().describe('Source title'),
    authors: z.string().optional().describe('Authors'),
    year: z.string().optional().describe('Publication year'),
    url: z.string().optional().describe('URL of the source'),
  },
  async ({ text, source, authors, year, url }) => {
    try {
      // Insert a citation as a linked text block
      const citationText = `[${text}] (${authors ? authors + ', ' : ''}${source}${year ? ', ' + year : ''})`;
      const node = {
        type: 'p',
        children: url
          ? [{ type: 'a', url, children: [{ text: citationText }] }]
          : [{ text: citationText }],
      };
      const result = await sendCommand('insert_node', { node, position: 'end' });
      return {
        content: [{ type: 'text', text: JSON.stringify({ ...result, citation: { text, source, authors, year, url } }, null, 2) }],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 9. get_word_count
server.tool(
  'get_word_count',
  'Returns the word count of the document',
  {},
  async () => {
    try {
      const result = await sendCommand('get_text');
      const text = result.text || '';
      const words = text.trim().split(/\s+/).filter(Boolean).length;
      const characters = text.length;
      const paragraphs = text.split('\n').filter((l) => l.trim()).length;
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ words, characters, paragraphs }, null, 2),
          },
        ],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 10. insert_image
server.tool(
  'insert_image',
  'Insert an image into the document',
  {
    url: z.string().describe('Image URL'),
    caption: z.string().optional().describe('Image caption'),
  },
  async ({ url, caption }) => {
    try {
      const node = {
        type: 'img',
        url,
        caption: caption ? [{ text: caption }] : undefined,
        children: [{ text: '' }],
      };
      const result = await sendCommand('insert_node', { node, position: 'end' });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 11. add_comment
server.tool(
  'add_comment',
  'Add an inline comment/annotation to specific text in the document. The comment will be highlighted and visible as a marginal note.',
  {
    search: z.string().describe('The exact text to attach the comment to'),
    comment: z.string().describe('The comment/annotation text'),
    author: z.string().optional().describe('Author name (defaults to "MCP")'),
  },
  async ({ search, comment, author }) => {
    try {
      const result = await sendCommand('add_comment', { search, comment, author });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Start ───────────────────────────────────────────────────────────

connectToEditor();

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[MCP] Draft editor MCP server started (stdio transport)');
