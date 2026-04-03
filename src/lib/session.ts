import { supabase } from './supabase';

const SESSION_KEY = 'draft_session_id';

function generateUUID(): string {
  return crypto.randomUUID();
}

let _sessionId: string | null = null;

export function getSessionId(): string {
  if (_sessionId) return _sessionId;

  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = generateUUID();
    localStorage.setItem(SESSION_KEY, id);
    // Fire-and-forget: register session in Supabase
    supabase?.from('sessions').insert({ id }).then(({ error }) => {
      if (error) console.warn('[Draft] Failed to register session:', error.message);
    });
  }
  _sessionId = id;
  return id;
}

/** Reset session (for testing) */
export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
  _sessionId = null;
}
