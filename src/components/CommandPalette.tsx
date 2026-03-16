import { useEffect, useRef, useCallback } from 'react';
import { Command } from 'cmdk';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEditor = any;

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  editor: AnyEditor | null;
  onExportPDF: () => void;
  onRequestFeedback: () => void;
  onOpenImportDialog: () => void;
}

interface CommandItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  shortcut?: string;
  action: () => void;
  group: string;
}

// ── Tiny SVG icons ──

const icons = {
  bold: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M4 2.5h5a3 3 0 0 1 0 6H4V2.5Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 8.5h5.5a3 3 0 0 1 0 6H4V8.5Z" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  italic: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <line x1="10" y1="2" x2="6" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="7" y1="2" x2="12" y2="2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="4" y1="14" x2="9" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  underline: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M4 2v6a4 4 0 0 0 8 0V2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="3" y1="14" x2="13" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  strikethrough: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M10.5 5.5C10.5 4.12 9.38 3 8 3s-2.5 1.12-2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M5.5 10.5C5.5 11.88 6.62 13 8 13s2.5-1.12 2.5-2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  code: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <polyline points="5,4 2,8 5,12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="11,4 14,8 11,12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  clearFormat: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <line x1="3" y1="3" x2="13" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="13" y1="3" x2="3" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  alignLeft: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <line x1="2" y1="3" x2="14" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="2" y1="7" x2="10" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="2" y1="11" x2="14" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  alignCenter: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <line x1="2" y1="3" x2="14" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="4" y1="7" x2="12" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="2" y1="11" x2="14" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  alignRight: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <line x1="2" y1="3" x2="14" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="6" y1="7" x2="14" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="2" y1="11" x2="14" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  justify: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <line x1="2" y1="3" x2="14" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="2" y1="7" x2="14" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="2" y1="11" x2="14" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  heading: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <line x1="3" y1="3" x2="3" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="13" y1="3" x2="13" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="3" y1="8" x2="13" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  paragraph: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M7 13V3h4v10M7 3H5.5a2.5 2.5 0 0 0 0 5H7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  blockquote: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3 4v8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="6" y1="5" x2="13" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="6" y1="8" x2="11" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="6" y1="11" x2="13" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  codeBlock: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="1.5" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.2" />
      <polyline points="5,6 3.5,8 5,10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="11,6 12.5,8 11,10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  bulletList: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="3.5" cy="4" r="1.2" fill="currentColor" />
      <circle cx="3.5" cy="8" r="1.2" fill="currentColor" />
      <circle cx="3.5" cy="12" r="1.2" fill="currentColor" />
      <line x1="7" y1="4" x2="14" y2="4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="7" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="7" y1="12" x2="14" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  numberedList: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <text x="2" y="5.5" fontSize="6" fill="currentColor" fontFamily="system-ui" fontWeight="600">1</text>
      <text x="2" y="9.5" fontSize="6" fill="currentColor" fontFamily="system-ui" fontWeight="600">2</text>
      <text x="2" y="13.5" fontSize="6" fill="currentColor" fontFamily="system-ui" fontWeight="600">3</text>
      <line x1="7" y1="4" x2="14" y2="4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="7" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="7" y1="12" x2="14" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  pageBreak: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <line x1="1" y1="8" x2="5" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2 2" />
      <line x1="11" y1="8" x2="15" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2 2" />
      <rect x="6" y="5.5" width="4" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ),
  horizontalRule: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  table: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="2" width="13" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <line x1="1.5" y1="6" x2="14.5" y2="6" stroke="currentColor" strokeWidth="1" />
      <line x1="1.5" y1="10" x2="14.5" y2="10" stroke="currentColor" strokeWidth="1" />
      <line x1="6" y1="2" x2="6" y2="14" stroke="currentColor" strokeWidth="1" />
      <line x1="10" y1="2" x2="10" y2="14" stroke="currentColor" strokeWidth="1" />
    </svg>
  ),
  image: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="2" width="13" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="5.5" cy="6" r="1.5" fill="currentColor" />
      <path d="M2 12l3-4 2.5 3L10 7.5 14 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  lineSpacing: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <line x1="6" y1="3" x2="14" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="6" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="6" y1="13" x2="14" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M3 5l-1-2-1 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 11l-1 2-1-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="2" y1="4" x2="2" y2="12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
  pdf: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M4 1.5h5l4 4v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.2" />
      <path d="M9 1.5v4h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
  feedback: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5l-3 3V3Z" stroke="currentColor" strokeWidth="1.2" />
      <line x1="5" y1="5.5" x2="11" y2="5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="5" y1="8" x2="9" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
  import: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 2v8M5 7l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 11v2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
};

