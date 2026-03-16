import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';

// ── Yjs document connection (via Hocuspocus) ────────────────────────

let yjsDoc = null;       // Y.Doc instance
let yjsProvider = null;  // HocuspocusProvider
let yjsConnected = false;
let yjsDocName = null;
let yjsServerUrl = null;

function connectToDocument(url, documentName, token) {
  return new Promise((resolve, reject) => {
    // Disconnect existing connection
    if (yjsProvider) {
      yjsProvider.destroy();
      yjsProvider = null;
    }

    yjsDoc = new Y.Doc();
    yjsServerUrl = url;
    yjsDocName = documentName;

    yjsProvider = new HocuspocusProvider({
      url,
      name: documentName,
      document: yjsDoc,
      token: token || JSON.stringify({ name: 'MCP Agent', color: '#C66140', role: 'editor' }),
      WebSocketPolyfill: WebSocket,
      onSynced() {
        yjsConnected = true;
        console.error(`[MCP/Yjs] Synced to "${documentName}" at ${url}`);
        resolve();
      },
      onClose() {
        yjsConnected = false;
        console.error(`[MCP/Yjs] Disconnected from "${documentName}"`);
      },
      onDestroy() {
        yjsConnected = false;
      },
    });

    // Timeout after 10s
    setTimeout(() => {
      if (!yjsConnected) {
        reject(new Error(`Timed out connecting to ${url} document "${documentName}"`));
      }
    }, 10000);
  });
}

// ── Yjs ↔ Slate helpers ─────────────────────────────────────────────

/** Get the shared XML fragment that Plate/Slate uses */
function getSharedRoot() {
  if (!yjsDoc) throw new Error('No document connected. Use connect_document first.');
  return yjsDoc.getXmlFragment('content');
}

/** Convert a Yjs XML fragment to plain text */
function xmlToPlainText(xml) {
  let text = '';
  for (let i = 0; i < xml.length; i++) {
    const child = xml.get(i);
    if (child instanceof Y.XmlText) {
      text += child.toString();
    } else if (child instanceof Y.XmlElement) {
      text += xmlToPlainText(child) + '\n';
    }
  }
  return text;
}

/** Convert a Yjs XML fragment to a simplified JSON representation */
function xmlToJson(xml) {
  const nodes = [];
  for (let i = 0; i < xml.length; i++) {
    const child = xml.get(i);
    if (child instanceof Y.XmlText) {
      nodes.push({ text: child.toString() });
    } else if (child instanceof Y.XmlElement) {
      const attrs = child.getAttributes();
      const node = { type: attrs.type || child.nodeName, ...attrs };
      delete node.type;
      node.type = attrs.type || child.nodeName;
      const children = xmlToJson(child);
      if (children.length > 0) {
        node.children = children;
      } else {
        node.children = [{ text: '' }];
      }
      nodes.push(node);
    }
  }
  return nodes;
}

/** Find text in the Yjs XML tree and replace it */
function findAndReplace(xml, search, replacement, replaceAll = false) {
  let count = 0;

  function walk(element) {
    for (let i = 0; i < element.length; i++) {
      const child = element.get(i);
      if (child instanceof Y.XmlText) {
        let str = child.toString();
        let idx = str.indexOf(search);
        while (idx !== -1) {
          child.delete(idx, search.length);
          child.insert(idx, replacement);
          count++;
          if (!replaceAll) return;
          str = child.toString();
          idx = str.indexOf(search, idx + replacement.length);
        }
      } else if (child instanceof Y.XmlElement) {
        walk(child);
        if (!replaceAll && count > 0) return;
      }
    }
  }

  yjsDoc.transact(() => walk(xml));
  return count;
}

/** Insert a text paragraph at the end of the document */
function insertParagraph(xml, text, type = 'p') {
  yjsDoc.transact(() => {
    const el = new Y.XmlElement('element');
    el.setAttribute('type', type);
    const textNode = new Y.XmlText();
    textNode.insert(0, text);
    el.insert(0, [textNode]);
    xml.insert(xml.length, [el]);
  });
}

