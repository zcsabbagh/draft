import React, { useCallback, useRef, useEffect, useState } from 'react';
import ScrollAssist from './ScrollAssist';

// Error boundary that auto-recovers from Yjs/Slate rendering crashes
class EditorErrorBoundary extends React.Component<
  { children: React.ReactNode; onError?: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.warn('[Editor] Caught render error, recovering:', error.message);
    // Auto-recover after a brief delay
    setTimeout(() => this.setState({ hasError: false }), 100);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-full text-sm text-ink-lighter">
          Syncing...
        </div>
      );
    }
    return this.props.children;
  }
}
import {
  Plate,
  PlateContent,
  PlateLeaf,
  PlateElement,
  usePlateEditor,
  useEditorRef,
  createPlatePlugin,
} from 'platejs/react';
import { YjsPlugin } from '@platejs/yjs/react';
import {
  BasicBlocksPlugin,
  BasicMarksPlugin,
  BoldPlugin,
  ItalicPlugin,
  UnderlinePlugin,
  StrikethroughPlugin,
  BlockquotePlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  HorizontalRulePlugin,
  CodePlugin,
  HighlightPlugin,
} from '@platejs/basic-nodes/react';
import { ListPlugin } from '@platejs/list/react';
import { LinkPlugin } from '@platejs/link/react';
import { ImagePlugin } from '@platejs/media/react';
import { TablePlugin, TableRowPlugin, TableCellPlugin, TableCellHeaderPlugin } from '@platejs/table/react';
import { insertTable, insertTableRow, insertTableColumn, deleteTable, deleteRow, deleteColumn } from '@platejs/table';
import FontSelector from './FontSelector';
import FontSizeSelector from './FontSizeSelector';
import InlineEditPanel from './InlineEditPanel';
import StatusBar from './StatusBar';
import SelectionToolbar from './SelectionToolbar';
import { getFontByName, FONT_OPTIONS } from '../lib/fonts';
import type { FeedbackComment } from '../lib/types';
import type { Citation } from '../lib/api';
import { useEditorBridge } from '../hooks/useEditorBridge';
// CursorOverlay temporarily disabled for debugging
// import CursorOverlay from './CursorOverlay';

const HIGHLIGHT_STYLES: Record<string, React.CSSProperties> = {
  vague: { backgroundColor: '#FFF3E8', borderBottom: '2px solid #E8A87C', borderRadius: 2, cursor: 'pointer', padding: '1px 0' },
  unsupported: { backgroundColor: '#FFECE9', borderBottom: '2px solid #D4726A', borderRadius: 2, cursor: 'pointer', padding: '1px 0' },
  'logical-gap': { backgroundColor: '#F0ECF7', borderBottom: '2px solid #7B68A8', borderRadius: 2, cursor: 'pointer', padding: '1px 0' },
  ambiguous: { backgroundColor: '#EBF3F7', borderBottom: '2px solid #5B8FA8', borderRadius: 2, cursor: 'pointer', padding: '1px 0' },
};

const HIGHLIGHT_ACTIVE_STYLES: Record<string, React.CSSProperties> = {
  vague: { backgroundColor: 'rgba(232,168,124,0.35)', borderBottom: '2px solid #E8A87C', borderRadius: 2, cursor: 'pointer', padding: '1px 0' },
  unsupported: { backgroundColor: 'rgba(212,114,106,0.35)', borderBottom: '2px solid #D4726A', borderRadius: 2, cursor: 'pointer', padding: '1px 0' },
  'logical-gap': { backgroundColor: 'rgba(123,104,168,0.35)', borderBottom: '2px solid #7B68A8', borderRadius: 2, cursor: 'pointer', padding: '1px 0' },
  ambiguous: { backgroundColor: 'rgba(91,143,168,0.35)', borderBottom: '2px solid #5B8FA8', borderRadius: 2, cursor: 'pointer', padding: '1px 0' },
};

interface EditorProps {
  comments: FeedbackComment[];
  activeCommentId: string | null;
  onCommentClick: (id: string) => void;
  onChange: (value: unknown[]) => void;
  readOnly?: boolean;
  initialValue?: unknown[];
  fontName?: string;
  onFontChange?: (fontName: string) => void;
  getDocumentText?: () => string;
  onEditAccept?: (originalText: string, newText: string) => void;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  citations?: Citation[];
  onCite?: (selectedText: string) => Promise<number>;
  onFeedbackSelection?: (selectedText: string) => void;
  editorRef?: React.RefObject<unknown | null>;
  collabUrl?: string;       // Hocuspocus WebSocket URL, e.g. ws://localhost:8888
  documentId?: string;      // Document name for collab
  isMobile?: boolean;       // Mobile layout mode
}

