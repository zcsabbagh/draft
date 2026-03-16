import { Server } from '@hocuspocus/server';
import { Database } from '@hocuspocus/extension-database';
import SQLite from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new SQLite(join(__dirname, 'data', 'documents.db'));

// Create table if it doesn't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    name TEXT PRIMARY KEY,
    data BLOB,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

const getStmt = db.prepare('SELECT data FROM documents WHERE name = ?');
const upsertStmt = db.prepare(`
  INSERT INTO documents (name, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(name) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP
`);

const server = Server.configure({
  port: parseInt(process.env.PORT || '8888'),

  extensions: [
    new Database({
      fetch: async ({ documentName }) => {
        const row = getStmt.get(documentName);
        return row ? row.data : null;
      },
      store: async ({ documentName, state }) => {
        upsertStmt.run(documentName, state);
      },
    }),
  ],

  async onAuthenticate({ token, documentName }) {
    // Parse token as JSON: { name, color, role }
    // For dev, accept anything — in production, verify JWTs here
    try {
      const user = JSON.parse(token);
      return {
        user: {
          name: user.name || 'Anonymous',
          color: user.color || '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'),
          role: user.role || 'editor',
        },
      };
    } catch {
      // No token or invalid — allow with defaults (dev mode)
      return {
        user: {
          name: 'Anonymous',
          color: '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'),
          role: 'editor',
        },
      };
    }
  },

  async onConnect({ documentName, context }) {
    console.log(`[collab] ${context.user?.name || 'unknown'} connected to "${documentName}"`);
  },

  async onDisconnect({ documentName, context }) {
    console.log(`[collab] ${context.user?.name || 'unknown'} disconnected from "${documentName}"`);
  },
});

server.listen().then(() => {
  console.log(`[collab] Hocuspocus running on ws://localhost:${server.configuration.port}`);
});