/** Insert text at a position in the first matching text node */
function insertTextAtEnd(xml, text) {
  yjsDoc.transact(() => {
    // Find the last text node
    const lastChild = xml.length > 0 ? xml.get(xml.length - 1) : null;
    if (lastChild instanceof Y.XmlElement) {
      for (let i = lastChild.length - 1; i >= 0; i--) {
        const child = lastChild.get(i);
        if (child instanceof Y.XmlText) {
          child.insert(child.toString().length, text);
          return;
        }
      }
    }
    // Fallback: insert as new paragraph
    insertParagraph(xml, text);
  });
}

/** Apply marks to matching text */
function applyMarks(xml, search, marks) {
  let count = 0;

  function walk(element) {
    for (let i = 0; i < element.length; i++) {
      const child = element.get(i);
      if (child instanceof Y.XmlText) {
        const str = child.toString();
        let idx = str.indexOf(search);
        while (idx !== -1) {
          for (const [mark, value] of Object.entries(marks)) {
            child.format(idx, search.length, { [mark]: value || null });
          }
          count++;
          idx = str.indexOf(search, idx + search.length);
        }
      } else if (child instanceof Y.XmlElement) {
        walk(child);
      }
    }
  }

  yjsDoc.transact(() => walk(xml));
  return count;
}

// ── Legacy WebSocket connection to the browser ──────────────────────

let ws = null;
let connected = false;
const pending = new Map();
let messageId = 0;

function connectToEditor() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  ws = new WebSocket('ws://localhost:3000/ws/editor');

  ws.on('open', () => {
    connected = true;
    ws.send(JSON.stringify({ type: 'register', role: 'mcp' }));
    console.error('[MCP/WS] Connected to editor WebSocket bridge');
  });

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.result);
    }
  });

  ws.on('close', () => {
    connected = false;
    console.error('[MCP/WS] Disconnected, reconnecting in 2s...');
    setTimeout(connectToEditor, 2000);
  });

  ws.on('error', (err) => {
    console.error('[MCP/WS] Error:', err.message);
  });
}

function sendCommand(type, params = {}, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (!connected || !ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('Not connected to editor browser. Make sure Vite dev server is running and editor is open.'));
      return;
    }
    const id = String(++messageId);
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Timed out')); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, type, ...params }));
  });
}

// ── Routing: prefer Yjs if connected, fall back to WS bridge ────────

function useYjs() {
  return yjsConnected && yjsDoc;
}

// ── MCP Server ──────────────────────────────────────────────────────

const server = new McpServer({
  name: 'draft-editor',
  version: '2.0.0',
});