// Toolbar button component
function ToolbarButton({
  active,
  onMouseDown,
  children,
  title,
}: {
  active?: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <button
      onMouseDown={(e) => {
        e.preventDefault();
        onMouseDown(e);
      }}
      title={title}
      className={`px-2 py-1 text-xs rounded transition-colors ${
        active
          ? 'bg-ink text-cream'
          : 'text-ink-light hover:bg-cream-dark hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEditor = any;

const CitationLinkPlugin = createPlatePlugin({
  key: 'citation_link',
  node: {
    isElement: true,
    isInline: true,
    isVoid: false,
  },
});

const PageBreakPlugin = createPlatePlugin({
  key: 'page_break',
  node: {
    isElement: true,
    isInline: false,
    isVoid: true,
  },
});

function TableToolbar({ editor }: { editor: AnyEditor }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const check = () => {
      try {
        const [tableEntry] = editor.nodes({ match: (n: any) => n.type === 'table' });
        if (!tableEntry) { setVisible(false); return; }

        const domNode = editor.toDOMNode(tableEntry[0]);
        if (!domNode) { setVisible(false); return; }

        const pageBackground = domNode.closest('.page-background');
        if (!pageBackground) { setVisible(false); return; }

        const rect = domNode.getBoundingClientRect();
        const containerRect = pageBackground.getBoundingClientRect();

        setPos({
          top: rect.top - containerRect.top + (pageBackground as HTMLElement).scrollTop - 32,
          left: rect.left - containerRect.left + rect.width / 2,
        });
        setVisible(true);
      } catch {
        setVisible(false);
      }
    };

    const interval = setInterval(check, 300);
    return () => clearInterval(interval);
  }, [editor]);

  if (!visible) return null;

  const btn = "text-[10px] text-cream/80 hover:text-cream px-2 py-1 rounded transition-colors whitespace-nowrap";

  return (
    <div
      ref={containerRef}
      className="absolute z-50 flex items-center gap-0.5 bg-ink rounded-lg shadow-lg px-0.5 py-0.5"
      style={{ top: pos.top, left: pos.left, transform: 'translateX(-50%)' }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <button className={btn} onClick={() => { try { insertTableRow(editor); } catch {} }}>+ Row</button>
      <button className={btn} onClick={() => { try { insertTableColumn(editor); } catch {} }}>+ Col</button>
      <div className="w-px h-3 bg-cream/20" />
      <button className={btn} onClick={() => { try { deleteRow(editor); } catch {} }}>- Row</button>
      <button className={btn} onClick={() => { try { deleteColumn(editor); } catch {} }}>- Col</button>
      <div className="w-px h-3 bg-cream/20" />
      <button className={`${btn} text-red-400 hover:text-red-300`} onClick={() => { try { deleteTable(editor); } catch {} }}>Delete</button>
    </div>
  );
}

/** Read image files and insert as data-URL image nodes */
function insertImageFiles(editorRef: AnyEditor, files: FileList | File[]) {
  Array.from(files).forEach((file) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      editorRef.insertNode({ type: 'img', url, children: [{ text: '' }] });
    };
    reader.readAsDataURL(file);
  });
}

/** Enhanced image element with resize handles, alignment toolbar, and caption */
function ImageElement(props: any) {
  const el = props.element;
  const align = el?.align || 'center';
  const width = el?.width;
  const caption = el?.caption || '';
  const imgRef = useRef<HTMLImageElement>(null);
  const editorRef = useEditorRef() as AnyEditor;

  const setNodeData = (data: Record<string, unknown>) => {
    try {
      const path = editorRef.findPath(el);
      if (path) editorRef.setNodes(data, { at: path });
    } catch { /* ignore */ }
  };

  const handleResizeMouseDown = (side: 'left' | 'right') => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = imgRef.current?.offsetWidth || 300;

    const onMouseMove = (ev: MouseEvent) => {
      const diff = side === 'right' ? ev.clientX - startX : startX - ev.clientX;
      const newWidth = Math.max(100, Math.min(startWidth + diff, 700));
      if (imgRef.current) imgRef.current.style.width = `${newWidth}px`;
    };

    const onMouseUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      const diff = side === 'right' ? ev.clientX - startX : startX - ev.clientX;
      const newWidth = Math.max(100, Math.min(startWidth + diff, 700));
      setNodeData({ width: newWidth });
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  const justifyClass = align === 'left' ? 'justify-start' : align === 'right' ? 'justify-end' : 'justify-center';

  return (
    <PlateElement {...props}>
      <div className={`slate-image-wrapper ${justifyClass}`} contentEditable={false}>
        <div className="slate-image-container" style={width ? { width: `${width}px` } : undefined}>
          <div className="slate-image-resize-handle slate-image-resize-left" onMouseDown={handleResizeMouseDown('left')} />
          <img
            ref={imgRef}
            src={el?.url}
            alt={caption}
            style={width ? { width: `${width}px` } : undefined}
          />
          <div className="slate-image-resize-handle slate-image-resize-right" onMouseDown={handleResizeMouseDown('right')} />
          <div className="slate-image-align-bar">
            {(['left', 'center', 'right'] as const).map((a) => (
              <button
                key={a}
                className={`slate-image-align-btn${align === a ? ' active' : ''}`}
                onMouseDown={(ev) => { ev.preventDefault(); ev.stopPropagation(); setNodeData({ align: a }); }}
                title={`Align ${a}`}
              >
                {a === 'left' && <svg width="14" height="14" viewBox="0 0 14 14"><line x1="2" y1="3" x2="12" y2="3" stroke="currentColor" strokeWidth="1.5"/><line x1="2" y1="7" x2="9" y2="7" stroke="currentColor" strokeWidth="1.5"/><line x1="2" y1="11" x2="12" y2="11" stroke="currentColor" strokeWidth="1.5"/></svg>}
                {a === 'center' && <svg width="14" height="14" viewBox="0 0 14 14"><line x1="2" y1="3" x2="12" y2="3" stroke="currentColor" strokeWidth="1.5"/><line x1="3.5" y1="7" x2="10.5" y2="7" stroke="currentColor" strokeWidth="1.5"/><line x1="2" y1="11" x2="12" y2="11" stroke="currentColor" strokeWidth="1.5"/></svg>}
                {a === 'right' && <svg width="14" height="14" viewBox="0 0 14 14"><line x1="2" y1="3" x2="12" y2="3" stroke="currentColor" strokeWidth="1.5"/><line x1="5" y1="7" x2="12" y2="7" stroke="currentColor" strokeWidth="1.5"/><line x1="2" y1="11" x2="12" y2="11" stroke="currentColor" strokeWidth="1.5"/></svg>}
              </button>
            ))}
          </div>
        </div>
        <input
          className="slate-image-caption"
          value={caption}
          onChange={(ev) => setNodeData({ caption: ev.target.value })}
          placeholder="Add a caption..."
        />
      </div>
      {props.children}
    </PlateElement>
  );
}

const LINE_SPACING_OPTIONS = [
  { label: '1.0', value: '1' },
  { label: '1.15', value: '1.15' },
  { label: '1.5', value: '1.5' },
  { label: '2.0', value: '2' },
];

function LineSpacingSelector({ currentSpacing, onSpacingChange }: {
  currentSpacing: string | undefined;
  onSpacingChange: (spacing: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        onMouseDown={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
        title="Line spacing"
        className="flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors text-ink-light hover:bg-cream-dark hover:text-ink"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <line x1="4" y1="2" x2="11" y2="2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="4" y1="6" x2="11" y2="6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="4" y1="10" x2="11" y2="10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M1.5 3.5L2.5 1.5L3.5 3.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M1.5 8.5L2.5 10.5L3.5 8.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="shrink-0 opacity-50">
          <path d="M1.5 3L4 5.5L6.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-28 bg-[#FAFAF8] border border-[#E5E5E0] rounded-lg shadow-lg z-50 flex flex-col animate-dropdown-open py-1">
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              onSpacingChange(undefined);
              setOpen(false);
            }}
            className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
              !currentSpacing
                ? 'bg-cream-dark text-ink'
                : 'text-ink-light hover:bg-cream-dark hover:text-ink'
            }`}
          >
            Default
          </button>
          {LINE_SPACING_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onMouseDown={(e) => {
                e.preventDefault();
                onSpacingChange(opt.value);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between transition-colors ${
                currentSpacing === opt.value
                  ? 'bg-cream-dark text-ink'
                  : 'text-ink-light hover:bg-cream-dark hover:text-ink'
              }`}
            >
              <span>{opt.label}</span>
              {currentSpacing === opt.value && (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0 text-ink">
                  <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const ZOOM_LEVELS = [50, 75, 90, 100, 110, 125, 150, 175, 200];

function Toolbar({ fontName, onFontChange, zoom, onZoomChange, isMobile }: {
  fontName: string;
  onFontChange: (name: string) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  isMobile?: boolean;
}) {
  const editor = useEditorRef() as AnyEditor;

  const getMarkValue = (mark: string): unknown => {
    try {
      const marks = editor.getMarks();
      return marks ? marks[mark] : undefined;
    } catch {
      return undefined;
    }
  };

  const isMarkActive = (mark: string) => !!getMarkValue(mark);

  const toggleMark = (mark: string) => {
    if (isMarkActive(mark)) {
      editor.removeMark(mark);
    } else {
      editor.addMark(mark, true);
    }
  };

  const setMarkValue = (mark: string, value: string | undefined) => {
    if (value === undefined) {
      editor.removeMark(mark);
    } else {
      editor.addMark(mark, value);
    }
  };

  const isBlockActive = (type: string) => {
    try {
      const [match] = editor.nodes({
        match: (n: any) => n.type === type,
      });
      return !!match;
    } catch {
      return false;
    }
  };

  const toggleBlock = (type: string) => {
    const isActive = isBlockActive(type);
    editor.setNodes(
      { type: isActive ? 'p' : type },
      { match: (n: any) => editor.isBlock(n) }
    );
  };

  const getBlockProp = (prop: string): unknown => {
    try {
      const [match] = editor.nodes({
        match: (n: any) => editor.isBlock(n),
      });
      if (match) return (match[0] as any)[prop];
    } catch { /* ignore */ }
    return undefined;
  };

  const setBlockProp = (prop: string, value: unknown) => {
    editor.setNodes(
      { [prop]: value } as any,
      { match: (n: any) => editor.isBlock(n) }
    );
  };

  const currentAlign = getBlockProp('align') as string | undefined;
  const currentLineSpacing = getBlockProp('lineSpacing') as string | undefined;

  const currentFontMark = getMarkValue('fontFamily') as string | undefined;
  const currentSizeMark = getMarkValue('fontSize') as string | undefined;

  const handleFontChange = (name: string) => {
    const font = getFontByName(name);
    setMarkValue('fontFamily', font.family);
    onFontChange(name);
  };

  const handleFontSizeChange = (size: string | undefined) => {
    setMarkValue('fontSize', size);
  };

  const displayedFont = currentFontMark
    ? (FONT_OPTIONS.find((f) => f.family === currentFontMark)?.name ?? fontName)
    : fontName;

  if (isMobile) {
    // Compact mobile toolbar — just essential formatting
    return (
      <div className="flex items-center gap-0.5 px-3 py-1.5 bg-cream overflow-x-auto">
        <ToolbarButton active={isBlockActive('h1')} onMouseDown={() => toggleBlock('h1')} title="Heading 1">H1</ToolbarButton>
        <ToolbarButton active={isBlockActive('h2')} onMouseDown={() => toggleBlock('h2')} title="Heading 2">H2</ToolbarButton>
        <div className="w-px h-4 bg-border mx-0.5 shrink-0" />
        <ToolbarButton active={isMarkActive('bold')} onMouseDown={() => toggleMark('bold')} title="Bold"><strong>B</strong></ToolbarButton>
        <ToolbarButton active={isMarkActive('italic')} onMouseDown={() => toggleMark('italic')} title="Italic"><em>I</em></ToolbarButton>
        <ToolbarButton active={isMarkActive('underline')} onMouseDown={() => toggleMark('underline')} title="Underline"><span className="underline">U</span></ToolbarButton>
        <div className="w-px h-4 bg-border mx-0.5 shrink-0" />
        <ToolbarButton active={isBlockActive('blockquote')} onMouseDown={() => toggleBlock('blockquote')} title="Blockquote">
          <span className="text-[10px]">❝</span>
        </ToolbarButton>
        <ToolbarButton active={currentAlign === 'left'} onMouseDown={() => setBlockProp('align', 'left')} title="Align Left">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><line x1="1" y1="2" x2="11" y2="2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /><line x1="1" y1="5" x2="8" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /><line x1="1" y1="8" x2="11" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /><line x1="1" y1="11" x2="6" y2="11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
        </ToolbarButton>
        <ToolbarButton active={currentAlign === 'center'} onMouseDown={() => setBlockProp('align', 'center')} title="Align Center">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><line x1="1" y1="2" x2="11" y2="2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /><line x1="2.5" y1="5" x2="9.5" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /><line x1="1" y1="8" x2="11" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /><line x1="3.5" y1="11" x2="8.5" y2="11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
        </ToolbarButton>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-0.5 px-6 py-2 bg-cream flex-wrap">
      <FontSelector selectedFont={displayedFont} onFontChange={handleFontChange} />
      <FontSizeSelector currentSize={currentSizeMark} onSizeChange={handleFontSizeChange} />
      <div className="w-px h-4 bg-border mx-1" />
      <ToolbarButton active={isBlockActive('h1')} onMouseDown={() => toggleBlock('h1')} title="Heading 1">
        H1
      </ToolbarButton>
      <ToolbarButton active={isBlockActive('h2')} onMouseDown={() => toggleBlock('h2')} title="Heading 2">
        H2
      </ToolbarButton>
      <ToolbarButton active={isBlockActive('h3')} onMouseDown={() => toggleBlock('h3')} title="Heading 3">
        H3
      </ToolbarButton>
      <div className="w-px h-4 bg-border mx-1" />
      <ToolbarButton active={isMarkActive('bold')} onMouseDown={() => toggleMark('bold')} title="Bold (⌘B)">
        <strong>B</strong>
      </ToolbarButton>
      <ToolbarButton active={isMarkActive('italic')} onMouseDown={() => toggleMark('italic')} title="Italic (⌘I)">
        <em>I</em>
      </ToolbarButton>
      <ToolbarButton active={isMarkActive('underline')} onMouseDown={() => toggleMark('underline')} title="Underline (⌘U)">
        <span className="underline">U</span>
      </ToolbarButton>
      <ToolbarButton active={isMarkActive('strikethrough')} onMouseDown={() => toggleMark('strikethrough')} title="Strikethrough">
        <span className="line-through">S</span>
      </ToolbarButton>
      <ToolbarButton active={isMarkActive('code')} onMouseDown={() => toggleMark('code')} title="Code">
        <span className="font-mono text-[10px]">&lt;/&gt;</span>
      </ToolbarButton>
      <div className="w-px h-4 bg-border mx-1" />
      <ToolbarButton active={isBlockActive('blockquote')} onMouseDown={() => toggleBlock('blockquote')} title="Blockquote">
        <span className="text-[10px]">❝</span>
      </ToolbarButton>
      <div className="w-px h-4 bg-border mx-1" />
      <ToolbarButton active={currentAlign === 'left'} onMouseDown={() => setBlockProp('align', 'left')} title="Align Left">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <line x1="1" y1="2" x2="11" y2="2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="1" y1="5" x2="8" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="1" y1="8" x2="11" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="1" y1="11" x2="6" y2="11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </ToolbarButton>
      <ToolbarButton active={currentAlign === 'center'} onMouseDown={() => setBlockProp('align', 'center')} title="Align Center">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <line x1="1" y1="2" x2="11" y2="2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="2.5" y1="5" x2="9.5" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="1" y1="8" x2="11" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="3.5" y1="11" x2="8.5" y2="11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </ToolbarButton>
      <ToolbarButton active={currentAlign === 'right'} onMouseDown={() => setBlockProp('align', 'right')} title="Align Right">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <line x1="1" y1="2" x2="11" y2="2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="4" y1="5" x2="11" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="1" y1="8" x2="11" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="6" y1="11" x2="11" y2="11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </ToolbarButton>
      <ToolbarButton active={currentAlign === 'justify'} onMouseDown={() => setBlockProp('align', 'justify')} title="Justify">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <line x1="1" y1="2" x2="11" y2="2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="1" y1="5" x2="11" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="1" y1="8" x2="11" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="1" y1="11" x2="11" y2="11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </ToolbarButton>
      <LineSpacingSelector
        currentSpacing={currentLineSpacing}
        onSpacingChange={(spacing) => setBlockProp('lineSpacing', spacing)}
      />
      <div className="w-px h-4 bg-border mx-1" />
      <ToolbarButton active={false} onMouseDown={() => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = () => {
          if (input.files) insertImageFiles(editor, input.files);
        };
        input.click();
      }} title="Insert Image">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <rect x="1" y="1" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="4" cy="4.5" r="1" fill="currentColor" />
          <path d="M1.5 9L4 6.5L6 8.5L8 5.5L10.5 9" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </ToolbarButton>
      <ToolbarButton active={false} onMouseDown={() => {
        try { insertTable(editor, { rowCount: 3, colCount: 3, header: true }); } catch {
          editor.insertNode({
            type: 'table',
            children: [
              { type: 'tr', children: [
                { type: 'th', children: [{ text: 'Header 1' }] },
                { type: 'th', children: [{ text: 'Header 2' }] },
                { type: 'th', children: [{ text: 'Header 3' }] },
              ]},
              { type: 'tr', children: [
                { type: 'td', children: [{ text: '' }] },
                { type: 'td', children: [{ text: '' }] },
                { type: 'td', children: [{ text: '' }] },
              ]},
            ],
          });
        }
      }} title="Insert Table">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <rect x="1" y="1" width="10" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" />
          <line x1="1" y1="4.5" x2="11" y2="4.5" stroke="currentColor" strokeWidth="1" />
          <line x1="1" y1="7.5" x2="11" y2="7.5" stroke="currentColor" strokeWidth="1" />
          <line x1="4.5" y1="1" x2="4.5" y2="11" stroke="currentColor" strokeWidth="1" />
          <line x1="7.5" y1="1" x2="7.5" y2="11" stroke="currentColor" strokeWidth="1" />
        </svg>
      </ToolbarButton>
      <ToolbarButton active={false} onMouseDown={() => {
        editor.insertNode({ type: 'page_break', children: [{ text: '' }] });
      }} title="Page Break">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <line x1="1" y1="6" x2="4" y2="6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeDasharray="2 2" />
          <line x1="8" y1="6" x2="11" y2="6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeDasharray="2 2" />
          <rect x="4.5" y="4" width="3" height="4" rx="0.5" stroke="currentColor" strokeWidth="1" />
        </svg>
      </ToolbarButton>
      <div className="flex-1" />
      <div className="flex items-center gap-1">
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            const lower = ZOOM_LEVELS.filter((z) => z < zoom);
            if (lower.length > 0) onZoomChange(lower[lower.length - 1]);
          }}
          className="text-ink-lighter hover:text-ink transition-colors px-1"
          title="Zoom out"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        <input
          className="text-[11px] text-ink-light font-medium w-12 text-center bg-transparent focus:outline-none focus:bg-cream-dark rounded"
          style={{ fontVariantNumeric: 'tabular-nums' }}
          value={`${zoom}%`}
          onFocus={(e) => {
            e.currentTarget.value = String(zoom);
            e.currentTarget.select();
          }}
          onBlur={(e) => {
            const val = parseInt(e.currentTarget.value);
            if (!isNaN(val) && val >= 25 && val <= 400) {
              onZoomChange(val);
            }
            e.currentTarget.value = `${zoom}%`;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              e.currentTarget.value = `${zoom}%`;
              e.currentTarget.blur();
            }
          }}
          onMouseDown={(e) => e.stopPropagation()}
        />
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            const higher = ZOOM_LEVELS.filter((z) => z > zoom);
            if (higher.length > 0) onZoomChange(higher[0]);
          }}
          className="text-ink-lighter hover:text-ink transition-colors px-1"
          title="Zoom in"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="6" y1="2" x2="6" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default function Editor({
  comments,
  activeCommentId,
  onCommentClick,
  onChange,
  readOnly = false,
  initialValue,
  fontName = 'Georgia',
  onFontChange,
  getDocumentText,
  onEditAccept: _onEditAccept,
  zoom = 100,
  onZoomChange,
  citations = [],
  onCite,
  onFeedbackSelection,
  editorRef: externalEditorRef,
  collabUrl,
  documentId = 'draft-default',
  isMobile = false,
}: EditorProps) {
  const fontFamily = getFontByName(fontName).family;
  const useCollab = !!collabUrl;
  const commentsRef = useRef(comments);
  const activeIdRef = useRef(activeCommentId);
  const clickRef = useRef(onCommentClick);
  const pageBackgroundRef = useRef<HTMLDivElement>(null);

  // Inline edit state
  const [editState, setEditState] = useState<{
    selectedText: string;
    position: { top: number; left: number };
  } | null>(null);
  const editTextRef = useRef<string | null>(null);
  // Tracks proposed text currently shown inline in the doc
  const [proposedEdit, setProposedEdit] = useState<{
    originalText: string;
    proposedText: string;
  } | null>(null);
  const proposedTextRef = useRef<string | null>(null);

  useEffect(() => {
    commentsRef.current = comments;
    activeIdRef.current = activeCommentId;
    clickRef.current = onCommentClick;
  }, [comments, activeCommentId, onCommentClick]);

  const editor = usePlateEditor(
    {
      plugins: [
        BasicBlocksPlugin,
        BasicMarksPlugin,
        ListPlugin,
        LinkPlugin,
        ImagePlugin,
        TablePlugin,
        CitationLinkPlugin,
        PageBreakPlugin,
        ...(useCollab ? [YjsPlugin.configure({
          options: {
            cursors: {
              data: { name: 'You', color: '#C66140' },
            },
            providers: [{
              type: 'hocuspocus' as const,
              options: { name: documentId, url: collabUrl! },
            }],
          },
        })] : []),
      ],
      skipInitialization: useCollab,
      override: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        components: {
          p: (props: any) => {
            const el = props.element;
            const style: React.CSSProperties = {};
            if (el?.align) style.textAlign = el.align;
            if (el?.lineSpacing) style.lineHeight = el.lineSpacing;
            return <PlateElement {...props} as="p" style={style} />;
          },
          [BoldPlugin.key]: (props: any) => <PlateLeaf {...props} as="strong" />,
          [ItalicPlugin.key]: (props: any) => <PlateLeaf {...props} as="em" />,
          [UnderlinePlugin.key]: (props: any) => <PlateLeaf {...props} as="u" />,
          [StrikethroughPlugin.key]: (props: any) => <PlateLeaf {...props} as="s" />,
          [CodePlugin.key]: (props: any) => (
            <PlateLeaf {...props} as="code" className="bg-cream-dark px-1 py-0.5 rounded text-sm font-mono" />
          ),
          [HighlightPlugin.key]: (props: any) => <PlateLeaf {...props} as="mark" />,
          [BlockquotePlugin.key]: (props: any) => {
            const el = props.element;
            const style: React.CSSProperties = {};
            if (el?.align) style.textAlign = el.align;
            if (el?.lineSpacing) style.lineHeight = el.lineSpacing;
            return <PlateElement {...props} as="blockquote" className="border-l-3 border-ink-lighter pl-4 italic text-ink-light my-4" style={style} />;
          },
          [H1Plugin.key]: (props: any) => {
            const el = props.element;
            const style: React.CSSProperties = {};
            if (el?.align) style.textAlign = el.align;
            if (el?.lineSpacing) style.lineHeight = el.lineSpacing;
            return <PlateElement {...props} as="h1" className="text-3xl font-bold mt-8 mb-4 leading-tight" style={style} />;
          },
          [H2Plugin.key]: (props: any) => {
            const el = props.element;
            const style: React.CSSProperties = {};
            if (el?.align) style.textAlign = el.align;
            if (el?.lineSpacing) style.lineHeight = el.lineSpacing;
            return <PlateElement {...props} as="h2" className="text-2xl font-bold mt-6 mb-3 leading-tight" style={style} />;
          },
          [H3Plugin.key]: (props: any) => {
            const el = props.element;
            const style: React.CSSProperties = {};
            if (el?.align) style.textAlign = el.align;
            if (el?.lineSpacing) style.lineHeight = el.lineSpacing;
            return <PlateElement {...props} as="h3" className="text-xl font-semibold mt-5 mb-2 leading-tight" style={style} />;
          },
          [HorizontalRulePlugin.key]: (props: any) => (
            <PlateElement {...props}>
              <hr className="border-border my-6" />
              {props.children}
            </PlateElement>
          ),
          [LinkPlugin.key]: (props: any) => (
            <PlateElement {...props} as="a" className="text-accent-ambiguous underline cursor-pointer"
              href={props.element?.url} target="_blank" rel="noopener noreferrer" />
          ),
          [ImagePlugin.key]: ImageElement,
          [TablePlugin.key]: (props: any) => (
            <PlateElement {...props} as="table" className="slate-table" />
          ),
          [TableRowPlugin.key]: (props: any) => (
            <PlateElement {...props} as="tr" />
          ),
          [TableCellPlugin.key]: (props: any) => (
            <PlateElement {...props} as="td" />
          ),
          [TableCellHeaderPlugin.key]: (props: any) => (
            <PlateElement {...props} as="th" />
          ),
          [CitationLinkPlugin.key]: (props: any) => (
            <PlateElement {...props} as="sup">
              <a
                href={`#citation-${props.element?.citationId}`}
                className="text-[11px] text-ink-light cursor-pointer hover:underline"
                style={{ verticalAlign: 'super', fontSize: '0.7em' }}
                onClick={(e: React.MouseEvent) => {
                  e.preventDefault();
                  document.getElementById(`citation-${props.element?.citationId}`)?.scrollIntoView({ behavior: 'smooth' });
                }}
              >
                [{props.element?.citationId}]
              </a>
              {props.children}
            </PlateElement>
          ),
          [PageBreakPlugin.key]: (props: any) => (
            <PlateElement {...props}>
              <div className="page-break-line" contentEditable={false}>
                <span className="page-break-label">Page Break</span>
              </div>
              {props.children}
            </PlateElement>
          ),
        } as Record<string, any>,
      },
      value: (initialValue as never) || [
        { type: 'p', children: [{ text: '' }] },
      ],
    },
    []
  );

  // Expose editor instance to parent via ref
  useEffect(() => {
    if (externalEditorRef) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (externalEditorRef as any).current = editor;
    }
    return () => {
      if (externalEditorRef) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (externalEditorRef as any).current = null;
      }
    };
  }, [editor, externalEditorRef]);

  // Initialize Yjs: connect to Hocuspocus and set initial value if doc is empty
  const [yjsReady, setYjsReady] = useState(!useCollab);
  useEffect(() => {
    if (!useCollab) return;
    let destroyed = false;

    (async () => {
      try {
        await editor.getApi(YjsPlugin).yjs.init({
          id: documentId,
          autoConnect: true,
          value: (initialValue as never) || [{ type: 'p', children: [{ text: '' }] }],
        });
      } catch (err) {
        console.warn('[Yjs] init:', (err as Error).message);
      }
      if (!destroyed) setYjsReady(true);
    })();

    return () => {
      destroyed = true;
      try { editor.getApi(YjsPlugin).yjs.destroy(); } catch { /* ignore */ }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useCollab, documentId]);

  // Connect to the WebSocket bridge for MCP server communication
  useEditorBridge(editor);

  const decorate = useCallback(
    ({ entry: [node, path] }: { editor: unknown; entry: [{ text?: string }, number[]] }) => {
      if (!node.text || typeof node.text !== 'string') return [];

      try {

      const ranges: Array<Record<string, unknown>> = [];
      const text = node.text;

      for (const comment of commentsRef.current) {
        let startIdx = 0;
        while (startIdx < text.length) {
          const idx = text.indexOf(comment.quote, startIdx);
          if (idx === -1) break;
          ranges.push({
            anchor: { path, offset: idx },
            focus: { path, offset: idx + comment.quote.length },
            commentHighlight: true,
            commentId: comment.id,
            commentType: comment.type,
          });
          startIdx = idx + comment.quote.length;
        }
      }

      // Highlight the text being edited via Cmd+K (blue tint while prompting)
      const editText = editTextRef.current;
      if (editText && !proposedTextRef.current) {
        let startIdx = 0;
        while (startIdx < text.length) {
          const idx = text.indexOf(editText, startIdx);
          if (idx === -1) break;
          ranges.push({
            anchor: { path, offset: idx },
            focus: { path, offset: idx + editText.length },
            editHighlight: true,
          });
          startIdx = idx + editText.length;
        }
      }

      // Highlight proposed text (green) that was applied inline
      const proposedText = proposedTextRef.current;
      if (proposedText) {
        let startIdx = 0;
        while (startIdx < text.length) {
          const idx = text.indexOf(proposedText, startIdx);
          if (idx === -1) break;
          ranges.push({
            anchor: { path, offset: idx },
            focus: { path, offset: idx + proposedText.length },
            proposedHighlight: true,
          });
          startIdx = idx + proposedText.length;
        }
      }

      return ranges;
      } catch {
        // Yjs remote edits can invalidate paths mid-decorate — safe to skip
        return [];
      }
    },
    []
  );

  const renderLeaf = useCallback(
    (props: {
      attributes: { className?: string; 'data-slate-leaf'?: true; style?: React.CSSProperties };
      children: React.ReactNode;
      leaf: Record<string, unknown>;
    }) => {
      const { attributes, children, leaf } = props;

      const inlineStyle: React.CSSProperties = { ...attributes.style };
      if (leaf.fontFamily) inlineStyle.fontFamily = leaf.fontFamily as string;
      if (leaf.fontSize) inlineStyle.fontSize = leaf.fontSize as string;

      if (leaf.editHighlight) {
        inlineStyle.backgroundColor = 'rgba(59, 130, 246, 0.15)';
        inlineStyle.borderRadius = 2;
        inlineStyle.padding = '1px 0';
      }

      if (leaf.proposedHighlight) {
        inlineStyle.backgroundColor = 'rgba(34, 197, 94, 0.15)';
        inlineStyle.borderLeft = '2px solid rgba(34, 197, 94, 0.5)';
        inlineStyle.borderRadius = 2;
        inlineStyle.padding = '1px 2px';
      }

      // MCP inline comments (marks like comment_xxx: true)
      // Use for...in loop for early exit instead of Object.keys().some() (js-early-exit)
      let hasCommentMark = false;
      for (const k in leaf) {
        if (k.charCodeAt(0) === 99 /* 'c' */ && k.startsWith('comment_')) {
          hasCommentMark = true;
          break;
        }
      }
      if (hasCommentMark) {
        inlineStyle.backgroundColor = 'rgba(255, 200, 50, 0.25)';
        inlineStyle.borderBottom = '2px solid rgba(255, 180, 0, 0.6)';
        inlineStyle.borderRadius = 2;
        inlineStyle.cursor = 'pointer';
        inlineStyle.padding = '1px 0';
      }

      if (leaf.commentHighlight) {
        const commentId = leaf.commentId as string;
        const commentType = (leaf.commentType as string) || 'vague';
        const isActive = commentId === activeIdRef.current;
        Object.assign(
          inlineStyle,
          isActive ? HIGHLIGHT_ACTIVE_STYLES[commentType] : HIGHLIGHT_STYLES[commentType],
        );

        return (
          <span
            {...attributes}
            style={inlineStyle}
            onClick={(e) => {
              e.stopPropagation();
              clickRef.current(commentId);
            }}
          >
            {children}
          </span>
        );
      }

      return <span {...attributes} style={inlineStyle}>{children}</span>;
    },
    []
  );

  const handleChange = useCallback(
    ({ value }: { value: unknown[] }) => {
      onChange(value);
    },
    [onChange]
  );

  useEffect(() => {
    try {
      (editor as unknown as { api: { redecorate: () => void } }).api.redecorate();
    } catch {
      // ignore
    }
  }, [comments, activeCommentId, editor]);

  // Cmd+K handler — opens inline edit popover above selection
  useEffect(() => {
    if (readOnly) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        try {
          const sel = (editor as AnyEditor).getFragment();
          if (!sel) return;
          const text = sel
            .flatMap((node: any) =>
              (node.children || []).map((c: any) => c.text || '')
            )
            .join('');
          if (!text.trim()) return;

          // Get selection position relative to the page-background container
          const domSelection = window.getSelection();
          if (!domSelection || domSelection.rangeCount === 0) return;
          const range = domSelection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          const container = pageBackgroundRef.current;
          if (!container) return;
          const containerRect = container.getBoundingClientRect();

          editTextRef.current = text;
          setEditState({
            selectedText: text,
            position: {
              top: rect.top - containerRect.top + container.scrollTop - 8,
              left: rect.left - containerRect.left,
            },
          });
          // Redecorate to show the highlight
          try {
            (editor as unknown as { api: { redecorate: () => void } }).api.redecorate();
          } catch { /* ignore */ }
        } catch {
          // ignore
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [editor, readOnly]);

  // Called when AI proposes an edit — apply it inline in the document
  const handlePropose = useCallback((originalText: string, proposedText: string) => {
    // When iterating, the document contains the previous proposal, not the original text
    const textToReplace = proposedTextRef.current || originalText;

    const val = (editor as AnyEditor).children;
    const serialized = JSON.stringify(val);
    const origEscaped = JSON.stringify(textToReplace).slice(1, -1);
    const propEscaped = JSON.stringify(proposedText).slice(1, -1);
    const updated = JSON.parse(serialized.replace(origEscaped, propEscaped));

    // Reset editor content with proposed text
    (editor as AnyEditor).children = updated;
    (editor as AnyEditor).onChange();

    // Track the proposed text for highlighting
    editTextRef.current = null;
    proposedTextRef.current = proposedText;
    setProposedEdit({ originalText, proposedText });

    try {
      (editor as unknown as { api: { redecorate: () => void } }).api.redecorate();
    } catch { /* ignore */ }
  }, [editor]);

  // Accept: keep the proposed text, clear highlights
  const handleEditAccept = useCallback(() => {
    proposedTextRef.current = null;
    editTextRef.current = null;
    setProposedEdit(null);
    setEditState(null);
    // Notify parent to sync the value
    onChange((editor as AnyEditor).children);
    try {
      (editor as unknown as { api: { redecorate: () => void } }).api.redecorate();
    } catch { /* ignore */ }
  }, [editor, onChange]);

  // Reject: revert to original text
  const handleEditReject = useCallback(() => {
    if (proposedEdit) {
      const val = (editor as AnyEditor).children;
      const serialized = JSON.stringify(val);
      const propEscaped = JSON.stringify(proposedEdit.proposedText).slice(1, -1);
      const origEscaped = JSON.stringify(proposedEdit.originalText).slice(1, -1);
      const reverted = JSON.parse(serialized.replace(propEscaped, origEscaped));
      (editor as AnyEditor).children = reverted;
      (editor as AnyEditor).onChange();
      onChange(reverted);
    }
    proposedTextRef.current = null;
    editTextRef.current = null;
    setProposedEdit(null);
    setEditState(null);
    try {
      (editor as unknown as { api: { redecorate: () => void } }).api.redecorate();
    } catch { /* ignore */ }
  }, [editor, proposedEdit, onChange]);

  const handleEditDismiss = useCallback(() => {
    if (proposedEdit) {
      // If there's an active proposal, reject it first
      handleEditReject();
    } else {
      editTextRef.current = null;
      proposedTextRef.current = null;
      setProposedEdit(null);
      setEditState(null);
      try {
        (editor as unknown as { api: { redecorate: () => void } }).api.redecorate();
      } catch { /* ignore */ }
    }
  }, [editor, proposedEdit, handleEditReject]);

  const getSelectedText = useCallback(() => {
    try {
      const sel = (editor as AnyEditor).getFragment();
      if (!sel) return '';
      return sel
        .flatMap((node: any) =>
          (node.children || []).map((c: any) => c.text || '')
        )
        .join('');
    } catch {
      return '';
    }
  }, [editor]);

  // Wrap onChange to catch errors from Yjs remote updates
  const safeHandleChange = useCallback(
    (args: { value: unknown[] }) => {
      try {
        handleChange(args);
      } catch {
        // Yjs remote edits can cause transient errors during reconciliation
      }
    },
    [handleChange]
  );

  if (!yjsReady) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-ink-lighter gap-2">
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        Connecting to document...
      </div>
    );
  }

  return (
    <EditorErrorBoundary>
    <Plate
      editor={editor}
      onChange={safeHandleChange}
      decorate={decorate as never}
      renderLeaf={renderLeaf as never}
      readOnly={readOnly}
    >
      {!readOnly && <Toolbar fontName={fontName} onFontChange={onFontChange || (() => {})} zoom={zoom} onZoomChange={onZoomChange || (() => {})} isMobile={isMobile} />}
      <div ref={pageBackgroundRef} className="page-background flex-1 overflow-y-auto custom-scrollbar relative">
        {!readOnly && isMobile && <ScrollAssist scrollContainerRef={pageBackgroundRef} isMobile={isMobile} />}
        {!readOnly && <TableToolbar editor={editor as AnyEditor} />}
        {!readOnly && !editState && (
          <SelectionToolbar
            containerRef={pageBackgroundRef}
            onEdit={(text, pos) => {
              editTextRef.current = text;
              setEditState({ selectedText: text, position: pos });
              try {
                (editor as unknown as { api: { redecorate: () => void } }).api.redecorate();
              } catch { /* ignore */ }
            }}
            onCite={async (text) => {
              if (onCite) {
                const citationId = await onCite(text);
                // Collapse selection to end so we insert AFTER the highlighted text
                const { selection } = editor;
                if (selection) {
                  const end = (editor as AnyEditor).end(selection);
                  (editor as AnyEditor).select(end);
                }
                (editor as AnyEditor).insertNode({
                  type: 'citation_link',
                  citationId,
                  children: [{ text: `(${citationId})` }],
                });
              }
            }}
            onFeedback={onFeedbackSelection}
          />
        )}
        {editState && (
          <InlineEditPanel
            selectedText={editState.selectedText}
            documentText={getDocumentText?.() || ''}
            position={editState.position}
            onPropose={handlePropose}
            onAccept={handleEditAccept}
            onReject={handleEditReject}
            onDismiss={handleEditDismiss}
            hasProposal={!!proposedEdit}
          />
        )}
        <div
          className="page-container"
          style={{
            position: 'relative',
            transform: zoom !== 100 ? `scale(${zoom / 100})` : undefined,
            transformOrigin: 'top center',
          }}
        >
          <PlateContent
            className="page-content focus:outline-none"
            placeholder="Start writing your draft..."
            style={{ fontFamily }}
            onPaste={(e: React.ClipboardEvent) => {
              const items = e.clipboardData?.items;
              if (!items) return;
              const imageFiles: File[] = [];
              for (let i = 0; i < items.length; i++) {
                if (items[i].type.startsWith('image/')) {
                  const file = items[i].getAsFile();
                  if (file) imageFiles.push(file);
                }
              }
              if (imageFiles.length > 0) {
                e.preventDefault();
                insertImageFiles(editor, imageFiles);
              }
            }}
            onDrop={(e: React.DragEvent) => {
              const files = e.dataTransfer?.files;
              if (!files) return;
              const imageFiles: File[] = [];
              for (let i = 0; i < files.length; i++) {
                if (files[i].type.startsWith('image/')) {
                  imageFiles.push(files[i]);
                }
              }
              if (imageFiles.length > 0) {
                e.preventDefault();
                insertImageFiles(editor, imageFiles);
              }
            }}
          />
          {/* CursorOverlay temporarily disabled for debugging */}
          {citations.length > 0 && (
            <div className="page-content !pt-0 !min-h-0" style={{ fontFamily }}>
              <hr className="border-border mb-6" />
              <h3 className="text-sm font-semibold text-ink mb-3">Works Cited</h3>
              <ol className="list-decimal list-inside space-y-2">
                {citations.map((cite) => (
                  <li key={cite.id} id={`citation-${cite.id}`} className="text-xs text-ink-light leading-relaxed">
                    {cite.authors} ({cite.year}). <em>{cite.source}</em>.{' '}
                    <a href={cite.url} target="_blank" rel="noopener noreferrer" className="text-accent-ambiguous underline">
                      {cite.url}
                    </a>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </div>
      {!readOnly && (
        <StatusBar
          editorRef={pageBackgroundRef}
          getDocumentText={getDocumentText || (() => '')}
          getSelectedText={getSelectedText}
        />
      )}
    </Plate>
    </EditorErrorBoundary>
  );
}
