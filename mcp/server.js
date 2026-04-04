#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import * as Y from 'yjs';
import { createClient } from '@supabase/supabase-js';
import { createEditor, Transforms, Editor, Node, Text } from 'slate';
import { withYjs, YjsEditor } from '@slate-yjs/core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ── Constants ────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, 'dist');
const DRAFT_APP_URL = process.env.DRAFT_APP_URL || 'https://draft-blue.vercel.app';
const RESOURCE_URI = 'ui://drafts/document-preview.html';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://epoviaqcrixushetuoze.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVwb3ZpYXFjcml4dXNoZXR1b3plIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMTQ0NTIsImV4cCI6MjA5MDc5MDQ1Mn0.j2u_34so_xCunG2HhRgqeniTv92WFiw9wGjFjZuPnT8';
const DEFAULT_DOCUMENT = process.env.DRAFTS_DOCUMENT || 'default';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Yjs document connection (via Supabase Realtime) ─────────────────

let yjsDoc = null;       // Y.Doc instance
let yjsChannel = null;   // Supabase Realtime channel
let yjsConnected = false;
let yjsDocName = null;
let clientId = Math.random().toString(36).slice(2, 10);
let saveTimer = null;

/** Encode Uint8Array as base64 */
function toBase64(data) {
  return Buffer.from(data).toString('base64');
}

/** Decode base64 to Uint8Array */
function fromBase64(b64) {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

async function connectToDocument(url, documentName) {
  // Disconnect existing connection
  if (yjsChannel) {
    supabase.removeChannel(yjsChannel);
    yjsChannel = null;
  }
  if (yjsDoc) {
    yjsDoc.off('update', handleDocUpdate);
    yjsDoc.destroy();
  }

  yjsDoc = new Y.Doc();
  yjsDocName = documentName;

  // 1. Load persisted state from Supabase
  const { data } = await supabase
    .from('documents')
    .select('yjs_state')
    .eq('id', documentName)
    .single();

  if (data?.yjs_state) {
    try {
      const bytes = fromBase64(data.yjs_state);
      Y.applyUpdate(yjsDoc, bytes, 'load');
      console.error(`[Drafts] Loaded state for "${documentName}" (${data.yjs_state.length} bytes)`);
    } catch (err) {
      console.error(`[Drafts] Failed to load state:`, err.message);
    }
  }

  // 2. Listen for local changes → broadcast + persist
  yjsDoc.on('update', handleDocUpdate);

  // 3. Join Supabase Realtime broadcast channel
  yjsChannel = supabase.channel(`doc-${documentName}`, {
    config: { broadcast: { self: false } },
  });

  yjsChannel.on('broadcast', { event: 'yjs-update' }, (payload) => {
    if (payload.payload?.clientId === clientId) return;
    try {
      const update = fromBase64(payload.payload.update);
      Y.applyUpdate(yjsDoc, update, 'remote');
    } catch (err) {
      console.error('[Drafts] Failed to apply remote update:', err.message);
    }
  });

  return new Promise((resolve, reject) => {
    yjsChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        yjsConnected = true;
        console.error(`[Drafts] Connected to doc-${documentName} via Supabase Realtime`);
        resolve();
      } else if (status === 'CHANNEL_ERROR') {
        console.error(`[Drafts] Channel error for doc-${documentName}`);
        // Still resolve — persistence works even without broadcast
        yjsConnected = true;
        resolve();
      }
    });

    setTimeout(() => {
      if (!yjsConnected) {
        reject(new Error(`Timed out connecting to document "${documentName}"`));
      }
    }, 10000);
  });
}

/** Handle local Y.Doc updates — broadcast and schedule persist */
function handleDocUpdate(update, origin) {
  if (origin === 'remote' || origin === 'load') return;

  // Broadcast via Supabase Realtime
  if (yjsChannel) {
    yjsChannel.send({
      type: 'broadcast',
      event: 'yjs-update',
      payload: { update: toBase64(update), clientId },
    });
  }

  // Debounced persist (3s)
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveState(), 3000);
}

