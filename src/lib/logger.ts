import { supabase } from './supabase';
import { getSessionId } from './session';

type EventType =
  | 'feedback_request'
  | 'feedback_received'
  | 'suggestion_accepted'
  | 'suggestion_modified'
  | 'suggestion_rejected'
  | 'manual_revision'
  | 'persona_selected';

interface EventData {
  persona?: string;
  selected_text?: string;
  ai_feedback?: string;
  text_before?: string;
  text_after?: string;
  metadata?: Record<string, unknown>;
}

function logEvent(eventType: EventType, data: EventData = {}): void {
  if (!supabase) return;
  const sessionId = getSessionId();
  supabase.from('interaction_events').insert({
    session_id: sessionId,
    event_type: eventType,
    persona: data.persona ?? null,
    selected_text: data.selected_text ?? null,
    ai_feedback: data.ai_feedback ?? null,
    text_before: data.text_before ?? null,
    text_after: data.text_after ?? null,
    metadata: data.metadata ?? {},
  }).then(({ error }) => {
    if (error) console.warn(`[Draft] Log ${eventType} failed:`, error.message);
  });
}

// ── Convenience wrappers ──

export function logFeedbackRequest(selectedText: string, persona?: string): void {
  logEvent('feedback_request', { selected_text: selectedText, persona });
}

export function logFeedbackReceived(selectedText: string, aiFeedback: string, persona?: string): void {
  logEvent('feedback_received', { selected_text: selectedText, ai_feedback: aiFeedback, persona });
}

export function logSuggestionAccepted(originalText: string, newText: string, persona?: string): void {
  logEvent('suggestion_accepted', {
    text_before: originalText,
    text_after: newText,
    persona,
  });
}

export function logSuggestionModified(originalText: string, modifiedText: string, persona?: string): void {
  logEvent('suggestion_modified', {
    text_before: originalText,
    text_after: modifiedText,
    persona,
  });
}

export function logSuggestionRejected(originalText: string, persona?: string): void {
  logEvent('suggestion_rejected', { text_before: originalText, persona });
}

export function logPersonaSelected(persona: string): void {
  logEvent('persona_selected', { persona });
}

// ── Document snapshots ──

export function saveSnapshot(
  content: unknown,
  wordCount: number,
  snapshotType: 'auto' | 'pre_feedback' | 'post_feedback' | 'submit' = 'auto',
): void {
  if (!supabase) return;
  const sessionId = getSessionId();
  supabase.from('document_snapshots').insert({
    session_id: sessionId,
    content,
    word_count: wordCount,
    snapshot_type: snapshotType,
  }).then(({ error }) => {
    if (error) console.warn(`[Draft] Snapshot (${snapshotType}) failed:`, error.message);
  });
}

// ── Submission ──

export async function submitDocument(
  studentName: string,
  studentIdNumber: string,
  documentContent: unknown,
  wordCount: number,
): Promise<{ success: boolean; error?: string }> {
  if (!supabase) return { success: false, error: 'Supabase not configured' };

  // Final snapshot
  saveSnapshot(documentContent, wordCount, 'submit');

  const sessionId = getSessionId();
  const { error } = await supabase.from('submissions').insert({
    session_id: sessionId,
    student_name: studentName,
    student_id_number: studentIdNumber,
    document_content: documentContent,
    word_count: wordCount,
  });

  if (error) return { success: false, error: error.message };
  return { success: true };
}
