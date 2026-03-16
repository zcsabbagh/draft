# ✏️ Drafts MCP

MCP server for **Drafts** — an AI-powered collaborative writing editor. Connect to documents, read, edit, format, and insert content in real-time via the Model Context Protocol.

## Setup

Add to your MCP client config (e.g. Claude Desktop, Claude Code):

```json
{
  "mcpServers": {
    "drafts": {
      "command": "npx",
      "args": ["-y", "drafts-mcp"]
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `connect_document` | Connect to a collaborative document via Hocuspocus |
| `read_document` | Get full document as plain text and JSON |
| `edit_text` | Find and replace text |
| `insert_text` | Insert text at start or end |
| `insert_block` | Insert headings, paragraphs, blockquotes |
| `apply_formatting` | Bold, italic, underline matching text |
| `find_and_replace` | Replace all occurrences |
| `get_word_count` | Word, character, and paragraph counts |
| `insert_image` | Insert an image by URL |
| `connection_status` | Check connection state |

## Usage

1. Start by calling `connect_document` with a document name
2. Use any editing tool to read or modify the document
3. Changes sync in real-time to all connected editors

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DRAFTS_SERVER_URL` | `wss://draft-collab-production.up.railway.app` | Hocuspocus server URL |
| `DRAFTS_DOCUMENT` | `default` | Default document name |

## License

MIT
