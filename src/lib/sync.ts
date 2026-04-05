/**
 * Supabase Yjs Provider for @platejs/yjs
 *
 * A custom provider that replaces Hocuspocus/Railway with Supabase Realtime
 * broadcast channels for real-time sync, and Supabase Postgres for persistence.
 *
 * Register with: registerSupabaseProvider() — call once before editor creation.
 * Then use type: 'supabase' in YjsPlugin.configure({ providers: [...] })
 */
import * as Y from 'yjs';
import { registerProviderType } from '@platejs/yjs';
import { supabase } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

/** Encode Uint8Array as base64 */
function toBase64(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary);
}

/** Decode base64 to Uint8Array */
function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Provider wrapper matching @platejs/yjs provider interface.
 * Must implement: connect(), disconnect(), destroy(), isConnected, isSynced
 * Plus accept callbacks: onConnect, onDisconnect, onError, onSyncChange
 */
class SupabaseProviderWrapper {
  _isConnected = false;
  _isSynced = false;
  type = 'supabase';

  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
  onSyncChange?: (isSynced: boolean) => void;

  private doc: Y.Doc;
  private documentId: string;
  private channel: RealtimeChannel | null = null;
  private clientId: string;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private isSaving = false;
  private destroyed = false;
  private connecting = false;

  constructor({
    doc,
    options,
    onConnect,
    onDisconnect,
    onError,
    onSyncChange,
  }: {
    awareness?: unknown;
    doc?: Y.Doc;
    options: { documentId: string };
    onConnect?: () => void;
    onDisconnect?: () => void;
    onError?: (error: Error) => void;
    onSyncChange?: (isSynced: boolean) => void;
  }) {
    this.doc = doc || new Y.Doc();
    this.documentId = options.documentId;
    this.onConnect = onConnect;
    this.onDisconnect = onDisconnect;
    this.onError = onError;
    this.onSyncChange = onSyncChange;
    this.clientId = Math.random().toString(36).slice(2, 10);

    // Listen for Y.Doc changes → broadcast + persist
    this.doc.on('update', this.handleDocUpdate);

    // Do NOT auto-connect here. @platejs/yjs calls connect() itself
    // when autoConnect: true is passed to yjs.init().
  }

  /** Required getter — @platejs/yjs checks provider.isConnected */
  get isConnected(): boolean {
    return this._isConnected;
  }

  /** Required getter — @platejs/yjs checks provider.isSynced */
  get isSynced(): boolean {
    return this._isSynced;
  }

  /** Public connect — called by @platejs/yjs init flow */
  connect = async (): Promise<void> => {
    // Guard against double-connect
    if (this.connecting || this._isConnected) {
      console.log('[Sync] Already connecting/connected, skipping');
      return;
    }
    this.connecting = true;

    if (!supabase) {
      console.warn('[Sync] Supabase not configured — running offline');
      this.markConnected();
      this.markSynced();
      this.connecting = false;
      return;
    }

    try {
      // 1. Load persisted state from Postgres
      await this.loadState();

      // 2. Join Supabase Realtime broadcast channel
      this.channel = supabase.channel(`doc-${this.documentId}`, {
        config: { broadcast: { self: false } },
      });

      this.channel.on('broadcast', { event: 'yjs-update' }, (payload) => {
        if (this.destroyed) return;
        if (payload.payload?.clientId === this.clientId) return;

        try {
          const update = fromBase64(payload.payload.update);
          Y.applyUpdate(this.doc, update, 'remote');
        } catch (err) {
          console.warn('[Sync] Failed to apply remote update:', err);
        }
      });

      this.channel.subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log(`[Sync] ✓ Connected to doc-${this.documentId} (client: ${this.clientId})`);
          this.markConnected();
          this.markSynced();
        } else if (status === 'CHANNEL_ERROR') {
          console.warn(`[Sync] Channel error for doc-${this.documentId}:`, err);
          // Still mark as connected/synced so the editor is usable
          this.markConnected();
          this.markSynced();
        }
      });

      // 3. Persist on page unload
      if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', this.handleBeforeUnload);
      }
    } catch (err) {
      this.onError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.connecting = false;
    }
  };

  private markConnected(): void {
    if (!this._isConnected) {
      this._isConnected = true;
      this.onConnect?.();
    }
  }

  private markSynced(): void {
    if (!this._isSynced) {
      this._isSynced = true;
      this.onSyncChange?.(true);
    }
  }

  /** Load Yjs state from Supabase Postgres */
  private async loadState(): Promise<void> {
    if (!supabase) return;

    const { data } = await supabase
      .from('documents')
      .select('yjs_state')
      .eq('id', this.documentId)
      .single();

    if (data?.yjs_state) {
      try {
        const bytes = fromBase64(data.yjs_state as string);
        Y.applyUpdate(this.doc, bytes, 'load');
      } catch (err) {
        console.warn('[Sync] Failed to load Yjs state:', err);
      }
    }
  }

  /** Handle Y.Doc updates — broadcast to other clients + schedule persist */
  private handleDocUpdate = (update: Uint8Array, origin: unknown): void => {
    // Skip remote updates (from other clients) and load updates (from DB)
    if (this.destroyed || origin === 'remote' || origin === 'load') return;

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

    // Debounced persist (5s after last change)
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveState(), 5000);
  };

  /** Persist Y.Doc state to Supabase */
  private async saveState(): Promise<void> {
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

  private handleBeforeUnload = (): void => {
    this.saveState();
  };

  /** Required by @platejs/yjs provider interface */
  disconnect = (): void => {
    if (this._isConnected) {
      this._isConnected = false;
      if (this._isSynced) {
        this._isSynced = false;
        this.onSyncChange?.(false);
      }
      this.onDisconnect?.();
    }
  };

  /** Required by @platejs/yjs provider interface */
  destroy = (): void => {
    this.destroyed = true;
    clearTimeout(this.saveTimer);
    this.doc.off('update', this.handleDocUpdate);

    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.handleBeforeUnload);
    }

    this.saveState();

    if (this.channel && supabase) {
      supabase.removeChannel(this.channel);
      this.channel = null;
    }

    this.disconnect();
  };
}

/** Register the 'supabase' provider type with @platejs/yjs. Call once at app startup. */
export function registerSupabaseProvider(): void {
  registerProviderType('supabase', SupabaseProviderWrapper as any);
}

/** Save a document title to Supabase */
export async function saveTitle(documentId: string, title: string): Promise<void> {
  if (!supabase) return;
  await supabase
    .from('documents')
    .upsert(
      { id: documentId, title, updated_at: new Date().toISOString() },
      { onConflict: 'id' },
    );
}
