# Draft — AI Writing Editor

## Quick Start
```
npm install
npm run dev    # starts on localhost:3000
```
Requires `ANTHROPIC_API_KEY` env var for AI features. Optional `NOTION_API_KEY` for Notion import.

## Stack
- **Frontend:** React 19 + Vite + Tailwind CSS v4
- **Editor:** Plate.js (platejs v52) — Slate-based rich text editor
- **API proxy:** Vite dev server middleware (`vite.config.ts`) proxies `/api/claude` to Anthropic API

## Adding Custom Plate Plugins

Custom block/inline elements follow this pattern:

### 1. Create the plugin
```tsx
import { createPlatePlugin } from 'platejs/react';

const MyPlugin = createPlatePlugin({
  key: 'my_element',
  node: {
    isElement: true,
    isInline: false,    // true for inline elements like citation links
    isVoid: false,      // true for non-editable blocks like images
  },
});
```

### 2. Register it in the editor
Add to the `plugins` array in `usePlateEditor()` inside `Editor.tsx`:
```tsx
const editor = usePlateEditor({
  plugins: [
    // ...existing plugins
    MyPlugin,
  ],
  override: {
    components: {
      [MyPlugin.key]: (props: any) => (
        <PlateElement {...props} as="div" className="my-styles">
          {props.children}
        </PlateElement>
      ),
    },
  },
});
```

### 3. Insert nodes
```tsx
editor.insertNode({
  type: 'my_element',
  customProp: 'value',
  children: [{ text: '' }],  // required — every element needs children
});
```

### Key rules
- **Inline elements** (`isInline: true`): rendered within text flow (e.g., citation links)
- **Void elements** (`isVoid: true`): non-editable content, must still have `children: [{ text: '' }]`
- **Component overrides** use the plugin key, not a string — `[MyPlugin.key]` not `'my_element'`
- **Leaf components** (marks/formatting) use `PlateLeaf`, **element components** use `PlateElement`

### Existing custom plugins
- `CitationLinkPlugin` — inline superscript citation links `[1]` that scroll to Works Cited
- `ImagePlugin` (from `@platejs/media`) — images with resize handles, alignment, captions
- `TablePlugin` (from `@platejs/table`) — tables with header rows

## Project Structure
```
src/
  App.tsx              — main app, state management, layout
  editor-shared.css    — shared editor styles (page layout, typography, tables, images)
  components/
    Editor.tsx         — Plate editor, toolbar, plugins, inline edit
    ChatPanel.tsx      — right sidebar with Feedback/Chat/Rubric/Context tabs
    InlineEditPanel.tsx — Cmd+K floating edit popover
    SelectionToolbar.tsx — Notion-style floating bar on text selection
    StatusBar.tsx      — word count + page indicator
    TimelineScrubber.tsx — edit history with bookmark snapping
    FontSelector.tsx   — font picker dropdown
    FontSizeSelector.tsx — font size with type-to-filter
    MarkdownContent.tsx — renders markdown in chat messages
    ImportDialog.tsx   — Google Docs import
    ImportNotionDialog.tsx — Notion import
  lib/
    api.ts            — Claude API calls (feedback, chat, streaming, edit proposals, citations)
    types.ts          — shared TypeScript types
    fonts.ts          — Google Fonts loader
    importers.ts      — HTML/markdown to Slate node converters
  index.css           — Tailwind + custom styles (page layout, images, tables, scrollbar)
vite.config.ts        — Vite config with API proxy middleware
mcp/
  server.js           — MCP server (stdio + HTTP), Hocuspocus/Yjs connection
  package.json        — MCP server dependencies and build scripts
  app/
    mcp-app.tsx       — MCP App React component (live Plate.js editor preview)
    mcp-app.html      — HTML entry point
    main.tsx          — React root
    global.css        — MCP App styles (imports editor-shared.css)
    vite.config.ts    — single-file HTML build config
  dist/               — build output (gitignored)
```

