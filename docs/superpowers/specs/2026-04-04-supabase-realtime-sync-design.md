# Supabase Realtime Sync — Design Spec

## Problem
Document sync relies on Hocuspocus (Railway) + SQLite — a separate server with version mismatch issues. Content shared via URL only works if the collab server is up. MCP server also depends on it.

## Solution
Replace Hocuspocus/Railway with Supabase Realtime broadcast channels + Postgres persistence. One provider for everything.

## Architecture

```
Browser A ──┐                         ┌── Browser B
            │  Supabase Realtime      │
            ├─ broadcast channel ─────┤
            │  "doc:{documentId}"     │
MCP Server ─┘                         └── (any client)
                      │
                      ▼
               Supabase Postgres
               ┌──────────────────┐
               │ documents table   │
               │ id TEXT PK        │
               │ title TEXT        │
               │ yjs_state BYTEA   │
               │ updated_at TSTZ   │
               └──────────────────┘
```

## Sync Protocol

Each client (browser or MCP server):
1. Creates a local `Y.Doc`
2. Loads persisted Yjs binary state from `documents.yjs_state`
3. Applies state to Y.Doc via `Y.applyUpdate(doc, state)`
4. Joins Supabase Realtime broadcast channel `doc:{documentId}`
5. On local Y.Doc change → base64-encode the incremental Yjs update → broadcast
6. On broadcast received → base64-decode → `Y.applyUpdate(doc, update)`
7. On periodic interval (5s debounce) and on page unload → persist `Y.encodeStateAsUpdate(doc)` to Postgres

## Data Model Changes

### Modified: `documents` table
- Drop `content JSONB` column (Slate JSON — replaced by Yjs state)
- Add `yjs_state BYTEA` column (binary Yjs document state)
- Keep `title`, `updated_at`, `created_at`

### New module: `src/lib/sync.ts`
Supabase Yjs sync provider that:
- Manages Y.Doc lifecycle
- Connects to Supabase Realtime broadcast channel
- Handles load/save of Yjs binary state from/to Postgres
- Exposes `onUpdate` callback for Slate binding
- Works in both browser and Node.js (MCP server)

## Editor Integration

### Browser (Plate.js)
- Remove `@platejs/yjs` dependency (it wraps Hocuspocus)
- Use `@slate-yjs/core` directly for Slate ↔ Yjs binding
- `withYjs(editor, sharedType)` binds a Slate editor to a Y.XmlText
- `YjsEditor.connect(editor)` / `YjsEditor.disconnect(editor)` manage lifecycle
- The sync provider feeds updates to/from Supabase Realtime

### MCP Server
- Replace HocuspocusProvider with the same Supabase sync module
- `connect_document` tool creates Y.Doc + joins broadcast channel
- All edit tools operate on local Y.Doc (changes auto-broadcast)
- `read_document` reads from local Y.Doc (always up to date)

## What Gets Removed
- `collab/` directory (Hocuspocus server)
- Railway collab deployment
- `@platejs/yjs` package
- `@hocuspocus/provider` package
- `useEditorBridge` hook (WebSocket bridge for local MCP)
- YjsPlugin configuration in Editor.tsx

## What Gets Added
- `src/lib/sync.ts` — Supabase Yjs sync provider (shared between browser + MCP)
- `yjs_state BYTEA` column on documents table
- `@slate-yjs/core` package (direct Slate-Yjs binding)

## Migration
- Existing documents have `content JSONB` but no `yjs_state`
- On first load, if `yjs_state` is null but `content` exists, seed Y.Doc from Slate JSON
- After migration period, drop `content` column
