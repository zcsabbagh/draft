/**
 * Converts HTML (e.g. pasted from Google Docs) into Slate-compatible nodes
 * for the Plate editor.
 */

interface SlateText {
  text: string;
  bold?: true;
  italic?: true;
  underline?: true;
  strikethrough?: true;
  code?: true;
}

interface SlateElement {
  type: string;
  url?: string;
  children: (SlateElement | SlateText)[];
}

type SlateNode = SlateElement | SlateText;

/**
 * Parse CSS class → style mappings from <style> blocks.
 * Google Docs export HTML puts all formatting in class-based CSS
 * (e.g., `.c5 { font-weight: 700; font-style: italic; }`).
 */
function parseStyleSheets(doc: Document): Map<string, Record<string, string>> {
  const classStyles = new Map<string, Record<string, string>>();

  for (const styleEl of Array.from(doc.querySelectorAll('style'))) {
    const text = styleEl.textContent || '';
    // Match rules like `.c5 { ... }` or `.c5, .c6 { ... }`
    const ruleRe = /([^{}]+)\{([^{}]+)\}/g;
    let match: RegExpExecArray | null;
    while ((match = ruleRe.exec(text)) !== null) {
      const selectors = match[1].trim();
      const body = match[2].trim();

      // Parse properties
      const props: Record<string, string> = {};
      for (const decl of body.split(';')) {
        const colonIdx = decl.indexOf(':');
        if (colonIdx === -1) continue;
        const prop = decl.slice(0, colonIdx).trim().toLowerCase();
        const val = decl.slice(colonIdx + 1).trim().toLowerCase();
        if (prop && val) props[prop] = val;
      }

      // Map each class selector
      for (const sel of selectors.split(',')) {
        const trimmed = sel.trim();
        if (trimmed.startsWith('.') && !trimmed.includes(' ')) {
          const className = trimmed.slice(1);
          classStyles.set(className, { ...(classStyles.get(className) || {}), ...props });
        }
      }
    }
  }

  return classStyles;
}

/**
 * Apply class-based styles as inline styles on all elements,
 * so our converter can read them via el.style.
 */
function inlineClassStyles(doc: Document, classStyles: Map<string, Record<string, string>>) {
  if (classStyles.size === 0) return;

  for (const el of Array.from(doc.body.querySelectorAll('*'))) {
    const htmlEl = el as HTMLElement;
    const classes = htmlEl.className?.split?.(/\s+/) || [];
    for (const cls of classes) {
      const styles = classStyles.get(cls);
      if (!styles) continue;
      for (const [prop, val] of Object.entries(styles)) {
        // Only set if not already set inline (inline takes precedence)
        const camelProp = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        if (!(htmlEl.style as any)[camelProp]) {
          (htmlEl.style as any)[camelProp] = val;
        }
      }
    }
  }
}

/**
 * Parse an HTML string into Slate nodes.
 */
export function htmlToSlateNodes(html: string): SlateElement[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Resolve Google Docs class-based styles to inline styles
  const classStyles = parseStyleSheets(doc);
  inlineClassStyles(doc, classStyles);

  const nodes = convertChildren(doc.body);
  // Ensure we always return at least one paragraph
  if (nodes.length === 0) {
    return [{ type: 'p', children: [{ text: '' }] }];
  }
  return nodes;
}

function convertChildren(parent: Node): SlateElement[] {
  const result: SlateElement[] = [];
  const inlineBuffer: SlateNode[] = [];

  function flushInlines() {
    if (inlineBuffer.length > 0) {
      result.push({ type: 'p', children: [...inlineBuffer] });
      inlineBuffer.length = 0;
    }
  }

  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent || '';
      if (text.trim() || inlineBuffer.length > 0) {
        inlineBuffer.push({ text });
      }
      continue;
    }

    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as HTMLElement;
    const tag = el.tagName.toLowerCase();

    if (isBlockElement(tag)) {
      flushInlines();
      const blockNodes = convertElement(el);
      result.push(...blockNodes);
    } else {
      // Inline element
      const inlineNodes = convertInlineElement(el);
      inlineBuffer.push(...inlineNodes);
    }
  }

  flushInlines();
  return result;
}

