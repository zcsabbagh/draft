import { supabase } from './supabase';
import { getSessionId } from './session';

type EventType =
  | 'feedback_request'
  | 'feedback_received'
  | 'suggestion_accepted'
  | 'suggestion_modified'
  | 'suggestion_rejected'
  | 'manual_revision'
  | 'persona_selected'
  | 'edit_proposed'
  | 'edit_rejected'
  | 'translate_request'
  | 'citation_request';

interface EventData {
  persona?: string;
  selected_text?: string;
  ai_feedback?: string;
  text_before?: string;
  text_after?: string;
  metadata?: Record<string, unknown>;
}

function getBrowserMeta() {
  return {
    user_agent: navigator.userAgent,
    page_url: window.location.href,
  };
}

function logEvent(eventType: EventType, data: EventData = {}): void {
  if (!supabase) return;
  const sessionId = getSessionId();
  const browser = getBrowserMeta();
  supabase.from('interaction_events').insert({
    session_id: sessionId,
    event_type: eventType,
    persona: data.persona ?? null,
    selected_text: data.selected_text ?? null,
    ai_feedback: data.ai_feedback ?? null,
    text_before: data.text_before ?? null,
    text_after: data.text_after ?? null,
    metadata: data.metadata ?? {},
    user_agent: browser.user_agent,
    page_url: browser.page_url,
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

export function logEditProposed(selectedText: string, instruction: string): void {
  logEvent('edit_proposed', { selected_text: selectedText, metadata: { instruction } });
}

export function logEditRejected(selectedText: string): void {
  logEvent('edit_rejected', { selected_text: selectedText });
}

export function logTranslateRequest(selectedText: string, targetLanguage: string): void {
  logEvent('translate_request', { selected_text: selectedText, metadata: { target_language: targetLanguage } });
}

export function logCitationRequest(selectedText: string): void {
  logEvent('citation_request', { selected_text: selectedText });
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

// ── API cost tracking ──

/** Calculate cost in USD for Claude Sonnet 4 */
function calculateCost(inputTokens: number, outputTokens: number): number {
  // Claude Sonnet 4: $3/M input, $15/M output
  return (inputTokens * 3 + outputTokens * 15) / 1_000_000;
}

export function logApiUsage(
  documentId: string,
  inputTokens: number,
  outputTokens: number,
  model: string,
  requestType: string,
): void {
  if (!supabase) return;
  const sessionId = getSessionId();
  const cost = calculateCost(inputTokens, outputTokens);
  supabase.from('api_usage').insert({
    session_id: sessionId,
    document_id: documentId,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    model,
    cost_usd: cost,
    request_type: requestType,
  }).then(({ error }) => {
    if (error) console.warn('[Draft] Usage log failed:', error.message);
  });
}

/** Check total spend and per-document request count */
export async function checkBudget(documentId: string): Promise<{
  allowed: boolean;
  totalCost: number;
  docRequests: number;
}> {
  if (!supabase) return { allowed: true, totalCost: 0, docRequests: 0 };

  const [costResult, countResult] = await Promise.all([
    supabase.from('api_usage').select('cost_usd'),
    supabase.from('api_usage').select('id', { count: 'exact', head: true }).eq('document_id', documentId),
  ]);

  const totalCost = (costResult.data ?? []).reduce((sum, r) => sum + Number(r.cost_usd), 0);
  const docRequests = countResult.count ?? 0;

  // Block if over $1000 total or 50 requests per document
  const allowed = totalCost < 1000 && docRequests < 50;
  return { allowed, totalCost, docRequests };
}
