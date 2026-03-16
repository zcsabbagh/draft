import { useEffect, useRef, useCallback } from 'react';

type AnyEditor = any;

interface BridgeMessage {
  id: string;
  type: string;
  [key: string]: unknown;
}

function extractText(nodes: unknown[]): string {
  const texts: string[] = [];
  function walk(list: unknown[]) {
    for (const node of list) {
      if (typeof node !== 'object' || node === null) continue;
      const n = node as Record<string, unknown>;
      if (typeof n.text === 'string') {
        texts.push(n.text);
      }
      if (Array.isArray(n.children)) {
        walk(n.children);
      }
    }
  }
  walk(nodes);
  return texts.join('');
}

function getPlainTextWithNewlines(nodes: unknown[]): string {
  const parts: string[] = [];
  for (const node of nodes) {
    if (typeof node !== 'object' || node === null) continue;
    const n = node as Record<string, unknown>;
    if (Array.isArray(n.children)) {
      parts.push(extractText(n.children as unknown[]));
    }
  }
  return parts.join('\n');
}

export function useEditorBridge(editor: AnyEditor | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editorRef = useRef<AnyEditor | null>(editor);

  // Keep editorRef in sync
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  const handleMessage = useCallback((event: MessageEvent) => {
    let msg: BridgeMessage;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    const ed = editorRef.current;
    if (!ed) {
      wsRef.current?.send(JSON.stringify({
        id: msg.id,
        error: 'Editor not available',
      }));
      return;
    }

    try {
      switch (msg.type) {
        case 'get_document': {
          const value = ed.children;
          const text = getPlainTextWithNewlines(value);
          wsRef.current?.send(JSON.stringify({
            id: msg.id,
            result: { document: value, text },
          }));
          break;
        }

        case 'get_selection': {
          const selection = ed.selection;
          let selectedText = '';
          if (selection) {
            try {
              const fragment = ed.getFragment();
              selectedText = getPlainTextWithNewlines(fragment);
            } catch {
              selectedText = '';
            }
          }
          wsRef.current?.send(JSON.stringify({
            id: msg.id,
            result: { selection, selectedText },
          }));
          break;
        }

        case 'get_text': {
          const text = getPlainTextWithNewlines(ed.children);
          wsRef.current?.send(JSON.stringify({
            id: msg.id,
            result: { text },
          }));
          break;
        }

        case 'insert_text': {
          const { text, position } = msg as BridgeMessage & { text: string; position?: string };
          if (position === 'start') {
            ed.select({ path: [0, 0], offset: 0 });
          } else if (position === 'end') {
            const lastIdx = ed.children.length - 1;
            const lastChild = ed.children[lastIdx] as any;
            const lastText = lastChild?.children?.[lastChild.children.length - 1];
            const offset = lastText?.text?.length || 0;
            ed.select({ path: [lastIdx, lastChild.children.length - 1], offset });
          }
          ed.insertText(text);
          wsRef.current?.send(JSON.stringify({
            id: msg.id,
            result: { success: true },
          }));
          break;
        }

        case 'replace_text': {
          const { search, replacement, replaceAll } = msg as BridgeMessage & {
            search: string;
            replacement: string;
            replaceAll?: boolean;
          };
          let count = 0;

          // Walk all text nodes and find occurrences
          const replaceInNodes = () => {
            for (let i = 0; i < ed.children.length; i++) {
              const block = ed.children[i] as any;
              if (!block.children) continue;
              for (let j = 0; j < block.children.length; j++) {
                const leaf = block.children[j] as any;
                if (typeof leaf.text !== 'string') continue;

                let idx = leaf.text.indexOf(search);
                while (idx !== -1) {
                  const anchor = { path: [i, j], offset: idx };
                  const focus = { path: [i, j], offset: idx + search.length };
                  ed.select({ anchor, focus });
                  ed.insertText(replacement);
                  count++;
                  if (!replaceAll) return;
                  // Re-read the leaf since the text changed
                  const updatedLeaf = (ed.children[i] as any)?.children?.[j];
                  if (!updatedLeaf || typeof updatedLeaf.text !== 'string') break;
                  idx = updatedLeaf.text.indexOf(search, idx + replacement.length);
                }
                if (count > 0 && !replaceAll) return;
              }
            }
          };

          replaceInNodes();
          wsRef.current?.send(JSON.stringify({
            id: msg.id,
            result: { success: true, replacements: count },
          }));
          break;
        }

        case 'set_marks': {
          const { search, marks } = msg as BridgeMessage & {
            search: string;
            marks: Record<string, boolean>;
          };

          // Find the text and select it
          let found = false;
          for (let i = 0; i < ed.children.length && !found; i++) {
            const block = ed.children[i] as any;
            if (!block.children) continue;
            for (let j = 0; j < block.children.length && !found; j++) {
              const leaf = block.children[j] as any;
              if (typeof leaf.text !== 'string') continue;
              const idx = leaf.text.indexOf(search);
              if (idx !== -1) {
                ed.select({
                  anchor: { path: [i, j], offset: idx },
                  focus: { path: [i, j], offset: idx + search.length },
                });
                for (const [mark, value] of Object.entries(marks)) {
                  if (value) {
                    ed.addMark(mark, true);
                  } else {
                    ed.removeMark(mark);
                  }
                }
                found = true;
              }
            }
          }
          wsRef.current?.send(JSON.stringify({
            id: msg.id,
            result: { success: found },
          }));
          break;
        }

        case 'insert_node': {
          const { node, position } = msg as BridgeMessage & {
            node: Record<string, unknown>;
            position?: string;
          };

          if (position === 'start') {
            ed.insertNode(node, { at: [0] });
          } else if (position === 'end') {
            ed.insertNode(node, { at: [ed.children.length] });
          } else if (position && position.includes(',')) {
            const path = position.split(',').map(Number);
            ed.insertNode(node, { at: path });
          } else {
            // Insert after current selection or at end
            if (ed.selection) {
              const currentPath = ed.selection.anchor.path[0];
              ed.insertNode(node, { at: [currentPath + 1] });
            } else {
              ed.insertNode(node, { at: [ed.children.length] });
            }
          }
          wsRef.current?.send(JSON.stringify({
            id: msg.id,
            result: { success: true },
          }));
          break;
        }

        case 'add_comment': {
          const { search, comment: commentText, author } = msg as BridgeMessage & {
            search: string;
            comment: string;
            author?: string;
          };

          // Find the text and add a comment mark
          let found = false;
          const commentId = `comment-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          for (let i = 0; i < ed.children.length && !found; i++) {
            const block = ed.children[i] as any;
            if (!block.children) continue;
            for (let j = 0; j < block.children.length && !found; j++) {
              const leaf = block.children[j] as any;
              if (typeof leaf.text !== 'string') continue;
              const idx = leaf.text.indexOf(search);
              if (idx !== -1) {
                ed.select({
                  anchor: { path: [i, j], offset: idx },
                  focus: { path: [i, j], offset: idx + search.length },
                });
                ed.addMark(`comment_${commentId}`, true);
                found = true;
              }
            }
          }

          // Dispatch a custom event so the UI can pick up the comment data
          if (found && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('editor-comment-added', {
              detail: { id: commentId, text: search, comment: commentText, author: author || 'MCP' },
            }));
          }

          wsRef.current?.send(JSON.stringify({
            id: msg.id,
            result: { success: found, commentId: found ? commentId : null },
          }));
          break;
        }

        case 'transform': {
          const { operations } = msg as BridgeMessage & { operations: any[] };
          for (const op of operations) {
            ed.apply(op);
          }
          wsRef.current?.send(JSON.stringify({
            id: msg.id,
            result: { success: true, document: ed.children },
          }));
          break;
        }

        default:
          wsRef.current?.send(JSON.stringify({
            id: msg.id,
            error: `Unknown message type: ${msg.type}`,
          }));
      }
    } catch (err) {
      wsRef.current?.send(JSON.stringify({
        id: msg.id,
        error: String(err),
      }));
    }
  }, []);

  const connect = useCallback(() => {
    // Only connect to WS bridge on localhost (not on deployed Vercel)
    if (typeof window !== 'undefined' && !window.location.hostname.includes('localhost')) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket('ws://localhost:3000/ws/editor');

    ws.onopen = () => {
      console.log('[EditorBridge] WebSocket connected');
      ws.send(JSON.stringify({ type: 'register', role: 'editor' }));
    };

    ws.onmessage = handleMessage;

    ws.onclose = () => {
      console.log('[EditorBridge] WebSocket disconnected, reconnecting in 2s...');
      wsRef.current = null;
      reconnectTimerRef.current = setTimeout(connect, 2000);
    };

    ws.onerror = (err) => {
      console.warn('[EditorBridge] WebSocket error:', err);
    };

    wsRef.current = ws;
  }, [handleMessage]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);
}
