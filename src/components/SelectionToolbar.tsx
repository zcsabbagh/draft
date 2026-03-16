import { useState, useEffect, useRef, useCallback } from 'react';

interface SelectionToolbarProps {
  containerRef: React.RefObject<HTMLElement | null>;
  onEdit: (selectedText: string, position: { top: number; left: number }) => void;
  onCite: (selectedText: string) => void;
  onFeedback?: (selectedText: string) => void;
  disabled?: boolean;
}

export default function SelectionToolbar({ containerRef, onEdit, onCite, onFeedback, disabled }: SelectionToolbarProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [selectedText, setSelectedText] = useState('');
  const [citing, setCiting] = useState(false);
  const [feedbacking, setFeedbacking] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updatePosition = useCallback(() => {
    if (disabled) return;

    const domSelection = window.getSelection();
    if (!domSelection || domSelection.isCollapsed || domSelection.rangeCount === 0) {
      hideTimeout.current = setTimeout(() => setVisible(false), 150);
      return;
    }

    const text = domSelection.toString().trim();
    if (!text) {
      setVisible(false);
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    // Check if selection is within the editor
    const range = domSelection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      setVisible(false);
      return;
    }

    if (hideTimeout.current) {
      clearTimeout(hideTimeout.current);
      hideTimeout.current = null;
    }

    const rect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    setSelectedText(text);
    setPosition({
      top: rect.top - containerRect.top + container.scrollTop - 44,
      left: rect.left - containerRect.left + rect.width / 2,
    });
    setVisible(true);
  }, [containerRef, disabled]);

  useEffect(() => {
    document.addEventListener('selectionchange', updatePosition);
    return () => {
      document.removeEventListener('selectionchange', updatePosition);
      if (hideTimeout.current) clearTimeout(hideTimeout.current);
    };
  }, [updatePosition]);

  const handleEdit = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const domSelection = window.getSelection();
    if (!domSelection || domSelection.rangeCount === 0) return;
    const range = domSelection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    onEdit(selectedText, {
      top: rect.top - containerRect.top + container.scrollTop - 8,
      left: rect.left - containerRect.left,
    });
    setVisible(false);
  }, [selectedText, onEdit, containerRef]);

  const handleCite = useCallback(async () => {
    setCiting(true);
    try {
      await onCite(selectedText);
    } finally {
      setCiting(false);
      setVisible(false);
    }
  }, [selectedText, onCite]);

  const handleFeedback = useCallback(async () => {
    if (!onFeedback) return;
    setFeedbacking(true);
    try {
      await onFeedback(selectedText);
    } finally {
      setFeedbacking(false);
      setVisible(false);
    }
  }, [selectedText, onFeedback]);

  if (!visible) return null;

  return (
    <div
      ref={toolbarRef}
      className="absolute z-50 flex items-center gap-0.5 bg-ink rounded-lg shadow-lg px-1 py-0.5 animate-slide-up-fade"
      style={{
        top: position.top,
        left: position.left,
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        onClick={handleEdit}
        className="flex items-center gap-1.5 text-xs text-cream/90 hover:text-cream px-2.5 py-1.5 rounded transition-colors"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M8.5 1.5L10.5 3.5L4 10H2V8L8.5 1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Edit
      </button>
      <div className="w-px h-4 bg-cream/20" />
      <button
        onClick={handleCite}
        disabled={citing}
        className="flex items-center gap-1.5 text-xs text-cream/90 hover:text-cream px-2.5 py-1.5 rounded transition-colors disabled:opacity-50"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2 3C2 2.44772 2.44772 2 3 2H5L6 3H9C9.55228 3 10 3.44772 10 4V9C10 9.55228 9.55228 10 9 10H3C2.44772 10 2 9.55228 2 9V3Z" stroke="currentColor" strokeWidth="1.2" />
          <path d="M4.5 6.5L5.5 7.5L7.5 5.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {citing ? 'Citing...' : 'Get Citation'}
      </button>
      {onFeedback && (
        <>
          <div className="w-px h-4 bg-cream/20" />
          <button
            onClick={handleFeedback}
            disabled={feedbacking}
            className="flex items-center gap-1.5 text-xs text-cream/90 hover:text-cream px-2.5 py-1.5 rounded transition-colors disabled:opacity-50"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M1.5 2.5a1 1 0 011-1h7a1 1 0 011 1v5a1 1 0 01-1 1H4L1.5 11V2.5Z" stroke="currentColor" strokeWidth="1.2" />
              <line x1="4" y1="4" x2="8" y2="4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
              <line x1="4" y1="6" x2="6.5" y2="6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
            </svg>
            {feedbacking ? 'Reviewing...' : 'Feedback'}
          </button>
        </>
      )}
    </div>
  );
}
