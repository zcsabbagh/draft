import { useState, useRef, useEffect, useCallback, useMemo, useTransition, memo, useLayoutEffect } from 'react';
import MarkdownContent from './MarkdownContent';
import type { FeedbackComment, ChatMessage, CommentThread } from '../lib/types';

// ── Reviewer Personas ──
// Each feedback type maps to an animal reviewer with a personality

interface Persona {
  name: string;
  emoji: string;
  color: string;       // avatar background
  highlight: string;   // matching highlight color
  accent: string;      // text accent
  tagline: string;     // what they focus on
}

const PERSONAS: Record<string, Persona> = {
  vague: {
    name: 'Clarity Owl',
    emoji: '🦉',
    color: '#E8A87C',
    highlight: '#FFF3E8',
    accent: '#C07A4A',
    tagline: 'Precision & specificity',
  },
  unsupported: {
    name: 'Evidence Fox',
    emoji: '🦊',
    color: '#D4726A',
    highlight: '#FFECE9',
    accent: '#B5504A',
    tagline: 'Claims & evidence',
  },
  'logical-gap': {
    name: 'Logic Panda',
    emoji: '🐼',
    color: '#7B68A8',
    highlight: '#F0ECF7',
    accent: '#5E4E87',
    tagline: 'Reasoning & structure',
  },
  ambiguous: {
    name: 'Precision Turtle',
    emoji: '🐢',
    color: '#5B8FA8',
    highlight: '#EBF3F7',
    accent: '#3D6E84',
    tagline: 'Clarity & meaning',
  },
};

function getPersona(type: string): Persona {
  return PERSONAS[type] || PERSONAS.vague;
}

// ── Avatar component ──

function ReviewerAvatar({ type, size = 32 }: { type: string; size?: number }) {
  const persona = getPersona(type);
  return (
    <div
      className="reviewer-avatar"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: persona.color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.5,
        flexShrink: 0,
        boxShadow: `0 0 0 2px ${persona.highlight}`,
      }}
    >
      {persona.emoji}
    </div>
  );
}

// ── Comment card (list view) ──

const CommentCard = memo(function CommentCard({
  comment,
  onSelect,
  onResolve,
  resolved,
}: {
  comment: FeedbackComment;
  onSelect: (id: string) => void;
  onResolve: (id: string) => void;
  resolved: boolean;
}) {
  const persona = getPersona(comment.type);

  return (
    <div
      className={`comment-card group ${resolved ? 'opacity-50' : ''}`}
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 88px' }}
    >
      <button
        onClick={() => onSelect(comment.id)}
        className="w-full text-left p-3 hover:bg-cream-dark/50 transition-colors flex gap-3"
      >
        <ReviewerAvatar type={comment.type} size={36} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs font-semibold" style={{ color: persona.accent }}>
              {persona.name}
            </span>
            <span className="text-[10px] text-ink-lighter">{persona.tagline}</span>
          </div>
          <p className="text-xs text-ink-lighter italic mb-0.5 line-clamp-1">
            &ldquo;{comment.quote}&rdquo;
          </p>
          <p className="text-sm text-ink line-clamp-2">{comment.comment}</p>
        </div>
      </button>
      {/* Resolve button — appears on hover */}
      <button
        onClick={(e) => { e.stopPropagation(); onResolve(comment.id); }}
        className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-cream-dark"
        title={resolved ? 'Unresolve' : 'Resolve'}
      >
        {resolved ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 7L6 10L11 4" stroke="#22C55E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" className="text-ink-lighter" />
            <path d="M4.5 7L6 8.5L9.5 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-lighter" />
          </svg>
        )}
      </button>
    </div>
  );
});

// ── Thread message with persona awareness ──

const ThreadMessage = memo(function ThreadMessage({
  msg,
  commentType,
}: {
  msg: ChatMessage;
  commentType?: string;
}) {
  const persona = commentType ? getPersona(commentType) : null;

  if (msg.role === 'user') {
    return (
      <div className="text-sm leading-relaxed p-3 rounded-lg bg-cream-dark ml-8 text-ink">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-lighter block mb-1">
          You
        </span>
        {msg.content}
      </div>
    );
  }

  return (
    <div className="text-sm leading-relaxed p-3 rounded-lg bg-white border border-border mr-2 text-ink flex gap-2.5">
      {persona && <ReviewerAvatar type={commentType!} size={24} />}
      <div className="flex-1 min-w-0">
        <span
          className="text-[10px] font-semibold uppercase tracking-wider block mb-1"
          style={{ color: persona?.accent || '#9B9B9B' }}
        >
          {persona?.name || 'Claude'}
        </span>
        <MarkdownContent content={msg.content} />
      </div>
    </div>
  );
});

