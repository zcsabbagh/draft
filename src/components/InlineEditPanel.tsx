import { useState, useRef, useEffect, useCallback } from 'react';
import { proposeEdit, chatAboutEdit, translateText } from '../lib/api';
import type { EditProposal, ChatMessage } from '../lib/types';

const TRANSLATE_LANGUAGES = [
  { code: 'Spanish', label: 'Spanish' },
  { code: 'French', label: 'French' },
  { code: 'German', label: 'German' },
  { code: 'Chinese', label: 'Chinese' },
  { code: 'Japanese', label: 'Japanese' },
  { code: 'Arabic', label: 'Arabic' },
  { code: 'Portuguese', label: 'Portuguese' },
  { code: 'Korean', label: 'Korean' },
  { code: 'Italian', label: 'Italian' },
  { code: 'Hindi', label: 'Hindi' },
];

interface InlineEditPanelProps {
  selectedText: string;
  documentText: string;
  position: { top: number; left: number } | null;
  /** Called when AI proposes an edit — Editor applies it inline */
  onPropose: (originalText: string, proposedText: string) => void;
  onAccept: () => void;
  onReject: () => void;
  onDismiss: () => void;
  /** Whether a proposal is currently shown inline in the doc */
  hasProposal: boolean;
}

export default function InlineEditPanel({
  selectedText,
  documentText,
  position,
  onPropose,
  onAccept,
  onReject,
  onDismiss,
  hasProposal,
}: InlineEditPanelProps) {
  const [instruction, setInstruction] = useState('');
  const [proposal, setProposal] = useState<EditProposal | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTranslateMenu, setShowTranslateMenu] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!showTranslateMenu) inputRef.current?.focus();
  }, [showTranslateMenu]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showTranslateMenu) {
          setShowTranslateMenu(false);
        } else {
          onDismiss();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onDismiss, showTranslateMenu]);

  const handleSubmitInstruction = useCallback(async () => {
    if (!instruction.trim() || loading) return;

    setLoading(true);
    setError(null);

    try {
      const result = await proposeEdit(documentText, selectedText, instruction.trim());
      setProposal(result);
      setMessages([
        { role: 'user', content: instruction.trim() },
        { role: 'assistant', content: result.explanation },
      ]);
      onPropose(result.originalText, result.proposedText);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, [instruction, documentText, selectedText, loading, onPropose]);

  const handleChatSubmit = useCallback(async () => {
    if (!chatInput.trim() || loading || !proposal) return;

    const newMessage: ChatMessage = { role: 'user', content: chatInput.trim() };
    const updatedMessages = [...messages, newMessage];
    setMessages(updatedMessages);
    setChatInput('');
    setLoading(true);
    setError(null);

    try {
      const result = await chatAboutEdit(
        documentText,
        selectedText,
        proposal.proposedText,
        updatedMessages
      );

      if (result.type === 'proposal') {
        setProposal(result.proposal);
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: result.proposal.explanation },
        ]);
        onPropose(result.proposal.originalText, result.proposal.proposedText);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: result.content },
        ]);
      }
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, [chatInput, loading, proposal, messages, documentText, selectedText, onPropose]);

  const handleTranslate = useCallback(async (targetLanguage: string) => {
    setShowTranslateMenu(false);
    setLoading(true);
    setError(null);

    try {
      const translated = await translateText(selectedText, targetLanguage);
      setProposal({
        id: `translate-${Date.now()}`,
        originalText: selectedText,
        proposedText: translated,
        explanation: `Translated to ${targetLanguage}`,
      });
      setMessages([
        { role: 'user', content: `Translate to ${targetLanguage}` },
        { role: 'assistant', content: `Translated to ${targetLanguage}` },
      ]);
      onPropose(selectedText, translated);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, [selectedText, onPropose]);

  if (!position) return null;

  return (
    <div
      className="absolute z-50 w-[480px] max-w-[calc(100vw-32px)] bg-cream rounded-xl border border-border shadow-xl flex flex-col animate-fade-in-scale"
      style={{
        top: position.top,
        left: Math.max(0, Math.min(position.left, typeof window !== 'undefined' ? window.innerWidth - 500 : position.left)),
      }}
    >
      {/* Error display */}
      {error && (
        <div className="px-3 py-2 border-b border-border">
          <p className="text-xs text-accent-unsupported">{error}</p>
        </div>
      )}

      {/* Accept/Reject bar when proposal is active */}
      {hasProposal && (
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-lighter">
            {proposal?.explanation || 'Proposed edit'}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={onAccept}
              className="p-1 rounded hover:bg-green-100 text-green-600 transition-colors"
              title="Accept edit"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              onClick={onReject}
              className="p-1 rounded hover:bg-red-100 text-red-500 transition-colors"
              title="Reject edit"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Translate language picker — shows when user clicks Translate */}
      {showTranslateMenu && (
        <div className="px-1 py-1 border-b border-border">
          <div className="flex flex-wrap gap-1">
            {TRANSLATE_LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                onClick={() => handleTranslate(lang.code)}
                className="text-xs px-2.5 py-1 rounded-md text-ink hover:bg-cream-dark transition-colors"
              >
                {lang.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (hasProposal) {
            handleChatSubmit();
          } else {
            handleSubmitInstruction();
          }
        }}
        className="flex items-center gap-2 px-3 py-2"
      >
        <input
          ref={inputRef}
          value={hasProposal ? chatInput : instruction}
          onChange={(e) => hasProposal ? setChatInput(e.target.value) : setInstruction(e.target.value)}
          placeholder={hasProposal ? 'Iterate on this edit...' : 'Describe the edit you want...'}
          className="flex-1 text-sm bg-transparent focus:outline-none text-ink placeholder:text-ink-lighter"
          disabled={loading || showTranslateMenu}
        />
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Translate quick-action — only before a proposal */}
          {!hasProposal && !loading && (
            <button
              type="button"
              onClick={() => setShowTranslateMenu((v) => !v)}
              className={`transition-colors ${showTranslateMenu ? 'text-ink' : 'text-ink-lighter hover:text-ink'}`}
              title="Translate"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 3h6M5 3V2M3.5 3c0 2.5 1.5 5 3.5 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M6 3c0 2-1 4-3 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                <path d="M8.5 14L11 7.5L13.5 14M9 12h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          {loading ? (
            <svg className="animate-spin h-3.5 w-3.5 text-ink-lighter" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : (
            !showTranslateMenu && (
              <button
                type="submit"
                disabled={!(hasProposal ? chatInput.trim() : instruction.trim())}
                className="text-ink-lighter hover:text-ink disabled:opacity-30 transition-colors"
                title="Submit"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )
          )}
          <button
            type="button"
            onClick={onDismiss}
            className="text-ink-lighter hover:text-ink transition-colors"
            title="Close (Esc)"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3.5 3.5L10.5 10.5M10.5 3.5L3.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}
