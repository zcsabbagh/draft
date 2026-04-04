import { supabase } from './supabase';

export interface Document {
  id: string;
  title: string;
  content: unknown[];
  updated_at: string;
}

/** Load a document by ID from Supabase. Returns null if not found. */
export async function loadDocument(id: string): Promise<Document | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('documents')
    .select('id, title, content, updated_at')
    .eq('id', id)
    .single();

  if (error || !data) return null;
  return data as Document;
}

/** Save (upsert) a document to Supabase. */
export async function saveDocument(
  id: string,
  title: string,
  content: unknown[],
): Promise<void> {
  if (!supabase) return;

  const { error } = await supabase
    .from('documents')
    .upsert(
      { id, title, content, updated_at: new Date().toISOString() },
      { onConflict: 'id' },
    );

  if (error) console.warn('[Draft] Failed to save document:', error.message);
}
