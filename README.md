# Draft — AI Writing Editor

A rich text writing editor with AI feedback, built on React, Plate.js, and Claude. Includes an MCP server with a live document preview app.

## Quick Start

```bash
npm install
npm run dev    # starts on localhost:3000
```

Requires `ANTHROPIC_API_KEY` env var for AI features. Optional `NOTION_API_KEY` for Notion import.

## Stack

- **Frontend:** React 19 + Vite + Tailwind CSS v4
- **Editor:** Plate.js (platejs v52) — Slate-based rich text editor
- **API proxy:** Vite dev server middleware proxies `/api/claude` to Anthropic API
- **Collaboration:** Hocuspocus (Yjs) for real-time document sync
- **MCP Server:** Model Context Protocol server for AI agent editing

## MCP Server

The `mcp/` directory contains an MCP server that lets AI agents read and edit Draft documents in real-time. It includes an embedded MCP App that renders a live Plate.js editor directly inside Claude's chat interface.

### Setup

#### Option 1: npm (recommended)

```bash
npx drafts-mcp
```

#### Option 2: Claude Desktop (stdio)

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "drafts": {
      "command": "npx",
      "args": ["drafts-mcp"]
    }
  }
}
```

Restart Claude Desktop. The `drafts` server will appear in the MCP server list.

#### Option 3: Claude Code (project-level)

Add to `.mcp.json` in your project:

```json
{
  "mcpServers": {
    "drafts": {
      "command": "npx",
      "args": ["drafts-mcp"]
    }
  }
}
```

#### Option 4: Claude.ai (custom connector)

1. Go to [claude.ai](https://claude.ai) → Profile → Settings → Connectors
2. Click **Add custom connector**
3. Paste the URL:
   ```
   https://drafts-mcp-production.up.railway.app/mcp
   ```
4. Name it "Drafts" and save
5. Start a new chat — you can now ask Claude to connect to and edit documents

### MCP App (live document preview)

When Claude calls `connect_document` or `create_document`, a rich document preview appears inline:

- Real-time document rendering with the actual Plate.js editor (headings, bold, italic, lists, links, images)
- Bidirectional editing — type in the preview and changes sync back via Yjs
- Fullscreen mode for distraction-free writing
- "Open in Draft" button to jump to the full web editor
- "Send to Chat" to paste document content into the conversation
- Live word count

### Build from source

```bash
cd mcp
npm install
npm run build    # builds the MCP App single-file HTML bundle
npm start        # stdio mode
npm run start:http  # HTTP mode (for custom connectors)
```

### Tools

| Tool | Description |
|------|-------------|
| `connect_document` | Connect to a collaborative document by URL or ID |
| `create_document` | Create a new document with optional title and content |
| `read_document` | Get full document as plain text and JSON |
| `edit_text` | Find and replace text |
| `insert_text` | Insert text at start or end |
| `insert_block` | Insert headings, paragraphs, blockquotes |
| `apply_formatting` | Bold, italic, underline matching text |
| `find_and_replace` | Replace all occurrences |
| `get_word_count` | Word, character, and paragraph counts |
| `insert_image` | Insert an image by URL |
| `insert_table` | Insert a table with headers |
| `set_block_type` | Change paragraph to heading, etc. |
| `set_alignment` | Set text alignment |
| `delete_block` | Delete a block by search text |
| `move_block` | Move a block to a new position |
| `list_blocks` | List all blocks with previews |
| `get_document_outline` | Get heading structure |
| `clear_document` | Clear all content |
| `connection_status` | Check connection state |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | — | Required for AI features in the web app |
| `DRAFTS_SERVER_URL` | `wss://draft-collab-production.up.railway.app` | Hocuspocus server URL |
| `DRAFTS_DOCUMENT` | `default` | Default document name |
| `DRAFT_APP_URL` | `https://draft-blue.vercel.app` | Base URL for "Open in Draft" links |

## License

MIT
