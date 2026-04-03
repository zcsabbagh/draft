import { useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react';
import Editor from './components/Editor';
import ChatPanel from './components/ChatPanel';
import TimelineScrubber from './components/TimelineScrubber';
import { requestFeedback, chatWithClaude, chatAboutDocumentStream, getCitation } from './lib/api';
import type { Citation } from './lib/api';
import { getFontByName, loadGoogleFont } from './lib/fonts';
import { useIsMobile } from './hooks/useIsMobile';
import { getSessionId } from './lib/session';
import { logFeedbackRequest, logFeedbackReceived, logSuggestionAccepted, logCitationRequest, logTranslateRequest, logEditProposed, logThreadMessageSent, logThreadReplyReceived, logChatMessageSent, logChatReplyReceived, saveSnapshot } from './lib/logger';
import type {
  FeedbackComment,
  CommentThread,
  DocumentSnapshot,
} from './lib/types';

import SubmitDialog from './components/SubmitDialog';
import TemplatePage from './components/TemplatePage';
import { submitDocument } from './lib/logger';
import { saveTemplate } from './lib/templates';

// Lazy-loaded components — only fetched when first rendered (bundle-dynamic-imports)
const CommandPalette = lazy(() => import('./components/CommandPalette'));
const Agentation = lazy(() => import('agentation').then(m => ({ default: m.Agentation })));

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

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

// Hoisted regex — avoids re-creation per call (js-hoist-regexp)
const DOC_ID_REGEX = /^\/d\/(.+)$/;
const TEMPLATE_ID_REGEX = /^\/t\/(.+)$/;

/** Embed mode hides header, sidebar, and timeline — used by MCP App iframe */
const IS_EMBED = new URLSearchParams(window.location.search).has('embed');

function getTemplateIdFromUrl(): string | null {
  const match = window.location.pathname.match(TEMPLATE_ID_REGEX);
  return match ? decodeURIComponent(match[1]) : null;
}

function getDocumentIdFromUrl(): string {
  const path = window.location.pathname;
  const match = path.match(DOC_ID_REGEX);
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
  const [sidebarOpen, setSidebarOpen] = useState(!IS_EMBED);
  const [zoom, setZoom] = useState(100);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [editorInitialValue, setEditorInitialValue] = useState<unknown[]>(INITIAL_VALUE);
  const [submitDialogOpen, setSubmitDialogOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [templateMode, setTemplateMode] = useState<string | null>(() => getTemplateIdFromUrl());
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateUrl, setTemplateUrl] = useState<string | null>(null);

  const [shimmerFading, setShimmerFading] = useState(false);
  const shimmerTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const editorValueRef = useRef<unknown[]>(INITIAL_VALUE);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const plateEditorRef = useRef<any>(null);
  const snapshotTimerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // Initialize anonymous session on first load
  useEffect(() => {
    getSessionId();
  }, []);

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
        const next = [...prev, {
          timestamp: Date.now(),
          value: structuredClone(val),
          plainText: text,
        }];
        // Cap at 200 snapshots to prevent unbounded memory growth
        if (next.length > 200) return next.slice(-200);
        return next;
      });
    }, 10000);

    return () => clearInterval(snapshotTimerRef.current);
  }, []);

  // Supabase auto-snapshot every 60 seconds (for study timeline reconstruction)
  useEffect(() => {
    let lastSnapshotText = '';
    const timer = setInterval(() => {
      const val = editorValueRef.current;
      const text = extractText(val);
      if (text !== lastSnapshotText && text.trim().length > 0) {
        lastSnapshotText = text;
        saveSnapshot(val, countWords(text), 'auto');
      }
    }, 60000);
    return () => clearInterval(timer);
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
    setShimmerFading(false);
    clearTimeout(shimmerTimerRef.current);
    setError(null);
    setComments([]);
    setActiveCommentId(null);
    setThreads({});

    try {
      // Log pre-feedback snapshot + request
      const wc = countWords(text);
      saveSnapshot(editorValueRef.current, wc, 'pre_feedback');
      logFeedbackRequest(text);

      const feedbackComments = await requestFeedback(text, { rubric, context });
      setComments(feedbackComments);

      for (const c of feedbackComments) {
        logFeedbackReceived(c.quote, c.comment);
      }
      saveSnapshot(editorValueRef.current, wc, 'post_feedback');
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setIsLoading(false);
      setShimmerFading(true);
      shimmerTimerRef.current = setTimeout(() => setShimmerFading(false), 800);
    }
  }, [rubric, context]);

  const handleFeedbackSelection = useCallback(async (selectedText: string) => {
    if (!selectedText.trim()) return;

    setIsLoading(true);
    setShimmerFading(false);
    clearTimeout(shimmerTimerRef.current);
    setError(null);
    setComments([]);
    setActiveCommentId(null);
    setThreads({});
    setSidebarOpen(true);

    try {
      const docText = extractText(editorValueRef.current);
      const wc = countWords(docText);
      saveSnapshot(editorValueRef.current, wc, 'pre_feedback');
      logFeedbackRequest(selectedText);

      const feedbackComments = await requestFeedback(selectedText, { rubric, context });
      setComments(feedbackComments);

      for (const c of feedbackComments) {
        logFeedbackReceived(c.quote, c.comment);
      }
      saveSnapshot(editorValueRef.current, wc, 'post_feedback');
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setIsLoading(false);
      setShimmerFading(true);
      shimmerTimerRef.current = setTimeout(() => setShimmerFading(false), 800);
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
      logThreadMessageSent(commentId, message);
      try {
        const docText = extractText(editorValueRef.current);
        const reply = await chatWithClaude(docText, comment, updatedMessages);
        logThreadReplyReceived(commentId, reply);
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

  const handleExportPDF = useCallback(async () => {
    const editorEl = document.querySelector('[data-slate-editor]') as HTMLElement | null;
    if (!editorEl) return;

    // Dynamic import — html2pdf.js is ~300KB, only load when user exports (bundle-dynamic-imports)
    const { default: html2pdf } = await import('html2pdf.js');

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
    logSuggestionAccepted(originalText, newText);
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
    logCitationRequest(selectedText);
    const citation = await getCitation(selectedText);
    // Use functional setState to avoid depending on citations.length (rerender-functional-setstate)
    let nextId = 0;
    setCitations((prev) => {
      nextId = prev.length + 1;
      return [...prev, { ...citation, id: nextId }];
    });
    return nextId;
  }, []);

  const handleChatMessage = useCallback(async (message: string, history: { role: 'user' | 'assistant'; content: string }[], onChunk: (text: string) => void) => {
    logChatMessageSent(message);
    const docText = extractText(editorValueRef.current);
    const reply = await chatAboutDocumentStream(docText, message, history, onChunk);
    logChatReplyReceived(reply);
    return reply;
  }, []);

  const handleShare = useCallback(async () => {
    const baseUrl = window.location.origin;
    const shareUrl = `${baseUrl}/d/${encodeURIComponent(documentId)}`;

    // Use native share sheet on mobile/tablet if available
    if (navigator.share) {
      try {
        await navigator.share({
          title: title || 'Draft Document',
          url: shareUrl,
        });
        return;
      } catch (e) {
        // User cancelled or share failed — fall through to clipboard
        if ((e as Error).name === 'AbortError') return;
      }
    }

    // Fallback: copy to clipboard
    navigator.clipboard.writeText(shareUrl).then(() => {
      setShareState('copied');
      setTimeout(() => setShareState('idle'), 1600);
    });
  }, [documentId, title]);

  const handleSubmitEssay = useCallback(async (studentName: string, studentIdNumber: string) => {
    const content = editorValueRef.current;
    const text = extractText(content);
    const result = await submitDocument(studentName, studentIdNumber, content, countWords(text));
    if (!result.success) {
      throw new Error(result.error || 'Submission failed');
    }
    // Dialog handles its own success state — keep it open to show the link
    setSubmitted(true);
  }, []);

  const handleSaveAsTemplate = useCallback(async () => {
    setSavingTemplate(true);
    try {
      const content = editorValueRef.current;
      const result = await saveTemplate(title, content);
      if (result.error) {
        setError(result.error);
        setTimeout(() => setError(null), 3000);
      } else {
        const url = `${window.location.origin}/t/${result.id}`;
        setTemplateUrl(url);
      }
    } finally {
      setSavingTemplate(false);
    }
  }, [title]);

  const handleTemplateCopy = useCallback((templateTitle: string, content: unknown[]) => {
    const newId = generateDocumentId();
    const copyTitle = `Copy of ${templateTitle}`;
    window.history.pushState({}, '', `/d/${newId}`);
    setTemplateMode(null);
    setDocumentId(newId);
    setEditorInitialValue(content);
    editorValueRef.current = content;
    setEditorKey((k) => k + 1);
    setComments([]);
    setActiveCommentId(null);
    setThreads({});
    setTitle(copyTitle);
    localStorage.setItem('draft-title', copyTitle);
  }, []);

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

  // Listen for popstate (browser back/forward) to update documentId or template
  useEffect(() => {
    const handler = () => {
      const tId = getTemplateIdFromUrl();
      if (tId) {
        setTemplateMode(tId);
      } else {
        setTemplateMode(null);
        const newId = getDocumentIdFromUrl();
        setDocumentId(newId);
        setEditorKey((k) => k + 1);
      }
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
  const isMobile = useIsMobile();

  // On mobile, sidebar is a full-screen overlay — close by default
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  // Mobile overflow menu
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target as Node)) {
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [mobileMenuOpen]);

  // Template view — entirely different page
  if (templateMode) {
    return <TemplatePage templateId={templateMode} onCopy={handleTemplateCopy} />;
  }

  return (
    <div className="flex flex-col h-screen bg-cream">
      {/* Header — hidden in embed mode */}
      {IS_EMBED ? null : <header className={`flex items-center justify-between ${isMobile ? 'px-3 py-2' : 'px-6 py-3'} bg-cream`}>
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className={`${isMobile ? 'text-base' : 'text-lg'} font-semibold text-ink tracking-tight select-none shrink-0`}>Draft</span>
          <span className="text-ink-lighter select-none shrink-0">/</span>
          <input
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            className={`text-sm text-ink bg-transparent border-none outline-none font-medium min-w-0 ${isMobile ? 'flex-1' : 'w-56'} hover:bg-cream-dark focus:bg-cream-dark px-2 py-0.5 rounded transition-colors`}
            placeholder="Document title..."
          />
          {!isMobile && (
            <span className="text-xs text-ink-lighter">
              {isViewingHistory ? 'Viewing history' : ''}
            </span>
          )}
        </div>

        {/* Desktop header buttons */}
        {!isMobile && (
          <div className="flex items-center gap-3">
            {error && (
              <span className="text-xs text-accent-unsupported">{error}</span>
            )}
            {/* Import/Export/New buttons hidden for study deployment */}
            <button
              onClick={handleShare}
              className="text-sm px-4 py-1.5 rounded-lg border border-border text-ink font-medium hover:bg-cream-dark transition-colors press-scale flex items-center gap-1.5 relative overflow-hidden min-w-[85px]"
            >
              <span className={`inline-flex items-center gap-1.5 transition-[opacity,transform] duration-300 ${shareState === 'copied' ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <rect x="5" y="5" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M9 5V3.5A1.5 1.5 0 0 0 7.5 2H3.5A1.5 1.5 0 0 0 2 3.5v4A1.5 1.5 0 0 0 3.5 9H5" stroke="currentColor" strokeWidth="1.3" />
                </svg>
                Copy
              </span>
              {shareState === 'copied' && (
                <span className="absolute inset-0 flex items-center justify-center text-sm font-medium">
                  Copied!
                </span>
              )}
            </button>
            <button
              onClick={handleSaveAsTemplate}
              disabled={savingTemplate}
              className="text-sm px-4 py-1.5 rounded-lg border border-border text-ink font-medium hover:bg-cream-dark transition-colors press-scale disabled:opacity-50 flex items-center gap-1.5"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 2.5A1.5 1.5 0 0 1 4.5 1h5.086a1.5 1.5 0 0 1 1.06.44l1.915 1.914A1.5 1.5 0 0 1 13 4.414V10.5A1.5 1.5 0 0 1 11.5 12h-7A1.5 1.5 0 0 1 3 10.5v-8Z" stroke="currentColor" strokeWidth="1.3" />
                <path d="M5 1v3h4V1" stroke="currentColor" strokeWidth="1.1" />
                <rect x="5" y="7.5" width="4" height="2.5" rx="0.5" stroke="currentColor" strokeWidth="1.1" />
              </svg>
              {savingTemplate ? 'Saving...' : 'Save as Template'}
            </button>
            {submitted ? (
              <span className="text-sm px-4 py-1.5 rounded-lg bg-green-50 text-green-700 border border-green-200 font-medium flex items-center gap-1.5">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 7L6 10L11 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Submitted
              </span>
            ) : (
              <button
                onClick={() => setSubmitDialogOpen(true)}
                className="text-sm px-4 py-1.5 rounded-lg border-2 border-green-600 text-green-700 font-medium hover:bg-green-50 transition-colors press-scale"
              >
                Submit
              </button>
            )}
            <button
              onClick={handleRequestFeedback}
              disabled={isLoading}
              className="text-sm px-4 py-1.5 rounded-lg bg-ink text-cream font-medium hover:bg-ink-light transition-colors press-scale disabled:opacity-50"
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
        )}

        {/* Mobile header buttons */}
        {isMobile && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={handleRequestFeedback}
              disabled={isLoading}
              className="flex items-center justify-center w-9 h-9 rounded-full bg-ink text-cream disabled:opacity-50 transition-colors press-scale"
              title="Request Feedback"
            >
              {isLoading ? (
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <line x1="3" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <line x1="3" y1="9" x2="8" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <line x1="3" y1="13" x2="10" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M13.5 7L14.2 8.5L15.5 9L14.2 9.5L13.5 11L12.8 9.5L11.5 9L12.8 8.5L13.5 7Z" fill="currentColor" />
                </svg>
              )}
            </button>
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="p-2 rounded-lg hover:bg-cream-dark transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M2 4.5h14M2 9h14M2 13.5h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            <div className="relative" ref={mobileMenuRef}>
              <button
                onClick={() => setMobileMenuOpen((v) => !v)}
                className="p-2 rounded-lg hover:bg-cream-dark transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <circle cx="9" cy="4" r="1.5" fill="currentColor" />
                  <circle cx="9" cy="9" r="1.5" fill="currentColor" />
                  <circle cx="9" cy="14" r="1.5" fill="currentColor" />
                </svg>
              </button>
              {mobileMenuOpen && (
                <div className="absolute right-0 top-full pt-1 z-50">
                  <div className="w-48 bg-cream rounded-lg border border-border shadow-lg py-1 px-1 animate-dropdown-open">
                    {submitted ? (
                      <div className="px-3 py-2.5 text-sm text-green-700 font-medium rounded-md flex items-center gap-2">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7L6 10L11 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        Submitted
                      </div>
                    ) : (
                      <button onClick={() => { setMobileMenuOpen(false); setSubmitDialogOpen(true); }} className="w-full text-left px-3 py-2.5 text-sm text-green-700 font-medium hover:bg-green-50 transition-colors rounded-md">Submit Essay</button>
                    )}
                    <button onClick={() => { setMobileMenuOpen(false); handleNewDocument(); }} className="w-full text-left px-3 py-2.5 text-sm text-ink hover:bg-cream-dark transition-colors rounded-md">New Document</button>
                    <button onClick={() => { setMobileMenuOpen(false); handleShare(); }} className="w-full text-left px-3 py-2.5 text-sm text-ink hover:bg-cream-dark transition-colors rounded-md">Share</button>
                    <button onClick={() => { setMobileMenuOpen(false); setImportDialogOpen(true); }} className="w-full text-left px-3 py-2.5 text-sm text-ink hover:bg-cream-dark transition-colors rounded-md">Import from Google Docs</button>
                    <button onClick={() => { setMobileMenuOpen(false); setImportNotionDialogOpen(true); }} className="w-full text-left px-3 py-2.5 text-sm text-ink hover:bg-cream-dark transition-colors rounded-md">Import from Notion</button>
                    <button onClick={() => { setMobileMenuOpen(false); handleExportPDF(); }} className="w-full text-left px-3 py-2.5 text-sm text-ink hover:bg-cream-dark transition-colors rounded-md">Export PDF</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </header>}

      {/* Timeline — hidden on mobile and embed mode */}
      {!isMobile && !IS_EMBED && (
        <TimelineScrubber
          snapshots={snapshots}
          activeIndex={timelineIndex}
          onScrub={setTimelineIndex}
        />
      )}

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Editor panel — always full width on mobile */}
        <div className={`${!isMobile && sidebarOpen ? 'w-[70%]' : 'w-full'} flex flex-col overflow-hidden transition-[width] duration-300 relative`}>
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
              zoom={isMobile ? 100 : zoom}
              onZoomChange={setZoom}
              citations={citations}
              onCite={handleCite}
              onFeedbackSelection={handleFeedbackSelection}
              editorRef={plateEditorRef}
              /* collabUrl removed — collab server no longer in use, enables native undo */
              documentId={documentId}
              isMobile={isMobile}
              isLoading={isLoading}
              isShimmerFading={shimmerFading}
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

        {/* Chat panel — fullscreen overlay on mobile, side panel on desktop */}
        {isMobile ? (
          sidebarOpen && (
            <div className="fixed inset-0 z-50 flex flex-col animate-fade-in" style={{ backgroundColor: '#F0EEE6', paddingBottom: 'env(safe-area-inset-bottom)' }}>
              <div className="flex items-center justify-between px-4 py-2 border-b border-border">
                <span className="text-sm font-medium text-ink">Sidebar</span>
                <button onClick={() => setSidebarOpen(false)} className="p-2 rounded-lg hover:bg-cream-dark transition-colors">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
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
          )
        ) : (
          <div
            className={`${sidebarOpen ? 'w-[30%] m-2 ml-0' : 'w-0 m-0'} overflow-hidden transition-[width,margin] duration-300 rounded-xl`}
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
        )}
      </div>

      {/* Submit dialog */}
      <SubmitDialog
        open={submitDialogOpen}
        onClose={() => setSubmitDialogOpen(false)}
        onSubmit={handleSubmitEssay}
      />

      {/* Template URL dialog */}
      {templateUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 animate-fade-in">
          <div
            className="bg-cream rounded-2xl shadow-xl border border-border w-full max-w-md mx-4 p-6 animate-dropdown-open"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-ink mb-1">Template Saved</h2>
            <p className="text-sm text-ink-lighter mb-4">
              Share this link — anyone with it can make their own copy.
            </p>
            <div className="flex items-center gap-2 mb-5">
              <input
                type="text"
                value={templateUrl}
                readOnly
                className="flex-1 text-sm px-3 py-2.5 rounded-lg bg-white border border-border text-ink font-mono select-all focus:outline-none focus:border-ink-lighter"
                onClick={(e) => (e.target as HTMLInputElement).select()}
                autoFocus
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(templateUrl);
                }}
                className="shrink-0 p-2.5 rounded-lg border border-border hover:bg-cream-dark transition-colors press-scale"
                title="Copy link"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <rect x="6" y="6" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
                  <path d="M12 6V4.5A1.5 1.5 0 0 0 10.5 3H4.5A1.5 1.5 0 0 0 3 4.5v6A1.5 1.5 0 0 0 4.5 12H6" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              </button>
            </div>
            <button
              onClick={() => setTemplateUrl(null)}
              className="w-full text-sm px-4 py-2.5 rounded-lg bg-ink text-cream font-medium hover:bg-ink-light transition-colors press-scale"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Import dialogs disabled for study deployment */}
      {import.meta.env.DEV && (
        <Suspense fallback={null}>
          <Agentation />
        </Suspense>
      )}

      {/* Command Palette — lazy loaded, only fetched on first Cmd+K */}
      {commandPaletteOpen && (
        <Suspense fallback={null}>
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
        </Suspense>
      )}
    </div>
  );
}
