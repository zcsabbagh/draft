/**
 * Supabase Yjs Sync Provider
 *
 * Replaces Hocuspocus/Railway with Supabase Realtime broadcast channels
 * for real-time document sync, and Supabase Postgres for persistence.
 *
 * Each client (browser or MCP server):
 * 1. Creates a local Y.Doc
 * 2. Loads persisted Yjs binary state from documents.yjs_state
 * 3. Joins a Supabase Realtime broadcast channel "doc:{documentId}"
 * 4. On local change → broadcast the incremental update
 * 5. On broadcast received → apply the update to local Y.Doc
 * 6. Periodically and on disconnect → persist state to Postgres
 */
import * as Y from 'yjs';
import { supabase } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

/** Encode a Uint8Array as base64 string for JSON-safe broadcast */
function toBase64(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary);
}

/** Decode a base64 string back to Uint8Array */
function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export interface SyncProviderOptions {
  documentId: string;
  /** Called once the Y.Doc is loaded and ready */
  onSynced?: () => void;
  /** Called on every remote update (for editor re-render) */
  onUpdate?: () => void;
}

export class SupabaseSyncProvider {
  readonly doc: Y.Doc;
  readonly documentId: string;

  private channel: RealtimeChannel | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private isSaving = false;
  private destroyed = false;
  private onSynced?: () => void;
  private onUpdate?: () => void;

  /** Unique client ID to avoid applying own broadcasts */
  private clientId: string;

  constructor(options: SyncProviderOptions) {
    this.documentId = options.documentId;
    this.onSynced = options.onSynced;
    this.onUpdate = options.onUpdate;
    this.doc = new Y.Doc();
    this.clientId = Math.random().toString(36).slice(2, 10);

    // Listen for local Y.Doc changes and broadcast them
    this.doc.on('update', this.handleDocUpdate);
  }