function useCommands(
  editor: AnyEditor | null,
  onExportPDF: () => void,
  onRequestFeedback: () => void,
  onOpenImportDialog: () => void,
  onClose: () => void,
): CommandItem[] {
  const run = useCallback(
    (fn: () => void) => {
      return () => {
        fn();
        onClose();
        // Re-focus the editor after a short delay
        requestAnimationFrame(() => {
          const el = document.querySelector('[data-slate-editor]') as HTMLElement | null;
          el?.focus();
        });
      };
    },
    [onClose],
  );

  if (!editor) return [];

  const toggleMark = (mark: string) => {
    try {
      const marks = editor.getMarks();
      if (marks && marks[mark]) {
        editor.removeMark(mark);
      } else {
        editor.addMark(mark, true);
      }
    } catch { /* ignore */ }
  };

  const isBlockActive = (type: string) => {
    try {
      const [match] = editor.nodes({ match: (n: AnyEditor) => n.type === type });
      return !!match;
    } catch {
      return false;
    }
  };

  const setBlockType = (type: string) => {
    try {
      editor.setNodes(
        { type },
        { match: (n: AnyEditor) => editor.isBlock(n) },
      );
    } catch { /* ignore */ }
  };

  const toggleBlock = (type: string) => {
    const isActive = isBlockActive(type);
    setBlockType(isActive ? 'p' : type);
  };

  const setAlignment = (align: string) => {
    try {
      editor.setNodes(
        { align },
        { match: (n: AnyEditor) => editor.isBlock(n) },
      );
    } catch { /* ignore */ }
  };

  const setLineHeight = (lineHeight: string) => {
    try {
      editor.setNodes(
        { lineHeight },
        { match: (n: AnyEditor) => editor.isBlock(n) },
      );
    } catch { /* ignore */ }
  };

  const clearFormatting = () => {
    try {
      const marks = editor.getMarks();
      if (marks) {
        for (const key of Object.keys(marks)) {
          editor.removeMark(key);
        }
      }
    } catch { /* ignore */ }
  };

  const insertTable = () => {
    try {
      editor.insertNode({
        type: 'table',
        children: [
          {
            type: 'tr',
            children: [
              { type: 'th', children: [{ text: 'Header 1' }] },
              { type: 'th', children: [{ text: 'Header 2' }] },
              { type: 'th', children: [{ text: 'Header 3' }] },
            ],
          },
          {
            type: 'tr',
            children: [
              { type: 'td', children: [{ text: '' }] },
              { type: 'td', children: [{ text: '' }] },
              { type: 'td', children: [{ text: '' }] },
            ],
          },
          {
            type: 'tr',
            children: [
              { type: 'td', children: [{ text: '' }] },
              { type: 'td', children: [{ text: '' }] },
              { type: 'td', children: [{ text: '' }] },
            ],
          },
        ],
      });
    } catch { /* ignore */ }
  };

  const insertImage = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      if (input.files) {
        Array.from(input.files).forEach((file) => {
          if (!file.type.startsWith('image/')) return;
          const reader = new FileReader();
          reader.onload = () => {
            const url = reader.result as string;
            try {
              editor.insertNode({ type: 'img', url, children: [{ text: '' }] });
            } catch { /* ignore */ }
          };
          reader.readAsDataURL(file);
        });
      }
    };
    input.click();
  };

  return [
    // Text Formatting
    { id: 'bold', label: 'Bold', icon: icons.bold, shortcut: '\u2318B', action: run(() => toggleMark('bold')), group: 'Text Formatting' },
    { id: 'italic', label: 'Italic', icon: icons.italic, shortcut: '\u2318I', action: run(() => toggleMark('italic')), group: 'Text Formatting' },
    { id: 'underline', label: 'Underline', icon: icons.underline, shortcut: '\u2318U', action: run(() => toggleMark('underline')), group: 'Text Formatting' },
    { id: 'strikethrough', label: 'Strikethrough', icon: icons.strikethrough, action: run(() => toggleMark('strikethrough')), group: 'Text Formatting' },
    { id: 'code', label: 'Code', icon: icons.code, action: run(() => toggleMark('code')), group: 'Text Formatting' },
    { id: 'clear-formatting', label: 'Clear Formatting', icon: icons.clearFormat, action: run(clearFormatting), group: 'Text Formatting' },

    // Text Alignment
    { id: 'align-left', label: 'Align Left', icon: icons.alignLeft, action: run(() => setAlignment('left')), group: 'Text Alignment' },
    { id: 'align-center', label: 'Align Center', icon: icons.alignCenter, action: run(() => setAlignment('center')), group: 'Text Alignment' },
    { id: 'align-right', label: 'Align Right', icon: icons.alignRight, action: run(() => setAlignment('right')), group: 'Text Alignment' },
    { id: 'justify', label: 'Justify', icon: icons.justify, action: run(() => setAlignment('justify')), group: 'Text Alignment' },

    // Block Types
    { id: 'heading-1', label: 'Heading 1', icon: icons.heading, action: run(() => toggleBlock('h1')), group: 'Block Types' },
    { id: 'heading-2', label: 'Heading 2', icon: icons.heading, action: run(() => toggleBlock('h2')), group: 'Block Types' },
    { id: 'heading-3', label: 'Heading 3', icon: icons.heading, action: run(() => toggleBlock('h3')), group: 'Block Types' },
    { id: 'paragraph', label: 'Paragraph', icon: icons.paragraph, action: run(() => setBlockType('p')), group: 'Block Types' },
    { id: 'blockquote', label: 'Block Quote', icon: icons.blockquote, action: run(() => toggleBlock('blockquote')), group: 'Block Types' },
    { id: 'code-block', label: 'Code Block', icon: icons.codeBlock, action: run(() => toggleBlock('code_block')), group: 'Block Types' },
    { id: 'bulleted-list', label: 'Bulleted List', icon: icons.bulletList, action: run(() => toggleBlock('ul')), group: 'Block Types' },
    { id: 'numbered-list', label: 'Numbered List', icon: icons.numberedList, action: run(() => toggleBlock('ol')), group: 'Block Types' },

    // Insert
    { id: 'page-break', label: 'Page Break', icon: icons.pageBreak, action: run(() => { try { editor.insertNode({ type: 'page_break', children: [{ text: '' }] }); } catch { /* ignore */ } }), group: 'Insert' },
    { id: 'horizontal-rule', label: 'Horizontal Rule', icon: icons.horizontalRule, action: run(() => { try { editor.insertNode({ type: 'hr', children: [{ text: '' }] }); } catch { /* ignore */ } }), group: 'Insert' },
    { id: 'table', label: 'Table (3x3)', icon: icons.table, action: run(insertTable), group: 'Insert' },
    { id: 'image', label: 'Image', icon: icons.image, action: run(insertImage), group: 'Insert' },

    // Line Spacing
    { id: 'spacing-1', label: 'Single (1.0)', icon: icons.lineSpacing, action: run(() => setLineHeight('1.0')), group: 'Line Spacing' },
    { id: 'spacing-1.15', label: 'Spacing 1.15', icon: icons.lineSpacing, action: run(() => setLineHeight('1.15')), group: 'Line Spacing' },
    { id: 'spacing-1.5', label: 'Spacing 1.5', icon: icons.lineSpacing, action: run(() => setLineHeight('1.5')), group: 'Line Spacing' },
    { id: 'spacing-2', label: 'Double (2.0)', icon: icons.lineSpacing, action: run(() => setLineHeight('2.0')), group: 'Line Spacing' },

    // Document
    { id: 'export-pdf', label: 'Export PDF', icon: icons.pdf, action: run(onExportPDF), group: 'Document' },
    { id: 'request-feedback', label: 'Request Feedback', icon: icons.feedback, action: run(onRequestFeedback), group: 'Document' },
    { id: 'import-gdocs', label: 'Import from Google Docs', icon: icons.import, action: run(onOpenImportDialog), group: 'Document' },
  ];
}

