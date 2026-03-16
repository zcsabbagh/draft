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

A live-editing MCP server that connects to the running editor via WebSocket.

**Architecture**: `MCP Client → stdio → mcp/server.js → WebSocket → Vite (/ws/editor) → Browser (Plate editor)`

**WebSocket bridge** in `vite.config.ts` routes messages between the editor (browser) and MCP clients. Clients register as `editor` or `mcp` role.

**Editor hook** (`src/hooks/useEditorBridge.ts`) connects the live Plate instance to the WebSocket, executes incoming transforms, and returns results.

**Tools**: `read_document`, `read_selection`, `edit_text`, `insert_text`, `insert_block`, `apply_formatting`, `find_and_replace`, `insert_citation`, `get_word_count`, `insert_image`

**Setup**: `cd mcp && npm install && node server.js` (or add as MCP server in Claude Code config)

**Key insight**: Slate's document model is JSON-native and transforms work headlessly — but this server uses a live WebSocket bridge for real-time editing rather than headless transforms, so the editor must be running at localhost:3000.

## API Endpoints (Vite middleware)
- `POST /api/claude` — proxies to Anthropic Messages API, supports `stream: true`
- `POST /api/import/gdocs` — fetches public Google Doc HTML export
- `POST /api/import/notion` — fetches Notion page via API
- `WS /ws/editor` — WebSocket bridge for MCP server ↔ editor communication