  /** Connect: load from Postgres, then join broadcast channel */
  async connect(): Promise<void> {
    if (!supabase) {
      console.warn('[Sync] Supabase not configured — running offline');
      this.onSynced?.();
      return;
    }

    // 1. Load persisted state from Postgres
    await this.loadState();

    // 2. Join Supabase Realtime broadcast channel
    this.channel = supabase.channel(`doc:${this.documentId}`, {
      config: { broadcast: { self: false } },
    });

    this.channel.on('broadcast', { event: 'yjs-update' }, (payload) => {
      if (this.destroyed) return;
      if (payload.payload?.clientId === this.clientId) return;

      try {
        const update = fromBase64(payload.payload.update);
        Y.applyUpdate(this.doc, update, 'remote');
        this.onUpdate?.();
      } catch (err) {
        console.warn('[Sync] Failed to apply remote update:', err);
      }
    });

    this.channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log(`[Sync] Joined channel doc:${this.documentId}`);
        this.onSynced?.();
      }
    });

    // 3. Persist on page unload
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.handleBeforeUnload);
    }
  }

  /** Load Yjs state from Supabase Postgres */
  private async loadState(): Promise<void> {
    if (!supabase) return;

    const { data, error } = await supabase
      .from('documents')
      .select('yjs_state, content, title')
      .eq('id', this.documentId)
      .single();

    if (error || !data) return;

    if (data.yjs_state) {
      // Binary Yjs state exists — apply it
      try {
        const bytes = fromBase64(data.yjs_state as string);
        Y.applyUpdate(this.doc, bytes, 'load');
      } catch (err) {
        console.warn('[Sync] Failed to load Yjs state:', err);
      }
    } else if (data.content && Array.isArray(data.content)) {
      // Legacy: Slate JSON content exists but no Yjs state.
      // Seed the Y.Doc from Slate JSON (migration path).
      this.seedFromSlateJson(data.content);
    }
  }

  /** Seed Y.Doc from legacy Slate JSON content (migration) */
  private seedFromSlateJson(slateNodes: unknown[]): void {
    const sharedRoot = this.doc.get('content', Y.XmlText);
    const delta = slateNodesToDelta(slateNodes);
    if (delta.length > 0) {
      sharedRoot.applyDelta(delta);
    }
  }

  /** Handle local Y.Doc updates — broadcast to other clients */
  private handleDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (this.destroyed || origin === 'remote' || origin === 'load') return;

    // Broadcast the incremental update
    if (this.channel) {
      this.channel.send({
        type: 'broadcast',
        event: 'yjs-update',
        payload: {
          update: toBase64(update),
          clientId: this.clientId,
        },
      });
    }

    // Schedule debounced persist to Postgres (5s after last change)
    this.scheduleSave();
  };

  /** Debounced save to Supabase Postgres */
  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveState(), 5000);
  }

  /** Persist current Y.Doc state to Supabase */
  async saveState(): Promise<void> {
    if (!supabase || this.isSaving || this.destroyed) return;
    this.isSaving = true;

    try {
      const state = Y.encodeStateAsUpdate(this.doc);
      const b64 = toBase64(state);

      const { error } = await supabase
        .from('documents')
        .upsert(
          {
            id: this.documentId,
            yjs_state: b64,
            title: 'Untitled Document',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'id', ignoreDuplicates: false },
        );

      if (error) console.warn('[Sync] Save error:', error.message);
    } catch (err) {
      console.warn('[Sync] Failed to save state:', err);
    } finally {
      this.isSaving = false;
    }
  }

  /** Save title to Supabase */
  async saveTitle(title: string): Promise<void> {
    if (!supabase) return;

    await supabase
      .from('documents')
      .upsert(
        { id: this.documentId, title, updated_at: new Date().toISOString() },
        { onConflict: 'id' },
      );
  }

  /** Save on page unload */
  private handleBeforeUnload = (): void => {
    if (!supabase || this.destroyed) return;

    const state = Y.encodeStateAsUpdate(this.doc);
    const b64 = toBase64(state);

    // Fire-and-forget — can't await in beforeunload
    supabase
      .from('documents')
      .upsert(
        { id: this.documentId, yjs_state: b64, title: 'Untitled Document', updated_at: new Date().toISOString() },
        { onConflict: 'id', ignoreDuplicates: false },
      )
      .then(() => {});
  };

  /** Clean up everything */
  destroy(): void {
    this.destroyed = true;
    clearTimeout(this.saveTimer);
    this.doc.off('update', this.handleDocUpdate);

    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.handleBeforeUnload);
    }

    // Save final state
    this.saveState();

    // Unsubscribe from channel
    if (this.channel && supabase) {
      supabase.removeChannel(this.channel);
      this.channel = null;
    }

    this.doc.destroy();
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Convert Slate JSON nodes to Y.XmlText delta (for migration) */
function slateNodesToDelta(nodes: unknown[]): Array<{ insert: string; attributes?: Record<string, unknown> }> {
  const delta: Array<{ insert: string; attributes?: Record<string, unknown> }> = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i] as Record<string, unknown>;
    if (!node || typeof node !== 'object') continue;

    const children = node.children as Array<Record<string, unknown>> | undefined;
    if (!children) continue;

    for (const child of children) {
      if (typeof child.text === 'string') {
        const attrs: Record<string, unknown> = {};
        if (child.bold) attrs.bold = true;
        if (child.italic) attrs.italic = true;
        if (child.underline) attrs.underline = true;
        if (child.strikethrough) attrs.strikethrough = true;
        if (child.code) attrs.code = true;

        const entry: { insert: string; attributes?: Record<string, unknown> } = { insert: child.text as string };
        if (Object.keys(attrs).length > 0) entry.attributes = attrs;
        delta.push(entry);
      }
    }

    // Add newline between blocks (except after last)
    if (i < nodes.length - 1) {
      delta.push({ insert: '\n' });
    }
  }

  return delta;
}
