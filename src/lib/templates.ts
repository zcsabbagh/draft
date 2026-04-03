import { supabase } from './supabase';
import { getSessionId } from './session';

export interface Template {
  id: string;
  title: string;
  content: unknown[];
  created_at: string;
}

function generateTemplateId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 10; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

/** Save the current document as a template. Returns the template ID. */
export async function saveTemplate(
  title: string,
  content: unknown[],
): Promise<{ id: string; error?: string }> {
  if (!supabase) return { id: '', error: 'Supabase not configured' };

  const id = generateTemplateId();
  const sessionId = getSessionId();

  const { error } = await supabase.from('templates').insert({
    id,
    title,
    content,
    session_id: sessionId,
  });

  if (error) return { id: '', error: error.message };
  return { id };
}

/** Fetch a template by ID. Returns null if not found. */
export async function getTemplate(id: string): Promise<Template | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('templates')
    .select('id, title, content, created_at')
    .eq('id', id)
    .single();

  if (error || !data) return null;
  return data as Template;
}