function isBlockElement(tag: string): boolean {
  return [
    'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'blockquote', 'ul', 'ol', 'li', 'hr', 'br',
    'table', 'thead', 'tbody', 'tr', 'td', 'th',
    'section', 'article', 'header', 'footer', 'main',
    'pre', 'figure', 'figcaption',
  ].includes(tag);
}

function convertElement(el: HTMLElement): SlateElement[] {
  const tag = el.tagName.toLowerCase();

  // Google Docs export sometimes uses <p> with large font-size for headings
  // or uses a named style attribute
  if (tag === 'p') {
    const fontSize = parseFloat(el.style.fontSize);
    const namedStyle = el.getAttribute('data-heading') || '';
    if (namedStyle === 'h1' || fontSize >= 24) {
      return [{ type: 'h1', children: getInlineChildren(el) }];
    }
    if (namedStyle === 'h2' || (fontSize >= 18 && fontSize < 24)) {
      return [{ type: 'h2', children: getInlineChildren(el) }];
    }
    if (namedStyle === 'h3' || (fontSize >= 15 && fontSize < 18)) {
      return [{ type: 'h3', children: getInlineChildren(el) }];
    }
  }

  switch (tag) {
    case 'h1':
      return [{ type: 'h1', children: getInlineChildren(el) }];
    case 'h2':
      return [{ type: 'h2', children: getInlineChildren(el) }];
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return [{ type: 'h3', children: getInlineChildren(el) }];
    case 'blockquote':
      return [{ type: 'blockquote', children: getInlineChildren(el) }];
    case 'hr':
      return [{ type: 'hr', children: [{ text: '' }] }];
    case 'br':
      return [{ type: 'p', children: [{ text: '' }] }];
    case 'ul':
    case 'ol': {
      // Convert list items as paragraphs with bullet/number prefix
      // (Plate list plugin uses flat list structure)
      const items: SlateElement[] = [];
      const listItems = el.querySelectorAll(':scope > li');
      for (const li of Array.from(listItems)) {
        const liEl = li as HTMLElement;
        const inlines = getInlineChildren(liEl);
        const prefix = tag === 'ul' ? '• ' : `${items.length + 1}. `;
        // Prepend the prefix to the first text node
        if (inlines.length > 0 && 'text' in inlines[0]) {
          inlines[0] = { ...inlines[0], text: prefix + inlines[0].text };
        } else {
          inlines.unshift({ text: prefix });
        }
        items.push({ type: 'p', children: inlines });
      }
      return items;
    }
    case 'li':
      return [{ type: 'p', children: getInlineChildren(el) }];
    case 'pre': {
      const codeText = el.textContent || '';
      return [{ type: 'p', children: [{ text: codeText, code: true }] }];
    }
    case 'table': {
      // Flatten table to paragraphs
      const rows: SlateElement[] = [];
      for (const tr of Array.from(el.querySelectorAll('tr'))) {
        const cells: string[] = [];
        for (const cell of Array.from(tr.querySelectorAll('td, th'))) {
          cells.push((cell as HTMLElement).textContent || '');
        }
        rows.push({ type: 'p', children: [{ text: cells.join(' | ') }] });
      }
      return rows;
    }
    case 'div':
    case 'section':
    case 'article':
    case 'header':
    case 'footer':
    case 'main':
    case 'figure':
    case 'figcaption':
      // Recurse into container elements
      return convertChildren(el);
    default: {
      const children = getInlineChildren(el);
      return [{ type: 'p', children: children.length > 0 ? children : [{ text: '' }] }];
    }
  }
}

