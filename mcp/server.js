#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_HOCUSPOCUS_URL = process.env.DRAFTS_SERVER_URL || 'wss://draft-collab-production.up.railway.app';
const DEFAULT_DOCUMENT = process.env.DRAFTS_DOCUMENT || 'default';

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
        console.error(`[Drafts] Synced to "${documentName}" at ${url}`);
        resolve();
      },
      onClose() {
        yjsConnected = false;
        console.error(`[Drafts] Disconnected from "${documentName}"`);
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
// Plate/slate-yjs stores the document as doc.get('content', Y.XmlText)
// NOT as an XmlFragment. The entire doc is a single XmlText with deltas.

/** Get the shared Y.XmlText root that Plate/Slate uses */
function getSharedRoot() {
  if (!yjsDoc) throw new Error('No document connected. Use connect_document first.');
  return yjsDoc.get('content', Y.XmlText);
}

/** Convert delta entries to plain text */
function deltaToPlainText(root) {
  const delta = root.toDelta();
  return delta.map((d) => {
    if (typeof d.insert === 'string') return d.insert;
    if (d.insert instanceof Y.XmlText) return deltaToPlainText(d.insert);
    return '';
  }).join('\n');
}

/** Convert delta to JSON nodes (simplified) */
function deltaToJson(root) {
  const delta = root.toDelta();
  return delta.map((d, i) => {
    if (d.insert instanceof Y.XmlText) {
      const childDelta = d.insert.toDelta();
      const children = childDelta.map((cd) => {
        if (typeof cd.insert === 'string') {
          const leaf = { text: cd.insert };
          if (cd.attributes) Object.assign(leaf, cd.attributes);
          return leaf;
        }
        return { text: '' };
      });
      const attrs = d.attributes || {};
      return { type: attrs.type || 'p', ...attrs, children: children.length ? children : [{ text: '' }] };
    }
    return { type: 'p', children: [{ text: typeof d.insert === 'string' ? d.insert : '' }] };
  });
}

/** Find text across all delta entries and replace it */
function findAndReplace(root, search, replacement, replaceAll = false) {
  let count = 0;
  const delta = root.toDelta();

  yjsDoc.transact(() => {
    // Build a flat offset map of all text positions
    let globalOffset = 0;
    for (const d of delta) {
      if (d.insert instanceof Y.XmlText) {
        const innerDelta = d.insert.toDelta();
        let innerOffset = 0;
        for (const cd of innerDelta) {
          if (typeof cd.insert === 'string') {
            let idx = cd.insert.indexOf(search);
            while (idx !== -1) {
              d.insert.delete(innerOffset + idx, search.length);
              d.insert.insert(innerOffset + idx, replacement);
              count++;
              if (!replaceAll) return;
              // Re-read after mutation
              const newStr = d.insert.toDelta().map(x => typeof x.insert === 'string' ? x.insert : '').join('');
              idx = newStr.indexOf(search, innerOffset + idx + replacement.length);
              if (idx === -1) break;
              innerOffset = 0; // reset since we re-read the whole thing
            }
          }
          if (typeof cd.insert === 'string') innerOffset += cd.insert.length;
        }
      }
      globalOffset++;
      if (!replaceAll && count > 0) return;
    }
  });

  return count;
}

/** Insert a text paragraph at the end */
function insertParagraph(root, text, type = 'p') {
  yjsDoc.transact(() => {
    const newBlock = new Y.XmlText();
    newBlock.insert(0, text);
    root.insertEmbed(root.length, newBlock, { type });
  });
}

/** Append text to the last paragraph */
function insertTextAtEnd(root, text) {
  const delta = root.toDelta();
  if (delta.length === 0) {
    insertParagraph(root, text);
    return;
  }
  const lastEntry = delta[delta.length - 1];
  if (lastEntry.insert instanceof Y.XmlText) {
    yjsDoc.transact(() => {
      const innerText = lastEntry.insert.toString();
      lastEntry.insert.insert(innerText.length, text);
    });
  } else {
    insertParagraph(root, text);
  }
}

/** Apply marks (bold, italic, etc.) to matching text */
function applyMarks(root, search, marks) {
  let count = 0;
  const delta = root.toDelta();

  yjsDoc.transact(() => {
    for (const d of delta) {
      if (d.insert instanceof Y.XmlText) {
        const str = d.insert.toString();
        let idx = str.indexOf(search);
        while (idx !== -1) {
          d.insert.format(idx, search.length, marks);
          count++;
          idx = str.indexOf(search, idx + search.length);
        }
      }
    }
  });

  return count;
}

// ── MCP Server ──────────────────────────────────────────────────────

const server = new McpServer({
  name: 'Drafts',
  version: '1.0.0',
});

/** Parse a Draft share URL like https://draft-blue.vercel.app/d/my-essay and return the document ID */
function parseShareUrl(shareUrl) {
  try {
    const parsed = new URL(shareUrl);
    const match = parsed.pathname.match(/^\/d\/(.+)$/);
    if (match) return decodeURIComponent(match[1]);
  } catch { /* not a valid URL */ }
  return null;
}

// 0. connect_document — connect to a document via Hocuspocus URL or Draft share URL
server.tool(
  'connect_document',
  `Connect to a collaborative document. You can pass a Draft share URL (e.g. https://draft-blue.vercel.app/d/my-essay) and the document ID will be extracted automatically. Or provide a Hocuspocus WebSocket URL and document name directly. Defaults to ${DEFAULT_HOCUSPOCUS_URL} if no URL provided.`,
  {
    url: z.string().optional().describe(`Draft share URL (e.g. https://draft-blue.vercel.app/d/my-essay) or Hocuspocus WebSocket URL (default: ${DEFAULT_HOCUSPOCUS_URL})`),
    document: z.string().optional().describe(`Document name/ID to connect to (default: "${DEFAULT_DOCUMENT}"). Ignored if a share URL is provided.`),
    name: z.string().optional().describe('Your display name (shown to other collaborators)'),
    color: z.string().optional().describe('Your cursor color as hex, e.g. #C66140'),
  },
  async ({ url, document: docName, name, color }) => {
    try {
      let serverUrl = DEFAULT_HOCUSPOCUS_URL;
      let documentName = docName || DEFAULT_DOCUMENT;

      // If url looks like a Draft share URL, parse the document ID from it
      if (url) {
        const parsedDocId = parseShareUrl(url);
        if (parsedDocId) {
          documentName = parsedDocId;
          // Use default Hocuspocus URL for share links
        } else if (url.startsWith('ws://') || url.startsWith('wss://')) {
          serverUrl = url;
        } else {
          // Try treating it as a share URL with just a path
          const withOrigin = parseShareUrl(`https://draft-blue.vercel.app${url.startsWith('/') ? '' : '/'}${url}`);
          if (withOrigin) {
            documentName = withOrigin;
          } else {
            serverUrl = url;
          }
        }
      }

      const token = JSON.stringify({
        name: name || 'MCP Agent',
        color: color || '#C66140',
        role: 'editor',
      });
      await connectToDocument(serverUrl, documentName, token);
      return {
        content: [{
          type: 'text',
          text: `Connected to "${documentName}" at ${serverUrl}. All editing tools now operate on this document.`,
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
  'Returns the full document as plain text and JSON structure. Requires connect_document first.',
  {},
  async () => {
    try {
      if (!yjsConnected || !yjsDoc) {
        return { content: [{ type: 'text', text: 'Error: No document connected. Use connect_document first.' }], isError: true };
      }
      const root = getSharedRoot();
      const text = deltaToPlainText(root);
      const json = deltaToJson(root);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ text, nodes: json, document: yjsDocName }, null, 2),
        }],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 2. edit_text
server.tool(
  'edit_text',
  'Find text in the document and replace it with new text',
  {
    search: z.string().describe('The text to find'),
    replacement: z.string().describe('The replacement text'),
  },
  async ({ search, replacement }) => {
    try {
      if (!yjsConnected || !yjsDoc) {
        return { content: [{ type: 'text', text: 'Error: No document connected. Use connect_document first.' }], isError: true };
      }
      const root = getSharedRoot();
      const count = findAndReplace(root, search, replacement, false);
      return {
        content: [{ type: 'text', text: JSON.stringify({ replaced: count }, null, 2) }],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 3. insert_text
server.tool(
  'insert_text',
  'Insert text at the end of the document (or into the last paragraph)',
  {
    text: z.string().describe('The text to insert'),
    position: z.string().optional().describe('Where to insert: "start", "end" (default: "end")'),
  },
  async ({ text, position }) => {
    try {
      if (!yjsConnected || !yjsDoc) {
        return { content: [{ type: 'text', text: 'Error: No document connected. Use connect_document first.' }], isError: true };
      }
      const root = getSharedRoot();
      if (position === 'start') {
        insertParagraph(root, text);
      } else {
        insertTextAtEnd(root, text);
      }
      return { content: [{ type: 'text', text: JSON.stringify({ inserted: true }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 4. insert_block
server.tool(
  'insert_block',
  'Insert a block element (paragraph, heading, blockquote, etc.)',
  {
    type: z.string().describe('Block type: p, h1, h2, h3, blockquote, hr'),
    text: z.string().optional().describe('Text content for the block'),
  },
  async ({ type, text }) => {
    try {
      if (!yjsConnected || !yjsDoc) {
        return { content: [{ type: 'text', text: 'Error: No document connected. Use connect_document first.' }], isError: true };
      }
      const root = getSharedRoot();
      insertParagraph(root, text || '', type);
      return { content: [{ type: 'text', text: JSON.stringify({ inserted: true, blockType: type }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 5. apply_formatting
server.tool(
  'apply_formatting',
  'Apply marks (bold, italic, underline, etc.) to found text',
  {
    search: z.string().describe('The text to format'),
    marks: z.record(z.boolean()).describe('Marks to apply, e.g. {"bold": true, "italic": true}'),
  },
  async ({ search, marks }) => {
    try {
      if (!yjsConnected || !yjsDoc) {
        return { content: [{ type: 'text', text: 'Error: No document connected. Use connect_document first.' }], isError: true };
      }
      const root = getSharedRoot();
      const count = applyMarks(root, search, marks);
      return { content: [{ type: 'text', text: JSON.stringify({ formatted: count }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 6. find_and_replace
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
      if (!yjsConnected || !yjsDoc) {
        return { content: [{ type: 'text', text: 'Error: No document connected. Use connect_document first.' }], isError: true };
      }
      const root = getSharedRoot();
      const count = findAndReplace(root, search, replacement, replaceAll !== false);
      return { content: [{ type: 'text', text: JSON.stringify({ replaced: count }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 7. get_word_count
server.tool(
  'get_word_count',
  'Returns word count, character count, and paragraph count',
  {},
  async () => {
    try {
      if (!yjsConnected || !yjsDoc) {
        return { content: [{ type: 'text', text: 'Error: No document connected. Use connect_document first.' }], isError: true };
      }
      const text = deltaToPlainText(getSharedRoot());
      const words = text.trim().split(/\s+/).filter(Boolean).length;
      const characters = text.length;
      const paragraphs = text.split('\n').filter((l) => l.trim()).length;
      return { content: [{ type: 'text', text: JSON.stringify({ words, characters, paragraphs }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 8. insert_image
server.tool(
  'insert_image',
  'Insert an image into the document',
  {
    url: z.string().describe('Image URL'),
    caption: z.string().optional().describe('Image caption'),
  },
  async ({ url, caption }) => {
    try {
      if (!yjsConnected || !yjsDoc) {
        return { content: [{ type: 'text', text: 'Error: No document connected. Use connect_document first.' }], isError: true };
      }
      const root = getSharedRoot();
      yjsDoc.transact(() => {
        const newBlock = new Y.XmlText();
        root.insertEmbed(root.length, newBlock, { type: 'img', url, caption: caption || '' });
      });
      return { content: [{ type: 'text', text: JSON.stringify({ inserted: true }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 9. connection_status
server.tool(
  'connection_status',
  'Check the current connection status to the document',
  {},
  async () => {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          connected: yjsConnected,
          document: yjsDocName,
          server: yjsServerUrl,
        }, null, 2),
      }],
    };
  }
);

// ── Start ───────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[Drafts] MCP server started');
console.error('[Drafts] Use connect_document to connect to a document');
