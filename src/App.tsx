import { useState, useCallback, useEffect, useRef } from 'react';
import { Agentation } from 'agentation';
import html2pdf from 'html2pdf.js';
import Editor from './components/Editor';
import ChatPanel from './components/ChatPanel';
import TimelineScrubber from './components/TimelineScrubber';
import ImportDialog from './components/ImportDialog';
import ImportNotionDialog from './components/ImportNotionDialog';
import CommandPalette from './components/CommandPalette';
import { requestFeedback, chatWithClaude, chatAboutDocumentStream, getCitation } from './lib/api';
import type { Citation } from './lib/api';
import { getFontByName, loadGoogleFont } from './lib/fonts';
import type {
  FeedbackComment,
  CommentThread,
  DocumentSnapshot,
} from './lib/types';

function extractText(value: unknown[]): string {
  const texts: string[] = [];
  function walk(nodes: unknown[]) {
    for (const node of nodes) {
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
  walk(value);
  return texts.join('\n');
}

const DEFAULT_RUBRIC = `Focus on argument structure and logical coherence. Flag any claims that lack evidence or specific examples. Check for hedging language that weakens the argument. Identify any terms that could be interpreted multiple ways.`;

const DEFAULT_CONTEXT = `This is a first draft of an op-ed about AI regulation for a general audience. The goal is to make a clear, persuasive argument while remaining nuanced. The target publication is a major newspaper opinion section.`;

const INITIAL_VALUE = [
  { type: 'p', children: [{ text: 'The impact of artificial intelligence on society is significant. Many experts believe that AI will fundamentally transform how we work, though the exact timeline remains unclear. Studies have shown that automation could replace a large number of jobs in the coming decades.' }] },
  { type: 'p', children: [{ text: 'Furthermore, the ethical implications of AI are complex. Some argue that AI systems are inherently biased, while others contend that with proper oversight, these systems can be made fair. The reality is probably somewhere in between.' }] },
  { type: 'p', children: [{ text: 'It is widely acknowledged that AI regulation is necessary. However, the current regulatory frameworks are inadequate for addressing the rapid pace of technological change. Without significant reform, we risk falling behind other nations in this critical area.' }] },
];

function getDocumentIdFromUrl(): string {
  const path = window.location.pathname;
  const match = path.match(/^\/d\/(.+)$/);
  if (match) return decodeURIComponent(match[1]);
  // No document ID in URL — generate one and redirect
  const newId = generateDocumentId();
  window.history.replaceState(null, '', `/d/${newId}`);
  return newId;
}

function generateDocumentId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 10; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

export default function App() {
  const [documentId, setDocumentId] = useState(getDocumentIdFromUrl);
  const [title, setTitle] = useState(() => localStorage.getItem('draft-title') || 'Untitled Document');
  const [shareState, setShareState] = useState<'idle' | 'copied'>('idle');
  const [comments, setComments] = useState<FeedbackComment[]>([]);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [threads, setThreads] = useState<Record<string, CommentThread>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<DocumentSnapshot[]>([]);
  const [timelineIndex, setTimelineIndex] = useState<number | null>(null);
  const [rubric, setRubric] = useState<string>(() => localStorage.getItem('draft-rubric') || DEFAULT_RUBRIC);
  const [context, setContext] = useState<string>(() => localStorage.getItem('draft-context') || DEFAULT_CONTEXT);
  const [fontName, setFontName] = useState<string>(() => localStorage.getItem('draft-font') || 'Georgia');
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importNotionDialogOpen, setImportNotionDialogOpen] = useState(false);
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [importState, setImportState] = useState<'idle' | 'success'>('idle');
  const importMenuRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [zoom, setZoom] = useState(100);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [editorInitialValue, setEditorInitialValue] = useState<unknown[]>(INITIAL_VALUE);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  const editorValueRef = useRef<unknown[]>(INITIAL_VALUE);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const plateEditorRef = useRef<any>(null);
  const snapshotTimerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // Load the persisted Google Font on mount
  useEffect(() => {
    const font = getFontByName(fontName);
    loadGoogleFont(font);
  }, [fontName]);

  const handleFontChange = useCallback((name: string) => {
    setFontName(name);
    localStorage.setItem('draft-font', name);
    const font = getFontByName(name);
    loadGoogleFont(font);
  }, []);

  // Take snapshots every 10 seconds
  useEffect(() => {
    setSnapshots([{
      timestamp: Date.now(),
      value: structuredClone(INITIAL_VALUE),
      plainText: extractText(INITIAL_VALUE),
    }]);

    snapshotTimerRef.current = setInterval(() => {
      const val = editorValueRef.current;
      const text = extractText(val);
      setSnapshots((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.plainText === text) return prev;
        return [...prev, {
          timestamp: Date.now(),
          value: structuredClone(val),
          plainText: text,
        }];
      });
    }, 10000);

    return () => clearInterval(snapshotTimerRef.current);
  }, []);

  const handleEditorChange = useCallback((value: unknown[]) => {
    editorValueRef.current = value;
  }, []);

  const handleTitleChange = useCallback((value: string) => {
    setTitle(value);
    localStorage.setItem('draft-title', value);
  }, []);

  const handleRubricChange = useCallback((value: string) => {
    setRubric(value);
    localStorage.setItem('draft-rubric', value);
  }, []);

  const handleContextChange = useCallback((value: string) => {
    setContext(value);
    localStorage.setItem('draft-context', value);
  }, []);

  const handleRequestFeedback = useCallback(async () => {
    const text = extractText(editorValueRef.current);
    if (!text.trim()) {
      setError('Write something first before requesting feedback.');
      setTimeout(() => setError(null), 3000);
      return;
    }

    setIsLoading(true);
    setError(null);
    setComments([]);
    setActiveCommentId(null);
    setThreads({});

    try {
      const feedbackComments = await requestFeedback(text, { rubric, context });
      setComments(feedbackComments);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setIsLoading(false);
    }
  }, [rubric, context]);

  const handleFeedbackSelection = useCallback(async (selectedText: string) => {
    if (!selectedText.trim()) return;

    setIsLoading(true);
    setError(null);
    setComments([]);
    setActiveCommentId(null);
    setThreads({});
    setSidebarOpen(true);

    try {
      const feedbackComments = await requestFeedback(selectedText, { rubric, context });
      setComments(feedbackComments);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setIsLoading(false);
    }
  }, [rubric, context]);

  const handleSendMessage = useCallback(
    async (commentId: string, message: string) => {
      const comment = comments.find((c) => c.id === commentId);
      if (!comment) return;

      const thread = threads[commentId] || { commentId, messages: [] };
      const updatedMessages = [...thread.messages, { role: 'user' as const, content: message }];
      setThreads((prev) => ({
        ...prev,
        [commentId]: { commentId, messages: updatedMessages },
      }));

      setIsChatLoading(true);
      try {
        const docText = extractText(editorValueRef.current);
        const reply = await chatWithClaude(docText, comment, updatedMessages);
        setThreads((prev) => ({
          ...prev,
          [commentId]: {
            commentId,
            messages: [...updatedMessages, { role: 'assistant', content: reply }],
          },
        }));
      } catch (e) {
        setError(String(e instanceof Error ? e.message : e));
      } finally {
        setIsChatLoading(false);
      }
    },
    [comments, threads]
  );

  const [exportState, setExportState] = useState<'idle' | 'success'>('idle');

  const handleExportPDF = useCallback(() => {
    const editorEl = document.querySelector('[data-slate-editor]') as HTMLElement | null;
    if (!editorEl) return;

    // Clone the editor content so we can style it for print without affecting the UI
    const clone = editorEl.cloneNode(true) as HTMLElement;

    // Build a wrapper with the title and clean print styling
    const wrapper = document.createElement('div');
    wrapper.style.fontFamily = 'Georgia, "Times New Roman", serif';
    wrapper.style.color = '#1a1a1a';
    wrapper.style.lineHeight = '1.7';
    wrapper.style.padding = '0';

    const titleEl = document.createElement('h1');
    titleEl.textContent = title;
    titleEl.style.fontFamily = 'Georgia, "Times New Roman", serif';
    titleEl.style.fontSize = '24px';
    titleEl.style.fontWeight = '700';
    titleEl.style.marginBottom = '24px';
    titleEl.style.paddingBottom = '12px';
    titleEl.style.borderBottom = '1px solid #ccc';

    // Reset clone styles for clean output
    clone.style.fontFamily = 'Georgia, "Times New Roman", serif';
    clone.style.fontSize = '13px';
    clone.style.lineHeight = '1.7';
    clone.style.color = '#1a1a1a';
    clone.style.backgroundColor = 'white';
    clone.style.padding = '0';
    clone.style.outline = 'none';
    clone.style.border = 'none';

    // Remove any highlight backgrounds from feedback annotations
    clone.querySelectorAll('span').forEach((span) => {
      span.style.backgroundColor = '';
      span.style.borderBottom = '';
      span.style.cursor = '';
    });

    wrapper.appendChild(titleEl);
    wrapper.appendChild(clone);

    const opt = {
      margin: [0.75, 0.75, 0.75, 0.75] as [number, number, number, number],
      filename: `${title.replace(/[^a-zA-Z0-9 ]/g, '').trim() || 'document'}.pdf`,
      image: { type: 'jpeg' as const, quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' as const },
    };

    html2pdf().set(opt).from(wrapper).save();
    setExportState('success');
    setTimeout(() => setExportState('idle'), 1600);
  }, [title]);

  const handleImport = useCallback((nodes: unknown[]) => {
    setEditorInitialValue(nodes);
    editorValueRef.current = nodes;
    setEditorKey((k) => k + 1);
    setComments([]);
    setActiveCommentId(null);
    setThreads({});
    setImportState('success');
    setTimeout(() => setImportState('idle'), 1600);
  }, []);

  // Close import menu on outside click
  useEffect(() => {
    if (!importMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (importMenuRef.current && !importMenuRef.current.contains(e.target as Node)) {
        setImportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [importMenuOpen]);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [exportMenuOpen]);

  const handleEditAccept = useCallback((originalText: string, newText: string) => {
    const val = editorValueRef.current;
    const updated = JSON.parse(
      JSON.stringify(val).replace(
        JSON.stringify(originalText).slice(1, -1),
        JSON.stringify(newText).slice(1, -1)
      )
    );
    setEditorInitialValue(updated);
    editorValueRef.current = updated;
    setEditorKey((k) => k + 1);
  }, []);

  const getDocumentText = useCallback(() => {
    return extractText(editorValueRef.current);
  }, []);

  const handleCite = useCallback(async (selectedText: string): Promise<number> => {
    const citation = await getCitation(selectedText);
    const nextId = citations.length + 1;
    setCitations((prev) => [...prev, { ...citation, id: nextId }]);
    return nextId;
  }, [citations.length]);

  const handleChatMessage = useCallback(async (message: string, history: { role: 'user' | 'assistant'; content: string }[], onChunk: (text: string) => void) => {
    const docText = extractText(editorValueRef.current);
    return chatAboutDocumentStream(docText, message, history, onChunk);
  }, []);

  const handleShare = useCallback(() => {
    const baseUrl = window.location.origin;
    const shareUrl = `${baseUrl}/d/${encodeURIComponent(documentId)}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setShareState('copied');
      setTimeout(() => setShareState('idle'), 1600);
    });
  }, [documentId]);

  const handleNewDocument = useCallback(() => {
    const newId = generateDocumentId();
    window.history.pushState({}, '', `/d/${newId}`);
    setDocumentId(newId);
    setEditorInitialValue(INITIAL_VALUE);
    editorValueRef.current = INITIAL_VALUE;
    setEditorKey((k) => k + 1);
    setComments([]);
    setActiveCommentId(null);
    setThreads({});
    setTitle('Untitled Document');
    localStorage.setItem('draft-title', 'Untitled Document');
  }, []);

  // Update document.title when title changes
  useEffect(() => {
    document.title = title && title !== 'Untitled Document'
      ? `${title} — Draft`
      : 'Draft';
  }, [title]);

  // Listen for popstate (browser back/forward) to update documentId
  useEffect(() => {
    const handler = () => {
      const newId = getDocumentIdFromUrl();
      setDocumentId(newId);
      setEditorKey((k) => k + 1);
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  // Cmd+, toggles sidebar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        setSidebarOpen((v) => !v);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Cmd+K opens command palette (unless text is selected, which triggers inline edit)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k' && !e.shiftKey) {
        // If text is selected in the editor, let the Editor's Cmd+K handler deal with it
        const sel = window.getSelection();
        const hasSelection = sel && sel.toString().trim().length > 0;
        if (hasSelection) return; // Editor's inline edit handler will fire
        e.preventDefault();
        setCommandPaletteOpen((v) => !v);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const isViewingHistory = timelineIndex !== null;

  return (
    <div className="flex flex-col h-screen bg-cream">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 bg-cream">
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold text-ink tracking-tight select-none">Draft</span>
          <span className="text-ink-lighter select-none">/</span>
          <input
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            className="text-sm text-ink bg-transparent border-none outline-none font-medium min-w-0 w-56 hover:bg-cream-dark focus:bg-cream-dark px-2 py-0.5 rounded transition-colors"
            placeholder="Document title..."
          />
          <span className="text-xs text-ink-lighter">
            {isViewingHistory ? 'Viewing history' : ''}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {error && (
            <span className="text-xs text-accent-unsupported">{error}</span>
          )}
          <div
            className="relative"
            ref={importMenuRef}
            onMouseEnter={() => setImportMenuOpen(true)}
            onMouseLeave={() => setImportMenuOpen(false)}
          >
            <button
              className="text-sm px-4 py-1.5 rounded-lg border border-border text-ink font-medium hover:bg-cream-dark transition-colors flex items-center gap-1.5 relative overflow-hidden min-w-[90px]"
            >
              <span className={`inline-flex items-center gap-1.5 transition-all duration-300 ${importState === 'success' ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 1v8M3.5 5.5L7 9l3.5-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M2 12h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                Import
              </span>
              {importState === 'success' && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="export-checkmark">
                    <path d="M4 9.5L7.5 13L14 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="export-checkmark-path" />
                  </svg>
                </span>
              )}
            </button>
            {importMenuOpen && (
              <div className="absolute right-0 top-full pt-1 z-50">
                <div className="w-56 bg-cream rounded-lg border border-border shadow-lg py-1">
                <button
                  onClick={() => { setImportMenuOpen(false); setImportDialogOpen(true); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-ink hover:bg-cream-dark transition-colors flex items-center gap-3"
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="shrink-0">
                    <path d="M3.5 1.5h7.086a1 1 0 0 1 .707.293l3.414 3.414a1 1 0 0 1 .293.707V15a1.5 1.5 0 0 1-1.5 1.5H3.5A1.5 1.5 0 0 1 2 15V3a1.5 1.5 0 0 1 1.5-1.5z" fill="#4285F4" />
                    <path d="M10 1.5v3.5a1 1 0 0 0 1 1h3.5" fill="#A1C4FD" />
                    <rect x="5" y="8" width="8" height="1" rx="0.5" fill="white" />
                    <rect x="5" y="10.5" width="6" height="1" rx="0.5" fill="white" />
                    <rect x="5" y="13" width="4" height="1" rx="0.5" fill="white" />
                  </svg>
                  Google Docs
                </button>
                <button
                  onClick={() => { setImportMenuOpen(false); setImportNotionDialogOpen(true); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-ink hover:bg-cream-dark transition-colors flex items-center gap-3"
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="shrink-0">
                    <rect x="2" y="2" width="14" height="14" rx="2" fill="#000" />
                    <path d="M5.5 5h2.3c1.2 0 2 .7 2 1.8v4.7c0 .3-.2.5-.5.5H6c-.3 0-.5-.2-.5-.5V5z" fill="white" />
                    <path d="M6.2 5v.8h1.3c.6 0 1 .3 1 .9v3.8H6.2" stroke="#000" strokeWidth="0.6" fill="none" />
                    <rect x="10.5" y="5" width="2.5" height="2.5" rx="0.3" fill="white" />
                  </svg>
                  Notion
                </button>
              </div>
              </div>
            )}
          </div>
          <div
            className="relative"
            ref={exportMenuRef}
            onMouseEnter={() => setExportMenuOpen(true)}
            onMouseLeave={() => setExportMenuOpen(false)}
          >
            <button
              className="text-sm px-4 py-1.5 rounded-lg border border-border text-ink font-medium hover:bg-cream-dark transition-colors flex items-center gap-1.5"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 9V1M3.5 4.5L7 1l3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M2 12h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              Export
            </button>
            {exportMenuOpen && (
              <div className="absolute right-0 top-full pt-1 z-50">
                <div className="w-44 bg-cream rounded-lg border border-border shadow-lg py-1">
                <button
                  onClick={() => { setExportMenuOpen(false); handleExportPDF(); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-ink hover:bg-cream-dark transition-colors flex items-center gap-3"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
                    <rect x="2" y="1" width="12" height="14" rx="1.5" fill="#E53E3E" />
                    <text x="8" y="10.5" textAnchor="middle" fill="white" fontSize="5" fontWeight="bold" fontFamily="system-ui">PDF</text>
                  </svg>
                  PDF
                </button>
                <button
                  onClick={() => {
                    setExportMenuOpen(false);
                    // Placeholder — .docx export not yet implemented
                    alert('DOCX export coming soon');
                  }}
                  className="w-full text-left px-4 py-2.5 text-sm text-ink hover:bg-cream-dark transition-colors flex items-center gap-3"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
                    <rect x="2" y="1" width="12" height="14" rx="1.5" fill="#2B579A" />
                    <text x="8" y="10.5" textAnchor="middle" fill="white" fontSize="4" fontWeight="bold" fontFamily="system-ui">DOC</text>
                  </svg>
                  Word (.docx)
                </button>
              </div>
              </div>
            )}
          </div>
          <button
            onClick={handleNewDocument}
            className="text-sm px-4 py-1.5 rounded-lg border border-border text-ink font-medium hover:bg-cream-dark transition-colors flex items-center gap-1.5"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            New
          </button>
          <button
            onClick={handleShare}
            className="text-sm px-4 py-1.5 rounded-lg border border-border text-ink font-medium hover:bg-cream-dark transition-colors flex items-center gap-1.5 relative overflow-hidden min-w-[85px]"
          >
            <span className={`inline-flex items-center gap-1.5 transition-all duration-300 ${shareState === 'copied' ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M4.5 8.5a2 2 0 1 1 0-3l5 2.5a2 2 0 1 1 0 1l-5-2.5Z" stroke="currentColor" strokeWidth="1.2" />
                <path d="M4.5 5.5a2 2 0 1 1 0 3l5-2.5a2 2 0 1 1 0-1l-5 2.5Z" stroke="currentColor" strokeWidth="1.2" />
              </svg>
              Share
            </span>
            {shareState === 'copied' && (
              <span className="absolute inset-0 flex items-center justify-center text-sm font-medium">
                Copied!
              </span>
            )}
          </button>
          <button
            onClick={handleRequestFeedback}
            disabled={isLoading}
            className="text-sm px-4 py-1.5 rounded-lg bg-ink text-cream font-medium hover:bg-ink-light transition-colors disabled:opacity-50"
          >
            {isLoading ? 'Reading...' : 'Request Feedback'}
          </button>
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="p-2 rounded-lg hover:bg-cream-dark transition-colors"
            title={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <rect x="1.5" y="2.5" width="15" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
              <line x1="11.5" y1="2.5" x2="11.5" y2="15.5" stroke="currentColor" strokeWidth="1.5" />
              {sidebarOpen && (
                <>
                  <line x1="13" y1="6" x2="15" y2="6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.4" />
                  <line x1="13" y1="8.5" x2="15" y2="8.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.4" />
                  <line x1="13" y1="11" x2="15" y2="11" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.4" />
                </>
              )}
            </svg>
          </button>
        </div>
      </header>

      {/* Timeline */}
      <TimelineScrubber
        snapshots={snapshots}
        activeIndex={timelineIndex}
        onScrub={setTimelineIndex}
      />

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Editor panel */}
        <div className={`${sidebarOpen ? 'w-[70%]' : 'w-full'} flex flex-col overflow-hidden transition-all duration-300 relative`}>
          {/* Main editor — always mounted to avoid Yjs remount crashes */}
          <div style={{ display: isViewingHistory ? 'none' : undefined }} className="flex flex-col flex-1 overflow-hidden">
            <Editor
              key={`editor-${editorKey}`}
              comments={comments}
              activeCommentId={activeCommentId}
              onCommentClick={setActiveCommentId}
              onChange={handleEditorChange}
              initialValue={editorInitialValue}
              fontName={fontName}
              onFontChange={handleFontChange}
              getDocumentText={getDocumentText}
              onEditAccept={handleEditAccept}
              zoom={zoom}
              onZoomChange={setZoom}
              citations={citations}
              onCite={handleCite}
              onFeedbackSelection={handleFeedbackSelection}
              editorRef={plateEditorRef}
              collabUrl={import.meta.env.VITE_COLLAB_URL || undefined}
              documentId={documentId}
            />
          </div>
          {/* Read-only snapshot overlay */}
          {isViewingHistory && (
            <div className="relative flex flex-col flex-1 overflow-hidden">
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 text-xs bg-cream-dark/90 text-ink-lighter px-3 py-1 rounded-full border border-border">
                Read-only snapshot
              </div>
              <Editor
                key={`snapshot-${timelineIndex}`}
                comments={[]}
                activeCommentId={null}
                onCommentClick={() => {}}
                onChange={() => {}}
                readOnly
                initialValue={snapshots[timelineIndex]?.value as unknown[]}
                fontName={fontName}
                onFontChange={handleFontChange}
              />
            </div>
          )}
        </div>

        {/* Chat panel */}
        <div
          className={`${sidebarOpen ? 'w-[30%] m-2 ml-0' : 'w-0 m-0'} overflow-hidden transition-all duration-300 rounded-xl`}
          style={{ backgroundColor: '#F0EEE6' }}
        >
          <ChatPanel
            comments={comments}
            activeCommentId={activeCommentId}
            threads={threads}
            onSelectComment={setActiveCommentId}
            onSendMessage={handleSendMessage}
            isLoading={isLoading}
            isChatLoading={isChatLoading}
            rubric={rubric}
            onRubricChange={handleRubricChange}
            context={context}
            onContextChange={handleContextChange}
            onChatMessage={handleChatMessage}
          />
        </div>
      </div>

      {/* Import Dialogs */}
      <ImportDialog
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        onImport={handleImport}
      />
      <ImportNotionDialog
        open={importNotionDialogOpen}
        onClose={() => setImportNotionDialogOpen(false)}
        onImport={handleImport}
      />
      {import.meta.env.DEV && <Agentation />}

      {/* Command Palette */}
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        editor={plateEditorRef.current}
        onExportPDF={handleExportPDF}
        onRequestFeedback={handleRequestFeedback}
        onOpenImportDialog={() => setImportDialogOpen(true)}
        onNewDocument={handleNewDocument}
        onShare={handleShare}
      />
    </div>
  );
}