function getInlineChildren(el: HTMLElement): SlateNode[] {
  const result: SlateNode[] = [];

  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent || '';
      if (text) {
        result.push({ text });
      }
      continue;
    }

    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const childEl = child as HTMLElement;
    const tag = childEl.tagName.toLowerCase();

    // If it's a block element nested inside, just grab its text
    if (isBlockElement(tag) && tag !== 'br') {
      const nestedInlines = getInlineChildren(childEl);
      result.push(...nestedInlines);
      continue;
    }

    if (tag === 'br') {
      result.push({ text: '\n' });
      continue;
    }

    const inlineNodes = convertInlineElement(childEl);
    result.push(...inlineNodes);
  }

  if (result.length === 0) {
    result.push({ text: '' });
  }

  return result;
}

function convertInlineElement(el: HTMLElement): SlateNode[] {
  const tag = el.tagName.toLowerCase();
  const marks = getMarksFromElement(el);

  if (tag === 'a') {
    const href = el.getAttribute('href') || '';
    const children = getInlineChildren(el);
    return [{ type: 'a', url: href, children } as SlateElement];
  }

  // For other inline elements, get text with marks
  const children = getInlineChildrenWithMarks(el, marks);
  return children;
}

function getMarksFromElement(el: HTMLElement): Partial<SlateText> {
  const marks: Partial<SlateText> = {};
  const tag = el.tagName.toLowerCase();
  const style = el.style;

  // Semantic tags
  if (tag === 'strong' || tag === 'b') marks.bold = true;
  if (tag === 'em' || tag === 'i') marks.italic = true;
  if (tag === 'u') marks.underline = true;
  if (tag === 's' || tag === 'del' || tag === 'strike') marks.strikethrough = true;
  if (tag === 'code') marks.code = true;

  // Check inline/resolved styles on ANY element (not just <span>)
  // Google Docs export applies styles via CSS classes on <span>, <p>, etc.
  const fw = style.fontWeight;
  if (fw === 'bold' || fw === '700' || fw === '800' || fw === '900' || parseInt(fw) >= 700) {
    marks.bold = true;
  }
  if (style.fontStyle === 'italic') marks.italic = true;
  const td = style.textDecoration || style.textDecorationLine || '';
  if (td.includes('underline')) marks.underline = true;
  if (td.includes('line-through')) marks.strikethrough = true;

  return marks;
}

function getInlineChildrenWithMarks(el: HTMLElement, parentMarks: Partial<SlateText>): SlateNode[] {
  const result: SlateNode[] = [];

  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent || '';
      if (text) {
        result.push({ text, ...parentMarks } as SlateText);
      }
      continue;
    }

    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const childEl = child as HTMLElement;
    const tag = childEl.tagName.toLowerCase();

    if (tag === 'br') {
      result.push({ text: '\n', ...parentMarks } as SlateText);
      continue;
    }

    if (tag === 'a') {
      const href = childEl.getAttribute('href') || '';
      const children = getInlineChildren(childEl);
      // Apply parent marks to link children
      const markedChildren = children.map((c) => {
        if ('text' in c) return { ...c, ...parentMarks };
        return c;
      });
      result.push({ type: 'a', url: href, children: markedChildren } as SlateElement);
      continue;
    }

    const childMarks = { ...parentMarks, ...getMarksFromElement(childEl) };
    const childNodes = getInlineChildrenWithMarks(childEl, childMarks);
    result.push(...childNodes);
  }

  return result;
}

/**
 * Convert plain text (fallback) to Slate nodes.
 */
export function plainTextToSlateNodes(text: string): SlateElement[] {
  const lines = text.split('\n');
  return lines.map((line) => ({
    type: 'p' as const,
    children: [{ text: line }],
  }));
}

// ── Markdown-to-Slate (for Notion "Export as Markdown") ─────────────

/**
 * Parse inline markdown within a single line and return SlateNode[].
 */
