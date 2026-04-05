import { useState, useEffect, useRef, useCallback } from 'react';

interface FindReplaceProps {
  visible: boolean;
  onClose: () => void;
  getDocumentText: () => string;
  /** Called to scroll to and highlight the nth match */
  onHighlight: (matchIndex: number, matches: { start: number; end: number }[]) => void;
  /** Called to replace text at a given range */
  onReplace: (start: number, end: number, replacement: string) => void;
}

export default function FindReplace({
  visible,
  onClose,
  getDocumentText,
  onHighlight,
  onReplace,
}: FindReplaceProps) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [matches, setMatches] = useState<{ start: number; end: number }[]>([]);
  const [currentMatch, setCurrentMatch] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when visible
  useEffect(() => {
    if (visible) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
      setReplacement('');
      setMatches([]);
      setCurrentMatch(0);
      setShowReplace(false);
    }
  }, [visible]);

  // Recompute matches when query or doc changes
  const search = useCallback(() => {
    if (!query) {
      setMatches([]);
      setCurrentMatch(0);
      return;
    }
    const text = getDocumentText();
    const found: { start: number; end: number }[] = [];
    const lower = text.toLowerCase();
    const q = query.toLowerCase();
    let idx = 0;
    while (idx < lower.length) {
      const pos = lower.indexOf(q, idx);
      if (pos === -1) break;
      found.push({ start: pos, end: pos + q.length });
      idx = pos + 1;
    }
    setMatches(found);
    if (found.length > 0) {
      setCurrentMatch(0);
      onHighlight(0, found);
    }
  }, [query, getDocumentText, onHighlight]);

  useEffect(() => {
    search();
  }, [search]);

  const goToMatch = (index: number) => {
    if (matches.length === 0) return;
    const i = ((index % matches.length) + matches.length) % matches.length;
    setCurrentMatch(i);
    onHighlight(i, matches);
  };

  const handleReplace = () => {
    if (matches.length === 0) return;
    const m = matches[currentMatch];
    onReplace(m.start, m.end, replacement);
    // Re-search after replacement
    setTimeout(search, 50);
  };

  const handleReplaceAll = () => {
    if (matches.length === 0) return;
    // Replace from end to start to preserve indices
    const sorted = [...matches].sort((a, b) => b.start - a.start);
    for (const m of sorted) {
      onReplace(m.start, m.end, replacement);
    }
    setTimeout(search, 50);
  };

  if (!visible) return null;

  return (
    <div
      className="absolute top-2 right-4 z-50 rounded-lg shadow-lg border border-border"
      style={{
        backgroundColor: 'var(--color-cream, #FAFAF8)',
        minWidth: 320,
        maxWidth: 420,
      }}
    >
      <div className="flex items-center gap-2 p-2">
        {/* Toggle replace expand */}
        <button
          onClick={() => setShowReplace(prev => !prev)}
          className="text-ink-lighter hover:text-ink transition-colors shrink-0"
          title={showReplace ? 'Hide replace' : 'Show replace'}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
            style={{ transform: showReplace ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 150ms' }}>
            <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Search input */}
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              goToMatch(e.shiftKey ? currentMatch - 1 : currentMatch + 1);
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
          placeholder="Find..."
          className="flex-1 text-sm bg-transparent border-none outline-none text-ink placeholder:text-ink-lighter min-w-0"
          style={{ fontFamily: 'inherit' }}
        />

        {/* Match count */}
        <span className="text-xs text-ink-lighter shrink-0 tabular-nums">
          {query ? `${matches.length > 0 ? currentMatch + 1 : 0}/${matches.length}` : ''}
        </span>

        {/* Prev / Next */}
        <button onClick={() => goToMatch(currentMatch - 1)} className="text-ink-lighter hover:text-ink transition-colors" title="Previous (Shift+Enter)">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M10 9L7 6L4 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <button onClick={() => goToMatch(currentMatch + 1)} className="text-ink-lighter hover:text-ink transition-colors" title="Next (Enter)">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M4 5L7 8L10 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Close */}
        <button onClick={onClose} className="text-ink-lighter hover:text-ink transition-colors ml-1" title="Close (Esc)">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M4 4l6 6M10 4l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {/* Replace row */}
      {showReplace && (
        <div className="flex items-center gap-2 px-2 pb-2">
          <div className="w-3 shrink-0" /> {/* spacer to align with search input */}
          <input
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); handleReplace(); }
              if (e.key === 'Escape') { e.preventDefault(); onClose(); }
            }}
            placeholder="Replace..."
            className="flex-1 text-sm bg-transparent border-none outline-none text-ink placeholder:text-ink-lighter min-w-0"
          />
          <button onClick={handleReplace} className="text-xs px-2 py-0.5 rounded text-ink-light hover:text-ink hover:bg-cream-dark transition-colors" title="Replace">
            Replace
          </button>
          <button onClick={handleReplaceAll} className="text-xs px-2 py-0.5 rounded text-ink-light hover:text-ink hover:bg-cream-dark transition-colors" title="Replace All">
            All
          </button>
        </div>
      )}
    </div>
  );
}
