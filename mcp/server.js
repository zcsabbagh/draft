#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { createEditor, Transforms, Editor, Node, Text } from 'slate';
import { withYjs, YjsEditor } from '@slate-yjs/core';

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

// ── Start ───────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[Drafts] MCP server started');
console.error('[Drafts] Use connect_document to connect to a document');