// 0. connect_document — connect to a document via Hocuspocus URL
server.tool(
  'connect_document',
  'Connect to a collaborative document via Hocuspocus. Once connected, all editing tools work on this document. The URL should be a Hocuspocus WebSocket URL (e.g. ws://localhost:8888) and the document name identifies which document to open.',
  {
    url: z.string().describe('Hocuspocus WebSocket URL, e.g. ws://localhost:8888 or wss://draft-collab.fly.dev'),
    document: z.string().describe('Document name/ID to connect to'),
    name: z.string().optional().describe('Your display name (shown to other collaborators)'),
    color: z.string().optional().describe('Your cursor color as hex, e.g. #C66140'),
  },
  async ({ url, document: docName, name, color }) => {
    try {
      const token = JSON.stringify({
        name: name || 'MCP Agent',
        color: color || '#C66140',
        role: 'editor',
      });
      await connectToDocument(url, docName, token);
      return {
        content: [{
          type: 'text',
          text: `Connected to "${docName}" at ${url}. All editing tools now operate on this document.`,
        }],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 1. read_document
server.tool(
  'read_document',
  'Returns the full document as plain text and JSON structure',
  {},
  async () => {
    try {
      if (useYjs()) {
        const root = getSharedRoot();
        const text = xmlToPlainText(root);
        const json = xmlToJson(root);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ text, nodes: json, source: 'yjs', document: yjsDocName }, null, 2),
          }],
        };
      }
      const result = await sendCommand('get_document');
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 2. read_selection (browser-only — needs live editor)
server.tool(
  'read_selection',
  'Returns the currently selected text and selection range (requires browser editor open)',
  {},
  async () => {
    try {
      const result = await sendCommand('get_selection');
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 3. edit_text
server.tool(
  'edit_text',
  'Find text in the document and replace it with new text',
  {
    search: z.string().describe('The text to find'),
    replacement: z.string().describe('The replacement text'),
  },
  async ({ search, replacement }) => {
    try {
      if (useYjs()) {
        const root = getSharedRoot();
        const count = findAndReplace(root, search, replacement, false);
        return {
          content: [{ type: 'text', text: JSON.stringify({ replaced: count, source: 'yjs' }, null, 2) }],
        };
      }
      const result = await sendCommand('replace_text', { search, replacement, replaceAll: false });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 4. insert_text
server.tool(
  'insert_text',
  'Insert text at the end of the document (or into the last paragraph)',
  {
    text: z.string().describe('The text to insert'),
    position: z.string().optional().describe('Where to insert: "start", "end" (default: "end")'),
  },
  async ({ text, position }) => {
    try {
      if (useYjs()) {
        const root = getSharedRoot();
        if (position === 'start') {
          insertParagraph(root, text);
        } else {
          insertTextAtEnd(root, text);
        }
        return { content: [{ type: 'text', text: JSON.stringify({ inserted: true, source: 'yjs' }, null, 2) }] };
      }
      const result = await sendCommand('insert_text', { text, position: position || 'end' });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
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
    type: z.string().describe('Block type: p, h1, h2, h3, blockquote, hr'),
    text: z.string().optional().describe('Text content for the block'),
  },
  async ({ type, text }) => {
    try {
      if (useYjs()) {
        const root = getSharedRoot();
        insertParagraph(root, text || '', type);
        return { content: [{ type: 'text', text: JSON.stringify({ inserted: true, blockType: type, source: 'yjs' }, null, 2) }] };
      }
      const node = { type, children: [{ text: text || '' }] };
      const result = await sendCommand('insert_node', { node, position: 'end' });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
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
      if (useYjs()) {
        const root = getSharedRoot();
        const count = applyMarks(root, search, marks);
        return { content: [{ type: 'text', text: JSON.stringify({ formatted: count, source: 'yjs' }, null, 2) }] };
      }
      const result = await sendCommand('set_marks', { search, marks });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
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
      if (useYjs()) {
        const root = getSharedRoot();
        const count = findAndReplace(root, search, replacement, replaceAll !== false);
        return { content: [{ type: 'text', text: JSON.stringify({ replaced: count, source: 'yjs' }, null, 2) }] };
      }
      const result = await sendCommand('replace_text', { search, replacement, replaceAll: replaceAll !== false });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 8. get_word_count
server.tool(
  'get_word_count',
  'Returns word count, character count, and paragraph count',
  {},
  async () => {
    try {
      let text;
      if (useYjs()) {
        text = xmlToPlainText(getSharedRoot());
      } else {
        const result = await sendCommand('get_text');
        text = result.text || '';
      }
      const words = text.trim().split(/\s+/).filter(Boolean).length;
      const characters = text.length;
      const paragraphs = text.split('\n').filter((l) => l.trim()).length;
      return { content: [{ type: 'text', text: JSON.stringify({ words, characters, paragraphs }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 9. insert_image
server.tool(
  'insert_image',
  'Insert an image into the document',
  {
    url: z.string().describe('Image URL'),
    caption: z.string().optional().describe('Image caption'),
  },
  async ({ url, caption }) => {
    try {
      if (useYjs()) {
        const root = getSharedRoot();
        yjsDoc.transact(() => {
          const el = new Y.XmlElement('element');
          el.setAttribute('type', 'img');
          el.setAttribute('url', url);
          if (caption) el.setAttribute('caption', caption);
          const textNode = new Y.XmlText();
          el.insert(0, [textNode]);
          root.insert(root.length, [el]);
        });
        return { content: [{ type: 'text', text: JSON.stringify({ inserted: true, source: 'yjs' }, null, 2) }] };
      }
      const node = { type: 'img', url, caption: caption ? [{ text: caption }] : undefined, children: [{ text: '' }] };
      const result = await sendCommand('insert_node', { node, position: 'end' });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 10. connection_status
server.tool(
  'connection_status',
  'Check the current connection status to both the Yjs document and the browser editor',
  {},
  async () => {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          yjs: {
            connected: yjsConnected,
            document: yjsDocName,
            server: yjsServerUrl,
          },
          browser: {
            connected,
          },
        }, null, 2),
      }],
    };
  }
);

// ── Start ───────────────────────────────────────────────────────────

connectToEditor();

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[MCP] Draft editor MCP server v2 started');
console.error('[MCP] Use connect_document tool to connect to a Hocuspocus document');