/** Persist Y.Doc state to Supabase */
async function saveState() {
  if (!yjsDoc || !yjsDocName) return;
  const state = Y.encodeStateAsUpdate(yjsDoc);
  const b64 = toBase64(state);
  const { error } = await supabase
    .from('documents')
    .upsert(
      { id: yjsDocName, yjs_state: b64, title: 'Untitled Document', updated_at: new Date().toISOString() },
      { onConflict: 'id', ignoreDuplicates: false },
    );
  if (error) console.error('[Drafts] Save error:', error.message);
  else console.error(`[Drafts] Saved state for "${yjsDocName}"`);
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

// ── Headless Slate editor helper ─────────────────────────────────────

async function withHeadlessEditor(fn) {
  if (!yjsConnected || !yjsDoc) throw new Error('No document connected');
  const sharedRoot = getSharedRoot();
  const editor = withYjs(createEditor(), sharedRoot);
  YjsEditor.connect(editor);
  await new Promise(r => setTimeout(r, 200)); // let sync complete
  try {
    return fn(editor);
  } finally {
    YjsEditor.disconnect(editor);
  }
}

// ── MCP Server ──────────────────────────────────────────────────────

const server = new McpServer({
  name: 'Drafts',
  version: '1.0.0',
});

// Log whether the host supports MCP Apps
server.server.oninitialized = () => {
  const caps = server.server.getClientCapabilities();
  const uiExt = caps?.extensions?.['io.modelcontextprotocol/ui'];
  if (uiExt) {
    console.error('[Drafts] Host supports MCP Apps:', JSON.stringify(uiExt));
  } else {
    console.error('[Drafts] Host does NOT support MCP Apps — document preview will not render');
    console.error('[Drafts] Client capabilities:', JSON.stringify(caps));
  }
};

/** Parse a Draft share URL like https://draft-blue.vercel.app/d/my-essay and return the document ID */
function parseShareUrl(shareUrl) {
  try {
    const parsed = new URL(shareUrl);
    const match = parsed.pathname.match(/^\/d\/(.+)$/);
    if (match) return decodeURIComponent(match[1]);
  } catch { /* not a valid URL */ }
  return null;
}

// 0. connect_document — connect to a document via Supabase
//    Registered as an MCP App tool to show a live document preview
registerAppTool(
  server,
  'connect_document',
  {
    title: 'Connect to Document',
    description: `Connect to a collaborative document. You can pass a Draft share URL (e.g. https://draft-blue.vercel.app/d/my-essay) and the document ID will be extracted automatically. Or provide a document name directly. Defaults to "${DEFAULT_DOCUMENT}" if nothing provided.`,
    inputSchema: {
      url: z.string().optional().describe('Draft share URL (e.g. https://draft-blue.vercel.app/d/my-essay)'),
      document: z.string().optional().describe(`Document name/ID to connect to (default: "${DEFAULT_DOCUMENT}"). Ignored if a share URL is provided.`),
    },
    _meta: { ui: { resourceUri: RESOURCE_URI } },
  },
  async ({ url, document: docName }) => {
    try {
      let documentName = docName || DEFAULT_DOCUMENT;

      // If url looks like a Draft share URL, parse the document ID from it
      if (url) {
        const parsedDocId = parseShareUrl(url);
        if (parsedDocId) {
          documentName = parsedDocId;
        } else {
          // Try treating it as a share URL with just a path
          const withOrigin = parseShareUrl(`https://draft-blue.vercel.app${url.startsWith('/') ? '' : '/'}${url}`);
          if (withOrigin) {
            documentName = withOrigin;
          }
        }
      }

      await connectToDocument(SUPABASE_URL, documentName);

      const editorUrl = `${DRAFT_APP_URL}/d/${encodeURIComponent(documentName)}?embed`;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            connected: true,
            document: documentName,
            server: 'supabase',
            editorUrl,
          }),
        }],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 0b. create_document — create a new document with a random ID
registerAppTool(
  server,
  'create_document',
  {
    title: 'Create Document',
    description: 'Create a new document with a random ID. Optionally pre-populate with a title and content.',
    inputSchema: {
      title: z.string().optional().describe('Optional document title (inserted as an h1 heading)'),
      content: z.string().optional().describe('Optional initial content to populate the document with. Each line becomes a paragraph.'),
    },
    _meta: { ui: { resourceUri: RESOURCE_URI } },
  },
  async ({ title, content }) => {
    try {
      // Generate random 10-character lowercase alphanumeric ID
      const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
      let documentId = '';
      for (let i = 0; i < 10; i++) {
        documentId += chars[Math.floor(Math.random() * chars.length)];
      }

      await connectToDocument(SUPABASE_URL, documentId);

      // Wait a moment for the document to be ready
      await new Promise(r => setTimeout(r, 300));

      const root = getSharedRoot();

      // Insert title as h1 if provided
      if (title) {
        insertParagraph(root, title, 'h1');
      }

      // Insert content as paragraphs if provided
      if (content) {
        const lines = content.split('\n');
        for (const line of lines) {
          insertParagraph(root, line);
        }
      }

      const editorUrl = `${DRAFT_APP_URL}/d/${encodeURIComponent(documentId)}`;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            created: true,
            document: documentId,
            editorUrl,
            message: `Document "${documentId}" created successfully.`,
          }),
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
          server: 'supabase',
        }, null, 2),
      }],
    };
  }
);