// ── Pill tabs ──

type Tab = 'feedback' | 'chat' | 'rubric' | 'context';

const TABS: { key: Tab; label: string }[] = [
  { key: 'feedback', label: 'Feedback' },
  { key: 'chat', label: 'Chat' },
  { key: 'rubric', label: 'Rubric' },
  { key: 'context', label: 'Context' },
];

function PillTabs({ tabs, activeTab, onTabSwitch }: {
  tabs: { key: Tab; label: string }[];
  activeTab: Tab;
  onTabSwitch: (key: Tab) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pillStyle, setPillStyle] = useState<{ left: number; width: number }>({ left: 0, width: 0 });

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const activeIdx = tabs.findIndex((t) => t.key === activeTab);
    const buttons = container.querySelectorAll<HTMLButtonElement>('button');
    const btn = buttons[activeIdx];
    if (btn) {
      setPillStyle({ left: btn.offsetLeft, width: btn.offsetWidth });
    }
  }, [activeTab, tabs]);

  return (
    <div ref={containerRef} className="inline-flex items-center bg-cream-dark rounded-full p-0.5 relative">
      <div
        className="absolute top-0.5 bottom-0.5 rounded-full bg-white shadow-sm transition-all duration-250 ease-out"
        style={{ left: pillStyle.left, width: pillStyle.width }}
      />
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onTabSwitch(tab.key)}
          className={`relative z-10 text-xs px-4 py-1.5 rounded-full font-medium transition-colors duration-150 ${
            activeTab === tab.key
              ? 'text-ink'
              : 'text-ink-lighter hover:text-ink-light'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ── Main ChatPanel ──

interface ChatPanelProps {
  comments: FeedbackComment[];
  activeCommentId: string | null;
  threads: Record<string, CommentThread>;
  onSelectComment: (id: string | null) => void;
  onSendMessage: (commentId: string, message: string) => void;
  isLoading: boolean;
  isChatLoading: boolean;
  rubric: string;
  onRubricChange: (rubric: string) => void;
  context: string;
  onContextChange: (context: string) => void;
  onChatMessage?: (message: string, history: ChatMessage[], onChunk: (text: string) => void) => Promise<string>;
  onResolveComment?: (id: string) => void;
  resolvedComments?: Set<string>;
}

export default function ChatPanel({
  comments,
  activeCommentId,
  threads,
  onSelectComment,
  onSendMessage,
  isLoading,
  isChatLoading,
  rubric,
  onRubricChange,
  context,
  onContextChange,
  onChatMessage,
  onResolveComment,
  resolvedComments,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('feedback');
  const [, startTransition] = useTransition();
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [localResolved, setLocalResolved] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const activeThread = activeCommentId ? threads[activeCommentId] : null;
  const activeComment = useMemo(
    () => comments.find((c) => c.id === activeCommentId),
    [comments, activeCommentId],
  );

  const resolved = resolvedComments || localResolved;

  const handleResolve = useCallback((id: string) => {
    if (onResolveComment) {
      onResolveComment(id);
    } else {
      setLocalResolved((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }
  }, [onResolveComment]);

  // Sort: unresolved first, resolved at bottom
  const sortedComments = useMemo(() => {
    return [...comments].sort((a, b) => {
      const aResolved = resolved.has(a.id) ? 1 : 0;
      const bResolved = resolved.has(b.id) ? 1 : 0;
      return aResolved - bResolved;
    });
  }, [comments, resolved]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeThread?.messages.length]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages.length]);

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!input.trim() || !activeCommentId) return;
      onSendMessage(activeCommentId, input.trim());
      setInput('');
    },
    [input, activeCommentId, onSendMessage],
  );

  const handleChatSubmit = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!chatInput.trim() || chatLoading || !onChatMessage) return;

    const msg = chatInput.trim();
    const history = [...chatMessages];
    setChatMessages((prev) => [...prev, { role: 'user', content: msg }]);
    setChatInput('');
    setChatLoading(true);

    const streamIdx = chatMessages.length + 1;
    setChatMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

    try {
      await onChatMessage(msg, history, (text) => {
        setChatMessages((prev) => {
          const updated = [...prev];
          updated[streamIdx] = { role: 'assistant', content: text };
          return updated;
        });
      });
    } catch (e) {
      setChatMessages((prev) => {
        const updated = [...prev];
        updated[streamIdx] = { role: 'assistant', content: `Error: ${e instanceof Error ? e.message : String(e)}` };
        return updated;
      });
    } finally {
      setChatLoading(false);
    }
  }, [chatInput, chatLoading, onChatMessage, chatMessages]);

  const handleTabSwitch = useCallback((key: Tab) => {
    startTransition(() => {
      setActiveTab(key);
    });
  }, []);

  const unresolvedCount = comments.filter((c) => !resolved.has(c.id)).length;

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: '#F0EEE6' }}>
      {/* Tab bar */}
      <div className="flex items-center px-4 py-2">
        <PillTabs tabs={TABS} activeTab={activeTab} onTabSwitch={handleTabSwitch} />
      </div>

      {/* Tab content */}
      <div key={activeTab} className="flex-1 flex flex-col overflow-hidden animate-tab-fade-in">
        {activeTab === 'feedback' && (
          <>
            {activeComment ? (
              <>
                {/* Back button + active comment header */}
                <div className="px-4 py-2 border-b border-border flex items-center gap-3">
                  <button
                    onClick={() => onSelectComment(null)}
                    className="text-xs text-ink-lighter hover:text-ink-light shrink-0"
                  >
                    &larr;
                  </button>
                  <ReviewerAvatar type={activeComment.type} size={28} />
                  <div className="min-w-0">
                    <span className="text-xs font-semibold" style={{ color: getPersona(activeComment.type).accent }}>
                      {getPersona(activeComment.type).name}
                    </span>
                  </div>
                  <div className="flex-1" />
                  <button
                    onClick={() => handleResolve(activeComment.id)}
                    className="text-xs px-2.5 py-1 rounded-full border transition-colors"
                    style={{
                      borderColor: resolved.has(activeComment.id) ? '#22C55E' : '#E5E5E0',
                      color: resolved.has(activeComment.id) ? '#22C55E' : '#9B9B9B',
                      backgroundColor: resolved.has(activeComment.id) ? '#F0FDF4' : 'transparent',
                    }}
                  >
                    {resolved.has(activeComment.id) ? '✓ Resolved' : 'Resolve'}
                  </button>
                </div>

                {/* Comment thread */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
                  {/* Original comment as first message */}
                  <div
                    className="rounded-lg p-3 border"
                    style={{
                      backgroundColor: getPersona(activeComment.type).highlight,
                      borderColor: getPersona(activeComment.type).color + '40',
                    }}
                  >
                    <p className="text-xs text-ink-lighter italic mb-2 border-l-2 pl-2" style={{ borderColor: getPersona(activeComment.type).color }}>
                      &ldquo;{activeComment.quote}&rdquo;
                    </p>
                    <p className="text-sm text-ink leading-relaxed">
                      {activeComment.comment}
                    </p>
                  </div>

                  {activeThread?.messages.map((msg, i) => (
                    <ThreadMessage key={i} msg={msg} commentType={activeComment.type} />
                  ))}

                  {isChatLoading && (
                    <div className="flex items-center gap-2 text-xs text-ink-lighter italic p-3">
                      <ReviewerAvatar type={activeComment.type} size={18} />
                      Thinking...
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Reply input */}
                <form onSubmit={handleSubmit} className="p-3 border-t border-border flex gap-2">
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={`Chat with ${getPersona(activeComment.type).name}...`}
                    className="flex-1 text-sm px-3 py-2 rounded-lg bg-cream-dark border border-border focus:outline-none focus:border-ink-lighter text-ink placeholder:text-ink-lighter"
                    disabled={isChatLoading}
                  />
                  <button
                    type="submit"
                    disabled={!input.trim() || isChatLoading}
                    className="text-sm px-3 py-2 rounded-lg font-medium disabled:opacity-40 transition-colors"
                    style={{
                      backgroundColor: getPersona(activeComment.type).color,
                      color: '#FAFAF8',
                    }}
                  >
                    Send
                  </button>
                </form>
              </>
            ) : (
              <div className="flex-1 overflow-y-auto custom-scrollbar">
                {isLoading ? (
                  <div className="flex flex-col items-center justify-center h-40 gap-3">
                    {/* Animated reviewer avatars appearing */}
                    <div className="flex items-center gap-2 reviewer-loading">
                      {Object.keys(PERSONAS).map((type, i) => (
                        <div key={type} className="reviewer-avatar-enter" style={{ animationDelay: `${i * 150}ms` }}>
                          <ReviewerAvatar type={type} size={28} />
                        </div>
                      ))}
                    </div>
                    <span className="text-sm text-ink-lighter">Reviewers are reading your draft...</span>
                  </div>
                ) : comments.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full px-6 py-10 text-center">
                    {/* Reviewer avatars in a stacked cluster */}
                    <div className="flex items-center -space-x-2 mb-5">
                      {Object.keys(PERSONAS).map((type, i) => (
                        <div key={type} style={{ zIndex: 4 - i }}>
                          <ReviewerAvatar type={type} size={36} />
                        </div>
                      ))}
                    </div>

                    <p className="text-sm font-medium text-ink mb-1.5">
                      Your review team is ready
                    </p>
                    <p className="text-xs text-ink-lighter leading-relaxed max-w-[220px] mb-5">
                      Four reviewers will examine your writing for clarity, evidence, logic, and precision.
                    </p>

                    {/* Reviewer legend */}
                    <div className="w-full max-w-[240px] space-y-2 mb-6">
                      {Object.entries(PERSONAS).map(([type, persona]) => (
                        <div key={type} className="flex items-center gap-2.5">
                          <ReviewerAvatar type={type} size={20} />
                          <div className="flex-1 text-left">
                            <span className="text-[11px] font-medium text-ink">{persona.name}</span>
                            <span className="text-[10px] text-ink-lighter ml-1.5">{persona.tagline}</span>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center gap-1.5 text-[10px] text-ink-lighter">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="opacity-50">
                        <path d="M6 1v4l2.5 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                        <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
                      </svg>
                      Select text or click <strong className="font-medium text-ink-light">Request Feedback</strong>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Summary bar */}
                    <div className="px-4 py-2 border-b border-border flex items-center gap-2">
                      <span className="text-xs text-ink-lighter">
                        {unresolvedCount} {unresolvedCount === 1 ? 'comment' : 'comments'}
                      </span>
                      {resolved.size > 0 && (
                        <span className="text-xs text-green-600">
                          · {resolved.size} resolved
                        </span>
                      )}
                    </div>
                    <div className="divide-y divide-border/50">
                      {sortedComments.map((comment) => (
                        <CommentCard
                          key={comment.id}
                          comment={comment}
                          onSelect={onSelectComment}
                          onResolve={handleResolve}
                          resolved={resolved.has(comment.id)}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}

        {activeTab === 'chat' && (
          <>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
              {chatMessages.length === 0 ? (
                <div className="text-sm text-ink-lighter">
                  <p className="mb-2">Chat with Claude about your document.</p>
                  <p>Ask questions, get suggestions, or brainstorm ideas.</p>
                </div>
              ) : (
                chatMessages.map((msg, i) => (
                  <ThreadMessage key={i} msg={msg} />
                ))
              )}
              {chatLoading && (
                <div className="text-xs text-ink-lighter italic p-3">Thinking...</div>
              )}
              <div ref={chatEndRef} />
            </div>
            <form onSubmit={handleChatSubmit} className="p-3 border-t border-border flex gap-2">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask about your document..."
                className="flex-1 text-sm px-3 py-2 rounded-lg bg-cream-dark border border-border focus:outline-none focus:border-ink-lighter text-ink placeholder:text-ink-lighter"
                disabled={chatLoading || !onChatMessage}
              />
              <button
                type="submit"
                disabled={!chatInput.trim() || chatLoading || !onChatMessage}
                className="text-sm px-3 py-2 rounded-lg bg-ink text-cream font-medium disabled:opacity-40 hover:bg-ink-light transition-colors"
              >
                Send
              </button>
            </form>
          </>
        )}

        {activeTab === 'rubric' && (
          <div className="flex-1 flex flex-col p-4 overflow-hidden">
            <label className="text-xs text-ink-light font-medium mb-2">
              Feedback rubric
            </label>
            <p className="text-xs text-ink-lighter mb-3">
              Describe what kind of feedback you want. This will guide the reviewers.
            </p>
            <textarea
              value={rubric}
              onChange={(e) => onRubricChange(e.target.value)}
              placeholder="e.g., Focus on argument structure, check for academic tone, flag unsupported claims..."
              className="flex-1 text-sm p-3 rounded-lg bg-cream-dark border border-border focus:outline-none focus:border-ink-lighter text-ink placeholder:text-ink-lighter resize-none custom-scrollbar"
            />
          </div>
        )}

        {activeTab === 'context' && (
          <div className="flex-1 flex flex-col p-4 overflow-hidden">
            <label className="text-xs text-ink-light font-medium mb-2">
              Document context
            </label>
            <p className="text-xs text-ink-lighter mb-3">
              Provide additional context about your document to get more relevant feedback.
            </p>
            <textarea
              value={context}
              onChange={(e) => onContextChange(e.target.value)}
              placeholder="e.g., This is a first draft of a research proposal for an academic audience. The goal is to secure funding for..."
              className="flex-1 text-sm p-3 rounded-lg bg-cream-dark border border-border focus:outline-none focus:border-ink-lighter text-ink placeholder:text-ink-lighter resize-none custom-scrollbar"
            />
          </div>
        )}
      </div>
    </div>
  );
}
