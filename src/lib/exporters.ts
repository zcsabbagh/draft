/**
 * Export Slate document to various formats.
 */

interface SlateNode {
  type?: string;
  text?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  code?: boolean;
  url?: string;
  children?: SlateNode[];
}

/** Convert Slate nodes to Markdown */
export function slateToMarkdown(nodes: SlateNode[]): string {
  return nodes.map(nodeToMarkdown).join('\n\n');
}

function nodeToMarkdown(node: SlateNode): string {
  if (!node.type && node.text !== undefined) {
    return inlineToMarkdown(node);
  }

  const children = (node.children || []).map(inlineToMarkdown).join('');

  switch (node.type) {
    case 'h1': return `# ${children}`;
    case 'h2': return `## ${children}`;
    case 'h3': return `### ${children}`;
    case 'blockquote': return `> ${children}`;
    case 'hr': return '---';
    case 'a': return `[${children}](${node.url || ''})`;
    default: return children;
  }
}

function inlineToMarkdown(node: SlateNode): string {
  if (node.type === 'a') {
    const text = (node.children || []).map(inlineToMarkdown).join('');
    return `[${text}](${node.url || ''})`;
  }

  if (node.children) {
    return (node.children || []).map(inlineToMarkdown).join('');
  }

  let text = node.text || '';
  if (!text) return '';

  if (node.code) text = `\`${text}\``;
  if (node.bold && node.italic) text = `***${text}***`;
  else if (node.bold) text = `**${text}**`;
  else if (node.italic) text = `*${text}*`;
  if (node.strikethrough) text = `~~${text}~~`;
  if (node.underline) text = `<u>${text}</u>`;

  return text;
}

/** Convert Slate nodes to HTML */
export function slateToHtml(nodes: SlateNode[]): string {
  const body = nodes.map(nodeToHtml).join('\n');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Draft Export</title>
<style>body{font-family:Georgia,serif;max-width:720px;margin:40px auto;line-height:1.6;color:#2C2C2C}
h1,h2,h3{margin-top:1.5em}blockquote{border-left:3px solid #ccc;padding-left:1em;color:#666}
code{background:#f5f5f5;padding:2px 4px;border-radius:3px;font-size:0.9em}</style>
</head><body>\n${body}\n</body></html>`;
}

function nodeToHtml(node: SlateNode): string {
  if (!node.type && node.text !== undefined) {
    return inlineToHtml(node);
  }

  const children = (node.children || []).map(inlineToHtml).join('');

  switch (node.type) {
    case 'h1': return `<h1>${children}</h1>`;
    case 'h2': return `<h2>${children}</h2>`;
    case 'h3': return `<h3>${children}</h3>`;
    case 'blockquote': return `<blockquote>${children}</blockquote>`;
    case 'hr': return '<hr>';
    case 'a': return `<a href="${escHtml(node.url || '')}">${children}</a>`;
    default: return `<p>${children}</p>`;
  }
}

function inlineToHtml(node: SlateNode): string {
  if (node.type === 'a') {
    const text = (node.children || []).map(inlineToHtml).join('');
    return `<a href="${escHtml(node.url || '')}">${text}</a>`;
  }

  if (node.children) {
    return (node.children || []).map(inlineToHtml).join('');
  }

  let text = escHtml(node.text || '');
  if (!text) return '';

  if (node.code) text = `<code>${text}</code>`;
  if (node.bold) text = `<strong>${text}</strong>`;
  if (node.italic) text = `<em>${text}</em>`;
  if (node.underline) text = `<u>${text}</u>`;
  if (node.strikethrough) text = `<s>${text}</s>`;

  return text;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Convert Slate nodes to plain text */
export function slateToPlainText(nodes: SlateNode[]): string {
  return nodes.map(nodeToPlainText).join('\n');
}

function nodeToPlainText(node: SlateNode): string {
  if (node.text !== undefined) return node.text;
  if (node.type === 'hr') return '---';
  return (node.children || []).map(nodeToPlainText).join('');
}

/** Download a string as a file */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
