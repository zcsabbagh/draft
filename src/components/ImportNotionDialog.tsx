import { useState, useCallback } from 'react';
import { markdownToSlateNodes } from '../lib/importers';

interface ImportNotionDialogProps {
  open: boolean;
  onClose: () => void;
  onImport: (nodes: unknown[]) => void;
}

export default function ImportNotionDialog({ open, onClose, onImport }: ImportNotionDialogProps) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleImport = useCallback(async () => {
    if (!url.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/import/notion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || `Failed to fetch page (${res.status})`);
        return;
      }

      const nodes = markdownToSlateNodes(data.markdown);
      if (nodes.length === 0) return;

      onImport(nodes);
      setUrl('');
      setError(null);
      onClose();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, [url, onImport, onClose]);

  const handleClose = useCallback(() => {
    setUrl('');
    setError(null);
    onClose();
  }, [onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={handleClose} />

      <div className="relative bg-cream rounded-xl border border-border shadow-xl w-full max-w-lg mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-ink">Import from Notion</h2>
          <button onClick={handleClose} className="text-ink-lighter hover:text-ink transition-colors p-1">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex gap-2 mb-3">
          <input
            type="url"
            value={url}
            onChange={(e) => { setUrl(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleImport(); }}
            placeholder="https://www.notion.so/your-page-..."
            className="flex-1 rounded-lg border border-border bg-white px-4 py-2.5 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-ink-lighter placeholder:text-ink-lighter"
          />
          <button
            onClick={handleImport}
            disabled={!url.trim() || loading}
            className="text-sm px-4 py-2 rounded-lg bg-ink text-cream font-medium hover:bg-ink-light transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {loading ? 'Importing...' : 'Import'}
          </button>
        </div>

        {error && (
          <p className="text-xs text-accent-unsupported mb-2">{error}</p>
        )}

        <p className="text-xs text-ink-lighter">
          Page must be shared with your Notion integration
        </p>
      </div>
    </div>
  );
}
