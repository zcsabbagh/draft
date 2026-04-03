import { supabase } from './supabase';
import { getSessionId } from './session';
import type { FeedbackComment, CommentThread } from './types';

/** Save feedback comments for a document, replacing any existing ones. */
export async function saveComments(
  documentId: string,
  comments: FeedbackComment[],
): Promise<void> {
  if (!supabase || comments.length === 0) return;

  const sessionId = getSessionId();

  // Delete old comments for this document+session
  await supabase
    .from('document_comments')
    .delete()
    .eq('document_id', documentId)
    .eq('session_id', sessionId);

  // Insert new comments
  const rows = comments.map((c) => ({
    id: c.id,
    document_id: documentId,
    session_id: sessionId,
    quote: c.quote,
    comment: c.comment,
    type: c.type,
    thread: [],
  }));

  const { error } = await supabase.from('document_comments').insert(rows);
  if (error) console.warn('[Draft] Failed to save comments:', error.message);
}

/** Load comments for a document. Returns comments and threads. */
export async function loadComments(
  documentId: string,
): Promise<{ comments: FeedbackComment[]; threads: Record<string, CommentThread> } | null> {
  if (!supabase) return null;

  const sessionId = getSessionId();
  const { data, error } = await supabase
    .from('document_comments')
    .select('id, quote, comment, type, thread')
    .eq('document_id', documentId)
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error || !data || data.length === 0) return null;

  const comments: FeedbackComment[] = data.map((row) => ({
    id: row.id,
    quote: row.quote,
    comment: row.comment,
    type: row.type as FeedbackComment['type'],
  }));

  const threads: Record<string, CommentThread> = {};
  for (const row of data) {
    if (Array.isArray(row.thread) && row.thread.length > 0) {
      threads[row.id] = { commentId: row.id, messages: row.thread };
    }
  }

  return { comments, threads };
}

/** Update the thread (conversation) for a specific comment. */
export async function saveThread(
  documentId: string,
  commentId: string,
  thread: CommentThread,
): Promise<void> {
  if (!supabase) return;

  const sessionId = getSessionId();
  const { error } = await supabase
    .from('document_comments')
    .update({ thread: thread.messages })
    .eq('document_id', documentId)
    .eq('id', commentId)
    .eq('session_id', sessionId);

  if (error) console.warn('[Draft] Failed to save thread:', error.message);
}