## CSS Theme
Defined in `index.css` via `@theme`:
- `--color-cream: #FAFAF8` — main background
- `--color-cream-dark: #F0F0EC` — secondary background
- `--color-ink: #2C2C2C` — primary text
- `--color-ink-light: #6B6B6B` — secondary text
- `--color-ink-lighter: #9B9B9B` — muted text
- `--color-border: #E5E5E0` — borders
- Page background: `#FAF9F5`
- Sidebar background: `#F0EEE6`

## MCP Server (`mcp/`)

A collaborative MCP server that connects to documents via Hocuspocus (Yjs) for real-time editing.

**Architecture**: `MCP Client → stdio/HTTP → mcp/server.js → Hocuspocus (Yjs) → Collaborative document`

**Tools**: `connect_document`, `read_document`, `edit_text`, `insert_text`, `insert_block`, `apply_formatting`, `find_and_replace`, `get_word_count`, `insert_image`, `connection_status`, `poll_document`, `apply_user_edit`, `create_document`

**Setup**:
- **Claude Desktop (stdio):** `node mcp/server.js`
- **Claude.ai (connector):** Railway URL `https://drafts-mcp-production.up.railway.app/mcp`
- **Build:** `cd mcp && npm install && npm run build`

**Environment variables**: `DRAFTS_SERVER_URL` (default: `wss://draft-collab-production.up.railway.app`), `DRAFTS_DOCUMENT` (default: `default`)

## MCP App (`mcp/app/`)

An embedded MCP App (using `@modelcontextprotocol/ext-apps`) that renders a live Plate.js editor preview inside Claude.ai's chat interface.

**How it works**: The app is built as a single-file HTML bundle (`mcp/dist/mcp-app.html`) via `vite-plugin-singlefile`. It uses the MCP ext-apps SDK to call `poll_document` on the server every 2 seconds to fetch Slate JSON nodes, then renders them in a real Plate.js editor instance. User edits are synced back via `apply_user_edit`.

**Features**:
- Live document preview with real Plate.js rendering (headings, bold, italic, lists, links, images, etc.)
- Bidirectional editing — users can type in the MCP App and changes sync back
- Fullscreen mode via `app.requestDisplayMode()`
- "Open in Draft" button linking to the main web app
- "Send to Chat" to paste document content into the conversation
- Word count display and live connection indicator

**Shared CSS**: `src/editor-shared.css` is the single source of truth for editor typography, page layout, tables, and image styles. It is imported by both the main app (`src/index.css`) and the MCP App (`mcp/app/global.css`). A build script copies it into `mcp/app/` before bundling. Plain CSS only — no Tailwind directives.

**Build**: `cd mcp && npm run build` (copies shared CSS, then bundles the app)

**Key files**:
- `mcp/app/mcp-app.tsx` — main React component (LiveEditor + DocumentPreview)
- `mcp/app/global.css` — MCP App styles, imports `editor-shared.css`
- `mcp/app/vite.config.ts` — Vite config with `vite-plugin-singlefile`
- `mcp/dist/mcp-app.html` — build output (single-file HTML, served as MCP resource)

## API Endpoints (Vite middleware)
- `POST /api/claude` — proxies to Anthropic Messages API, supports `stream: true`
- `POST /api/import/gdocs` — fetches public Google Doc HTML export
- `POST /api/import/notion` — fetches Notion page via API
- `WS /ws/editor` — WebSocket bridge for MCP server ↔ editor communication

## Development & Testing Tools

This project uses several MCP servers and skills for development and testing:

**MCP Servers** (configured in `.mcp.json` and `claude_desktop_config.json`):
- `drafts` — this project's own MCP server (`node mcp/server.js`)
- `railway` — Railway deployment management (`@railway/mcp-server`)
- `shadcn` — UI component library

**Skills used during development**:
- `create-mcp-app` — MCP Apps SDK guidance for building the embedded editor preview
- `agent-browser` — browser automation for testing the web app
- `agentation` — visual feedback annotations on web pages

**Deployment**:
- **Vercel** — main web app at `draft-blue.vercel.app`
- **Railway** — MCP HTTP server at `drafts-mcp-production.up.railway.app/mcp`
- **Railway** — Hocuspocus collab server at `draft-collab-production.up.railway.app`

**npm package**: `drafts-mcp` — installable via `npx drafts-mcp` for stdio usage