// 10. insert_page_break
server.tool(
  'insert_page_break',
  'Insert a page break at the end of the document',
  {},
  async () => {
    try {
      if (!yjsConnected || !yjsDoc) {
        return { content: [{ type: 'text', text: 'Error: No document connected. Use connect_document first.' }], isError: true };
      }
      return await withHeadlessEditor((editor) => {
        Transforms.insertNodes(editor, { type: 'page_break', children: [{ text: '' }] }, { at: [editor.children.length] });
        return { content: [{ type: 'text', text: JSON.stringify({ inserted: true, blockType: 'page_break' }) }] };
      });
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 11. insert_horizontal_rule
server.tool(
  'insert_horizontal_rule',
  'Insert a horizontal rule at the end of the document',
  {},
  async () => {
    try {
      if (!yjsConnected || !yjsDoc) {
        return { content: [{ type: 'text', text: 'Error: No document connected. Use connect_document first.' }], isError: true };
      }
      return await withHeadlessEditor((editor) => {
        Transforms.insertNodes(editor, { type: 'hr', children: [{ text: '' }] }, { at: [editor.children.length] });
        return { content: [{ type: 'text', text: JSON.stringify({ inserted: true, blockType: 'hr' }) }] };
      });
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 12. set_block_type
server.tool(
  'set_block_type',
  'Change the type of a block element (e.g. paragraph to heading). Finds the block containing the search text and changes its type.',
  {
    search: z.string().describe('Text to locate the block'),
    type: z.string().describe('New block type: p, h1, h2, h3, blockquote'),
  },
  async ({ search, type }) => {
    try {
      if (!yjsConnected || !yjsDoc) {
        return { content: [{ type: 'text', text: 'Error: No document connected. Use connect_document first.' }], isError: true };
      }
      return await withHeadlessEditor((editor) => {
        for (const [node, path] of Node.nodes(editor)) {
          if (!Text.isText(node)) continue;
          if (node.text.includes(search)) {
            // Get the top-level block path
            const blockPath = [path[0]];
            Transforms.setNodes(editor, { type }, { at: blockPath });
            return { content: [{ type: 'text', text: JSON.stringify({ updated: true, path: blockPath, newType: type }) }] };
          }
        }
        return { content: [{ type: 'text', text: JSON.stringify({ updated: false, reason: 'Text not found' }) }] };
      });
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 13. set_text_style
server.tool(
  'set_text_style',
  'Set font family and/or font size on matching text using format marks',
  {
    search: z.string().describe('The text to style'),
    fontFamily: z.string().optional().describe('Font family name, e.g. "Georgia"'),
    fontSize: z.string().optional().describe('Font size, e.g. "18px"'),
  },
  async ({ search, fontFamily, fontSize }) => {
    try {
      if (!yjsConnected || !yjsDoc) {
        return { content: [{ type: 'text', text: 'Error: No document connected. Use connect_document first.' }], isError: true };
      }
      const root = getSharedRoot();
      const marks = {};
      if (fontFamily) marks.fontFamily = fontFamily;
      if (fontSize) marks.fontSize = fontSize;
      if (Object.keys(marks).length === 0) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'No style properties provided' }) }] };
      }
      const count = applyMarks(root, search, marks);
      return { content: [{ type: 'text', text: JSON.stringify({ styled: count, marks }) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 14. set_alignment
server.tool(
  'set_alignment',
  'Set the text alignment of a block containing the search text',
  {
    search: z.string().describe('Text to locate the block'),
    align: z.enum(['left', 'center', 'right', 'justify']).describe('Alignment value'),
  },
  async ({ search, align }) => {
    try {
      if (!yjsConnected || !yjsDoc) {
        return { content: [{ type: 'text', text: 'Error: No document connected. Use connect_document first.' }], isError: true };
      }
      return await withHeadlessEditor((editor) => {
        for (const [node, path] of Node.nodes(editor)) {
          if (!Text.isText(node)) continue;
          if (node.text.includes(search)) {
            const blockPath = [path[0]];
            Transforms.setNodes(editor, { align }, { at: blockPath });
            return { content: [{ type: 'text', text: JSON.stringify({ updated: true, path: blockPath, align }) }] };
          }
        }
        return { content: [{ type: 'text', text: JSON.stringify({ updated: false, reason: 'Text not found' }) }] };
      });
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 15. set_line_spacing
server.tool(
  'set_line_spacing',
  'Set the line spacing of a block containing the search text',
  {
    search: z.string().describe('Text to locate the block'),
    spacing: z.string().describe('Line spacing value, e.g. "1", "1.5", "2"'),
  },
  async ({ search, spacing }) => {
    try {
      if (!yjsConnected || !yjsDoc) {
        return { content: [{ type: 'text', text: 'Error: No document connected. Use connect_document first.' }], isError: true };
      }
      return await withHeadlessEditor((editor) => {
        for (const [node, path] of Node.nodes(editor)) {
          if (!Text.isText(node)) continue;
          if (node.text.includes(search)) {
            const blockPath = [path[0]];
            Transforms.setNodes(editor, { lineSpacing: spacing }, { at: blockPath });
            return { content: [{ type: 'text', text: JSON.stringify({ updated: true, path: blockPath, lineSpacing: spacing }) }] };
          }
        }
        return { content: [{ type: 'text', text: JSON.stringify({ updated: false, reason: 'Text not found' }) }] };
      });
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 16. delete_block
server.tool(
  'delete_block',
  'Delete a block element containing the search text',
  {
    search: z.string().describe('Text in the block to delete'),
  },
  async ({ search }) => {
    try {
      if (!yjsConnected || !yjsDoc) {
        return { content: [{ type: 'text', text: 'Error: No document connected. Use connect_document first.' }], isError: true };
      }
      return await withHeadlessEditor((editor) => {
        for (const [node, path] of Node.nodes(editor)) {
          if (!Text.isText(node)) continue;
          if (node.text.includes(search)) {
            const blockPath = [path[0]];
            Transforms.removeNodes(editor, { at: blockPath });
            return { content: [{ type: 'text', text: JSON.stringify({ deleted: true, path: blockPath }) }] };
          }
        }
        return { content: [{ type: 'text', text: JSON.stringify({ deleted: false, reason: 'Text not found' }) }] };
      });
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 17. move_block
server.tool(
  'move_block',
  'Move a block to a new position in the document',
  {
    search: z.string().describe('Text in the block to move'),
    to: z.union([z.number(), z.enum(['start', 'end'])]).describe('Target position: index number, "start", or "end"'),
  },
  async ({ search, to }) => {
    try {
      if (!yjsConnected || !yjsDoc) {
        return { content: [{ type: 'text', text: 'Error: No document connected. Use connect_document first.' }], isError: true };
      }
      return await withHeadlessEditor((editor) => {
        for (const [node, path] of Node.nodes(editor)) {
          if (!Text.isText(node)) continue;
          if (node.text.includes(search)) {
            const blockPath = [path[0]];
            let targetPath;
            if (to === 'start') {
              targetPath = [0];
            } else if (to === 'end') {
              targetPath = [editor.children.length];
            } else {
              targetPath = [to];
            }
            Transforms.moveNodes(editor, { at: blockPath, to: targetPath });
            return { content: [{ type: 'text', text: JSON.stringify({ moved: true, from: blockPath, to: targetPath }) }] };
          }
        }
        return { content: [{ type: 'text', text: JSON.stringify({ moved: false, reason: 'Text not found' }) }] };
      });
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 18. list_blocks
server.tool(
  'list_blocks',
  'List all blocks in the document with their index, type, and a text preview',
  {},
  async () => {
    try {
      if (!yjsConnected || !yjsDoc) {
        return { content: [{ type: 'text', text: 'Error: No document connected. Use connect_document first.' }], isError: true };
      }
      const root = getSharedRoot();
      const nodes = deltaToJson(root);
      const blocks = nodes.map((node, i) => {
        const text = (node.children || []).map(c => c.text || '').join('');
        return {
          index: i,
          type: node.type || 'p',
          preview: text.slice(0, 80) + (text.length > 80 ? '...' : ''),
        };
      });
      return { content: [{ type: 'text', text: JSON.stringify(blocks, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 19. get_document_outline
server.tool(
  'get_document_outline',
  'Returns a hierarchical outline of the document based on headings (h1, h2, h3)',
  {},
  async () => {
    try {
      if (!yjsConnected || !yjsDoc) {
        return { content: [{ type: 'text', text: 'Error: No document connected. Use connect_document first.' }], isError: true };
      }
      const root = getSharedRoot();
      const nodes = deltaToJson(root);
      const headings = nodes
        .map((node, i) => {
          if (!['h1', 'h2', 'h3'].includes(node.type)) return null;
          const text = (node.children || []).map(c => c.text || '').join('');
          return { index: i, level: parseInt(node.type[1]), type: node.type, text };
        })
        .filter(Boolean);
      return { content: [{ type: 'text', text: JSON.stringify(headings, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 20. clear_document
server.tool(
  'clear_document',
  'Remove all content from the document, leaving a single empty paragraph',
  {},
  async () => {
    try {
      if (!yjsConnected || !yjsDoc) {
        return { content: [{ type: 'text', text: 'Error: No document connected. Use connect_document first.' }], isError: true };
      }
      return await withHeadlessEditor((editor) => {
        // Remove all nodes
        while (editor.children.length > 0) {
          Transforms.removeNodes(editor, { at: [0] });
        }
        // Insert one empty paragraph
        Transforms.insertNodes(editor, { type: 'p', children: [{ text: '' }] }, { at: [0] });
        return { content: [{ type: 'text', text: JSON.stringify({ cleared: true }) }] };
      });
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// 21. insert_table
server.tool(
  'insert_table',
  'Insert a table into the document',
  {
    rows: z.number().describe('Number of rows (not counting header row)'),
    cols: z.number().describe('Number of columns'),
    headers: z.array(z.string()).optional().describe('Optional header row text for each column'),
  },
  async ({ rows, cols, headers }) => {
    try {
      if (!yjsConnected || !yjsDoc) {
        return { content: [{ type: 'text', text: 'Error: No document connected. Use connect_document first.' }], isError: true };
      }
      return await withHeadlessEditor((editor) => {
        const buildRow = (cellTexts, isHeader = false) => ({
          type: 'tr',
          children: cellTexts.map(t => ({
            type: isHeader ? 'th' : 'td',
            children: [{ type: 'p', children: [{ text: t }] }],
          })),
        });

        const tableChildren = [];

        // Header row
        if (headers && headers.length > 0) {
          const headerTexts = Array.from({ length: cols }, (_, i) => headers[i] || '');
          tableChildren.push(buildRow(headerTexts, true));
        }

        // Data rows
        for (let r = 0; r < rows; r++) {
          const cellTexts = Array.from({ length: cols }, () => '');
          tableChildren.push(buildRow(cellTexts, false));
        }

        const tableNode = {
          type: 'table',
          children: tableChildren,
        };

        Transforms.insertNodes(editor, tableNode, { at: [editor.children.length] });
        return { content: [{ type: 'text', text: JSON.stringify({ inserted: true, rows, cols, hasHeaders: !!(headers && headers.length) }) }] };
      });
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── WebSocket bridge helper (for tools that need the live editor) ────

const WS_BRIDGE_URL = process.env.DRAFTS_WS_URL || 'ws://localhost:3000/ws/editor';

function sendToEditor(message) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_BRIDGE_URL);
    const id = `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Timed out waiting for editor response'));
    }, 30000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'register', role: 'mcp' }));
      ws.send(JSON.stringify({ id, ...message }));
    });

    ws.on('message', (raw) => {
      try {
        const resp = JSON.parse(raw.toString());
        if (resp.id === id) {
          clearTimeout(timeout);
          ws.close();
          if (resp.error) {
            reject(new Error(resp.error));
          } else {
            resolve(resp.result);
          }
        }
      } catch { /* ignore parse errors */ }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// 22. translate_text
server.tool(
  'translate_text',
  'Translate text to a target language using the Claude API via the live editor. The editor must be running at localhost:3000.',
  {
    text: z.string().describe('The text to translate'),
    target_language: z.string().describe('The target language to translate into (e.g. "Spanish", "French", "Japanese")'),
  },
  async ({ text, target_language }) => {
    try {
      const result = await sendToEditor({
        type: 'translate_text',
        text,
        targetLanguage: target_language,
      });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: true, translatedText: result.translatedText }, null, 2),
        }],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── App-only tool: poll_document (hidden from model, callable by MCP App) ──

registerAppTool(
  server,
  'poll_document',
  {
    title: 'Poll Document',
    description: 'Returns the current document content as Slate JSON for live preview.',
    inputSchema: {},
    _meta: {
      ui: {
        resourceUri: RESOURCE_URI,
        visibility: ['app'],
      },
    },
  },
  async () => {
    try {
      if (!yjsConnected || !yjsDoc) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Not connected' }) }] };
      }
      const root = getSharedRoot();
      const nodes = deltaToJson(root);
      const text = deltaToPlainText(root);
      const words = text.trim().split(/\s+/).filter(Boolean).length;
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ nodes, wordCount: words, document: yjsDocName }),
        }],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── App-only tool: apply_user_edit (hidden from model, callable by MCP App) ──

registerAppTool(
  server,
  'apply_user_edit',
  {
    title: 'Apply User Edit',
    description: 'Replaces the document content with text edited by the user in the MCP App.',
    inputSchema: {
      content: z.string().describe('The full document text, with paragraphs separated by newlines'),
    },
    _meta: {
      ui: {
        resourceUri: RESOURCE_URI,
        visibility: ['app'],
      },
    },
  },
  async ({ content }) => {
    try {
      if (!yjsConnected || !yjsDoc) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Not connected' }) }] };
      }
      // Clear the document using the headless editor
      await withHeadlessEditor((editor) => {
        while (editor.children.length > 0) {
          Transforms.removeNodes(editor, { at: [0] });
        }
        Transforms.insertNodes(editor, { type: 'p', children: [{ text: '' }] }, { at: [0] });
      });

      // Insert new content as paragraphs
      const root = getSharedRoot();
      const lines = content.split('\n');

      // Remove the empty paragraph we just created, then insert new content
      await withHeadlessEditor((editor) => {
        if (editor.children.length === 1) {
          const firstText = Node.string(editor.children[0]);
          if (firstText === '') {
            Transforms.removeNodes(editor, { at: [0] });
          }
        }
      });

      for (const line of lines) {
        insertParagraph(root, line);
      }

      return { content: [{ type: 'text', text: JSON.stringify({ applied: true }) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── MCP App Resource — serves the bundled HTML UI ────────────────────

registerAppResource(
  server,
  'Document Preview',
  RESOURCE_URI,
  { mimeType: RESOURCE_MIME_TYPE },
  async () => {
    const html = fs.readFileSync(path.join(DIST_DIR, 'mcp-app.html'), 'utf-8');
    return {
      contents: [{
        uri: RESOURCE_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: html,
        _meta: {
          ui: {
            csp: {
              connectDomains: [
                'https://draft-collab-production.up.railway.app',
                'wss://draft-collab-production.up.railway.app',
                'ws://localhost:8888',
              ],
            },
          },
        },
      }],
    };
  }
);

// ── Start ───────────────────────────────────────────────────────────

const useHttp = process.argv.includes('--http') || !!process.env.PORT;

if (useHttp) {
  // HTTP transport — used by Railway, Claude.ai custom connectors, and basic-host
  const { default: express } = await import('express');
  const { default: cors } = await import('cors');

  const port = parseInt(process.env.PORT || '3001', 10);
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Health check
  app.get('/', (_req, res) => res.json({ status: 'ok', name: 'Drafts MCP' }));
  app.get('/mcp', (_req, res) => res.json({ status: 'ok', name: 'Drafts MCP' }));

  app.post('/mcp', async (req, res) => {
    const httpTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      httpTransport.close().catch(() => {});
    });
    try {
      await server.connect(httpTransport);
      await httpTransport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('MCP error:', error);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
      }
    }
  });

  app.listen(port, '0.0.0.0', () => {
    console.error(`[Drafts] MCP server listening on http://0.0.0.0:${port}/mcp`);
  });
} else {
  // Default: stdio transport (Claude Desktop, Claude Code)
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[Drafts] MCP server started');
  console.error('[Drafts] Use connect_document to connect to a document');
}