export default function CommandPalette({
  open,
  onClose,
  editor,
  onExportPDF,
  onRequestFeedback,
  onOpenImportDialog,
}: CommandPaletteProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const commands = useCommands(editor, onExportPDF, onRequestFeedback, onOpenImportDialog, onClose);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  // Group the commands
  const groups: Record<string, CommandItem[]> = {};
  for (const cmd of commands) {
    if (!groups[cmd.group]) groups[cmd.group] = [];
    groups[cmd.group].push(cmd);
  }

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[20vh] animate-modal-backdrop"
      style={{ backgroundColor: 'rgba(0,0,0,0.25)' }}
      onMouseDown={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
    >
      <div className="w-full max-w-[520px] animate-modal-enter">
        <Command
          className="command-palette"
          loop
          filter={(value, search) => {
            // Fuzzy match: check if all search chars appear in order
            const v = value.toLowerCase();
            const s = search.toLowerCase();
            let vi = 0;
            for (let si = 0; si < s.length; si++) {
              vi = v.indexOf(s[si], vi);
              if (vi === -1) return 0;
              vi++;
            }
            // Boost exact prefix matches
            if (v.startsWith(s)) return 1;
            return 0.5;
          }}
        >
          <Command.Input
            placeholder="Type a command..."
            autoFocus
            className="command-palette-input"
          />
          <Command.List className="command-palette-list custom-scrollbar">
            <Command.Empty className="command-palette-empty">
              No results found.
            </Command.Empty>
            {Object.entries(groups).map(([group, items]) => (
              <Command.Group key={group} heading={group} className="command-palette-group">
                {items.map((cmd) => (
                  <Command.Item
                    key={cmd.id}
                    value={cmd.label}
                    onSelect={cmd.action}
                    className="command-palette-item"
                  >
                    <span className="command-palette-icon">{cmd.icon}</span>
                    <span className="command-palette-label">{cmd.label}</span>
                    {cmd.shortcut && (
                      <span className="command-palette-shortcut">{cmd.shortcut}</span>
                    )}
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