function parseMarkdownInline(text: string): SlateNode[] {
  const nodes: SlateNode[] = [];

  // Combined regex — order matters:
  // 1. links  [text](url)
  // 2. inline code `code`
  // 3. bold+italic ***text*** or ___text___
  // 4. bold **text** or __text__
  // 5. strikethrough ~~text~~
  // 6. italic *text* or _text_
  const inlineRe =
    /\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*{3}(.+?)\*{3}|_{3}(.+?)_{3}|\*{2}(.+?)\*{2}|_{2}(.+?)_{2}|~~(.+?)~~|\*(.+?)\*|(?<=\s|^)_([^_]+)_(?=\s|$|[.,;:!?])/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = inlineRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push({ text: text.slice(lastIndex, match.index) });
    }

    if (match[1] !== undefined && match[2] !== undefined) {
      // Link
      nodes.push({
        type: 'a',
        url: match[2],
        children: [{ text: match[1] }],
      } as SlateElement);
    } else if (match[3] !== undefined) {
      nodes.push({ text: match[3], code: true });
    } else if (match[4] !== undefined || match[5] !== undefined) {
      nodes.push({ text: match[4] ?? match[5], bold: true, italic: true });
    } else if (match[6] !== undefined || match[7] !== undefined) {
      nodes.push({ text: match[6] ?? match[7], bold: true });
    } else if (match[8] !== undefined) {
      nodes.push({ text: match[8], strikethrough: true });
    } else if (match[9] !== undefined || match[10] !== undefined) {
      nodes.push({ text: match[9] ?? match[10], italic: true });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push({ text: text.slice(lastIndex) });
  }

  if (nodes.length === 0) {
    nodes.push({ text: '' });
  }

  return nodes;
}

/**
 * Convert a Markdown string (e.g. exported from Notion) into Slate nodes.
 *
 * Handles: headings, bold, italic, links, blockquotes, ordered/unordered
 * lists, fenced code blocks, horizontal rules, and strikethrough.
 */
export function markdownToSlateNodes(md: string): SlateElement[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: SlateElement[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // ── Fenced code block ```
    if (/^```/.test(line)) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({ type: 'p', children: [{ text: codeLines.join('\n'), code: true }] });
      continue;
    }

    // ── Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: 'hr', children: [{ text: '' }] });
      i++;
      continue;
    }

    // ── Headings
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3;
      blocks.push({ type: `h${level}`, children: parseMarkdownInline(headingMatch[2]) });
      i++;
      continue;
    }

    // ── Blockquote (accumulate consecutive lines)
    if (line.startsWith('> ')) {
      const parts: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        parts.push(lines[i].slice(2));
        i++;
      }
      blocks.push({ type: 'blockquote', children: parseMarkdownInline(parts.join(' ')) });
      continue;
    }

    // ── Unordered list item
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
    if (ulMatch) {
      const inlines = parseMarkdownInline(ulMatch[2]);
      // Prepend bullet
      if (inlines.length > 0 && 'text' in inlines[0]) {
        inlines[0] = { ...inlines[0], text: '• ' + (inlines[0] as SlateText).text };
      } else {
        inlines.unshift({ text: '• ' });
      }
      blocks.push({ type: 'p', children: inlines });
      i++;
      continue;
    }

    // ── Ordered list item
    const olMatch = line.match(/^(\s*)(\d+)[.)]\s+(.+)$/);
    if (olMatch) {
      const num = olMatch[2];
      const inlines = parseMarkdownInline(olMatch[3]);
      if (inlines.length > 0 && 'text' in inlines[0]) {
        inlines[0] = { ...inlines[0], text: `${num}. ` + (inlines[0] as SlateText).text };
      } else {
        inlines.unshift({ text: `${num}. ` });
      }
      blocks.push({ type: 'p', children: inlines });
      i++;
      continue;
    }

    // ── Blank line — skip
    if (line.trim() === '') {
      i++;
      continue;
    }

    // ── Regular paragraph
    blocks.push({ type: 'p', children: parseMarkdownInline(line) });
    i++;
  }

  if (blocks.length === 0) {
    blocks.push({ type: 'p', children: [{ text: '' }] });
  }

  return blocks;
}
