import { useEffect, useRef, useState, useCallback } from 'react';
import { useEditorRef } from 'platejs/react';
import { YjsPlugin } from '@platejs/yjs/react';
import {
  CursorEditor,
  type CursorState,
  relativeRangeToSlateRange,
} from '@slate-yjs/core';
interface CursorData extends Record<string, unknown> {
  name?: string;
  color?: string;
}

interface RemoteCursor {
  clientId: string;
  name: string;
  color: string;
  caretRect: DOMRect | null;
  selectionRects: DOMRect[];
}

/**
 * Renders Google Docs-style collaborative cursor carets and selection highlights
 * for remote collaborators connected via Yjs/Hocuspocus.
 */
export default function CursorOverlay() {
  const editor = useEditorRef();
  const [cursors, setCursors] = useState<RemoteCursor[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  const refreshCursors = useCallback(() => {
    try {
      if (!CursorEditor.isCursorEditor(editor)) return;
    } catch {
      return;
    }

    const container = containerRef.current?.parentElement;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();

    let states: Record<string, CursorState<CursorData>>;
    try {
      states = CursorEditor.cursorStates(editor) as Record<string, CursorState<CursorData>>;
    } catch {
      return;
    }

    // Get the Yjs shared root from the editor
    let sharedType: any;
    try {
      const yjsOptions = editor.getOptions(YjsPlugin);
      sharedType = yjsOptions.sharedType;
    } catch {
      return;
    }
    if (!sharedType) return;

    const remoteCursors: RemoteCursor[] = [];

    for (const [clientId, state] of Object.entries(states)) {
      if (!state) continue;

      const { relativeSelection, data } = state;
      const name = data?.name || 'Anonymous';
      const color = data?.color || '#888888';

      if (!relativeSelection) {
        // Client connected but no selection — still show as connected
        continue;
      }

      let slateRange: { anchor: { path: number[]; offset: number }; focus: { path: number[]; offset: number } } | null = null;
      try {
        slateRange = relativeRangeToSlateRange(sharedType, editor, relativeSelection);
      } catch {
        // Range might be invalid if the document changed
        continue;
      }

      if (!slateRange) continue;

      let domRange: Range | undefined;
      try {
        domRange = editor.api.toDOMRange(slateRange);
      } catch {
        continue;
      }

      if (!domRange) continue;

      // Get selection highlight rects
      const selectionRects: DOMRect[] = [];
      const rects = domRange.getClientRects();
      for (let i = 0; i < rects.length; i++) {
        selectionRects.push(rects[i]);
      }

      // Get caret position (at the focus/end of the selection)
      let caretRect: DOMRect | null = null;
      try {
        const collapsed = domRange.cloneRange();
        collapsed.collapse(false); // collapse to end
        const caretRects = collapsed.getClientRects();
        if (caretRects.length > 0) {
          caretRect = caretRects[0];
        } else if (selectionRects.length > 0) {
          // Fallback: use the last selection rect
          caretRect = selectionRects[selectionRects.length - 1];
        }
      } catch {
        if (selectionRects.length > 0) {
          caretRect = selectionRects[selectionRects.length - 1];
        }
      }

      remoteCursors.push({
        clientId,
        name,
        color,
        caretRect: caretRect
          ? new DOMRect(
              caretRect.x - containerRect.x,
              caretRect.y - containerRect.y,
              caretRect.width,
              caretRect.height,
            )
          : null,
        selectionRects: selectionRects.map(
          (r) =>
            new DOMRect(
              r.x - containerRect.x,
              r.y - containerRect.y,
              r.width,
              r.height,
            ),
        ),
      });
    }

    setCursors(remoteCursors);
  }, [editor]);

  useEffect(() => {
    let isCursor = false;
    try { isCursor = CursorEditor.isCursorEditor(editor); } catch { /* */ }
    if (!isCursor) return;

    const scheduleRefresh = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(refreshCursors);
    };

    // Listen to remote cursor changes
    CursorEditor.on(editor as any, 'change', scheduleRefresh);

    // Also refresh on local editor changes (scroll, resize, content changes)
    // Use passive scroll listeners for better scrolling performance (client-event-listeners)
    const editorEl = containerRef.current?.closest('[data-slate-editor]');
    if (editorEl) {
      editorEl.addEventListener('scroll', scheduleRefresh, { passive: true });
    }
    window.addEventListener('resize', scheduleRefresh);

    // Observe DOM mutations (content changes cause re-layout)
    const observer = new MutationObserver(scheduleRefresh);
    if (editorEl) {
      observer.observe(editorEl, { childList: true, subtree: true, characterData: true });
    }

    // Also refresh on scroll of any scrollable ancestor
    const scrollParent = containerRef.current?.closest('.overflow-auto, .overflow-y-auto, [style*="overflow"]');
    if (scrollParent) {
      scrollParent.addEventListener('scroll', scheduleRefresh, { passive: true });
    }

    // Initial refresh
    scheduleRefresh();

    // Periodic refresh as a fallback (every 1s)
    const interval = setInterval(scheduleRefresh, 1000);

    return () => {
      if (CursorEditor.isCursorEditor(editor)) {
        CursorEditor.off(editor, 'change', scheduleRefresh);
      }
      if (editorEl) {
        editorEl.removeEventListener('scroll', scheduleRefresh);
      }
      if (scrollParent) {
        scrollParent.removeEventListener('scroll', scheduleRefresh);
      }
      window.removeEventListener('resize', scheduleRefresh);
      observer.disconnect();
      cancelAnimationFrame(rafRef.current);
      clearInterval(interval);
    };
  }, [editor, refreshCursors]);

  if (cursors.length === 0) return <div ref={containerRef} />;

  return (
    <div ref={containerRef} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none', zIndex: 50 }}>
      {cursors.map((cursor) => (
        <div key={cursor.clientId}>
          {/* Selection highlights */}
          {cursor.selectionRects.map((rect, i) => (
            <div
              key={`sel-${i}`}
              style={{
                position: 'absolute',
                top: rect.y,
                left: rect.x,
                width: rect.width,
                height: rect.height,
                backgroundColor: cursor.color,
                opacity: 0.2,
                pointerEvents: 'none',
              }}
            />
          ))}

          {/* Cursor caret */}
          {cursor.caretRect && (
            <div
              style={{
                position: 'absolute',
                top: cursor.caretRect.y,
                left: cursor.caretRect.x + cursor.caretRect.width,
                width: 2,
                height: cursor.caretRect.height,
                backgroundColor: cursor.color,
                pointerEvents: 'none',
              }}
              className="cursor-caret-blink"
            >
              {/* Name label pill */}
              <div
                style={{
                  position: 'absolute',
                  top: -20,
                  left: 0,
                  backgroundColor: cursor.color,
                  color: '#fff',
                  fontSize: 11,
                  lineHeight: '16px',
                  padding: '1px 6px',
                  borderRadius: 4,
                  whiteSpace: 'nowrap',
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                  fontWeight: 500,
                  letterSpacing: '0.01em',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                  pointerEvents: 'none',
                  userSelect: 'none',
                }}
              >
                {cursor.name}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
