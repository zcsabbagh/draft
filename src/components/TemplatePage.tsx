import { useState, useEffect } from 'react';
import type { Template } from '../lib/templates';
import { getTemplate } from '../lib/templates';
import Editor from './Editor';

interface TemplatePageProps {
  templateId: string;
  onCopy: (title: string, content: unknown[]) => void;
}

export default function TemplatePage({ templateId, onCopy }: TemplatePageProps) {
  const [template, setTemplate] = useState<Template | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    getTemplate(templateId).then((t) => {
      if (t) {
        setTemplate(t);
      } else {
        setNotFound(true);
      }
      setLoading(false);
    });
  }, [templateId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-cream">
        <div className="text-sm text-ink-lighter animate-pulse">Loading template...</div>
      </div>
    );
  }

  if (notFound || !template) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-cream gap-4">
        <span className="text-6xl">📄</span>
        <h1 className="text-xl font-semibold text-ink">Template not found</h1>
        <p className="text-sm text-ink-lighter">This template may have been removed or the link is incorrect.</p>
        <a
          href="/"
          className="text-sm px-4 py-2 rounded-lg bg-ink text-cream font-medium hover:bg-ink-light transition-colors press-scale"
        >
          Create a new document
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-cream">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 bg-cream border-b border-border">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="text-lg font-semibold text-ink tracking-tight select-none shrink-0">Draft</span>
          <span className="text-ink-lighter select-none shrink-0">/</span>
          <span className="text-sm text-ink font-medium truncate">{template.title}</span>
          <span className="text-xs text-ink-lighter bg-cream-dark px-2 py-0.5 rounded-full border border-border shrink-0">
            Template
          </span>
        </div>
        <button
          onClick={() => onCopy(template.title, template.content as unknown[])}
          className="text-sm px-5 py-2 rounded-lg bg-ink text-cream font-medium hover:bg-ink-light transition-colors press-scale flex items-center gap-2"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="5" y="5" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
            <path d="M9 5V3.5A1.5 1.5 0 0 0 7.5 2H3.5A1.5 1.5 0 0 0 2 3.5v4A1.5 1.5 0 0 0 3.5 9H5" stroke="currentColor" strokeWidth="1.3" />
          </svg>
          Make a Copy
        </button>
      </header>

      {/* Read-only editor preview */}
      <div className="flex-1 overflow-hidden relative">
        <Editor
          comments={[]}
          activeCommentId={null}
          onCommentClick={() => {}}
          onChange={() => {}}
          readOnly
          initialValue={template.content as unknown[]}
          fontName="Georgia"
          onFontChange={() => {}}
        />
      </div>
    </div>
  );
}
