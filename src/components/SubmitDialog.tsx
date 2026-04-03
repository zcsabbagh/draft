import { useState } from 'react';

interface SubmitDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (studentName: string, studentId: string) => Promise<void>;
}

export default function SubmitDialog({ open, onClose, onSubmit }: SubmitDialogProps) {
  const [name, setName] = useState('');
  const [studentId, setStudentId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !studentId.trim()) {
      setError('Please fill in both fields.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(name.trim(), studentId.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 animate-fade-in">
      <div
        className="bg-cream rounded-2xl shadow-xl border border-border w-full max-w-md mx-4 p-6 animate-dropdown-open"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-ink mb-1">Submit Your Essay</h2>
        <p className="text-sm text-ink-lighter mb-5">
          Enter your name and student ID to submit. This links your writing session to your submission.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-ink-light mb-1">Full Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Jane Smith"
              className="w-full text-sm px-3 py-2 rounded-lg bg-white border border-border focus:outline-none focus:border-ink-lighter text-ink placeholder:text-ink-lighter"
              autoFocus
              disabled={submitting}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-light mb-1">Student ID</label>
            <input
              type="text"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              placeholder="e.g. 12345678"
              className="w-full text-sm px-3 py-2 rounded-lg bg-white border border-border focus:outline-none focus:border-ink-lighter text-ink placeholder:text-ink-lighter"
              disabled={submitting}
            />
          </div>

          {error && (
            <p className="text-xs text-red-600">{error}</p>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 text-sm px-4 py-2 rounded-lg border border-border text-ink font-medium hover:bg-cream-dark transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 text-sm px-4 py-2 rounded-lg bg-ink text-cream font-medium hover:bg-ink-light transition-colors press-scale disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Submit Essay'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
