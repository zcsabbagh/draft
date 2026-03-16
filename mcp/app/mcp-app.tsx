import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Plate,
  PlateContent,
  PlateElement,
  PlateLeaf,
  usePlateEditor,
} from "platejs/react";
import {
  BasicBlocksPlugin,
  BasicMarksPlugin,
  BoldPlugin,
  ItalicPlugin,
  UnderlinePlugin,
  StrikethroughPlugin,
  BlockquotePlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  HorizontalRulePlugin,
  CodePlugin,
} from "@platejs/basic-nodes/react";
import { ListPlugin } from "@platejs/list/react";
import { LinkPlugin } from "@platejs/link/react";

const DRAFT_BASE_URL = "https://draft-blue.vercel.app";

// ── Types ──

interface DocumentInfo {
  documentName: string;
}

interface SlateNode {
  type?: string;
  children?: SlateNode[];
  text?: string;
  [key: string]: unknown;
}

function parseToolResult(result: CallToolResult): DocumentInfo | null {
  const textContent = result.content?.find((c) => c.type === "text");
  if (!textContent || textContent.type !== "text") return null;
  try {
    const data = JSON.parse(textContent.text);
    if (data.document) return { documentName: data.document };
  } catch {
    const match = textContent.text.match(/Connected to "(.+?)"/);
    if (match) return { documentName: match[1] };
  }
  return null;
}

function parsePollResult(result: CallToolResult): { nodes: SlateNode[]; wordCount: number } | null {
  const textContent = result.content?.find((c) => c.type === "text");
  if (!textContent || textContent.type !== "text") return null;
  try {
    const data = JSON.parse(textContent.text);
    if (data.nodes) return { nodes: data.nodes, wordCount: data.wordCount || 0 };
  } catch {}
  return null;
}

// ── Editor with polled content ──

function LiveEditor({ nodes, onUserEdit, onFocus, onBlur, onWordCountChange }: { nodes: SlateNode[]; onUserEdit: (text: string) => void; onFocus: () => void; onBlur: () => void; onWordCountChange: (count: number) => void }) {
  const editor = usePlateEditor({
    plugins: [BasicBlocksPlugin, BasicMarksPlugin, ListPlugin, LinkPlugin],
    value: nodes,
    override: {
      components: {
        [BoldPlugin.key]: (props: any) => <PlateLeaf {...props} as="strong" />,
        [ItalicPlugin.key]: (props: any) => <PlateLeaf {...props} as="em" />,
        [UnderlinePlugin.key]: (props: any) => <PlateLeaf {...props} as="u" />,
        [StrikethroughPlugin.key]: (props: any) => <PlateLeaf {...props} as="s" />,
        [CodePlugin.key]: (props: any) => <PlateLeaf {...props} as="code" className="inline-code" />,
        [H1Plugin.key]: (props: any) => <PlateElement {...props} as="h1" className="editor-h1" />,
        [H2Plugin.key]: (props: any) => <PlateElement {...props} as="h2" className="editor-h2" />,
        [H3Plugin.key]: (props: any) => <PlateElement {...props} as="h3" className="editor-h3" />,
        [BlockquotePlugin.key]: (props: any) => <PlateElement {...props} as="blockquote" className="editor-blockquote" />,
        [HorizontalRulePlugin.key]: (props: any) => (
          <PlateElement {...props} as="div" className="editor-hr" contentEditable={false}>
            <hr />{props.children}
          </PlateElement>
        ),
        img: (props: any) => (
          <PlateElement {...props} as="figure" className="editor-img">
            <img src={props.element.url} alt="" style={{ maxWidth: "100%" }} />
            {props.children}
          </PlateElement>
        ),
      },
    },
  });

  const isUserEditingRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Update editor from polled nodes only when user is not editing
  useEffect(() => {
    if (nodes?.length > 0 && !isUserEditingRef.current) {
      try { editor.tf.setValue(nodes); } catch {}
    }
  }, [nodes]);

  const handleChange = useCallback(({ value }: { value: SlateNode[] }) => {
    // Always update word count on every change
    const text = value.map((n: SlateNode) =>
      (n.children || []).map((c: any) => c.text || "").join("")
    ).join("\n");
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    onWordCountChange(words);

    if (!isUserEditingRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onUserEdit(text);
    }, 2000);
  }, [onUserEdit, onWordCountChange]);

  const handleFocus = useCallback(() => {
    isUserEditingRef.current = true;
    onFocus();
  }, [onFocus]);

  const handleBlur = useCallback(() => {
    isUserEditingRef.current = false;
    onBlur();
    // Flush any pending debounced edit
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = undefined;
      // Send the current content immediately
      const text = editor.children.map((n: SlateNode) =>
        (n.children || []).map((c: any) => c.text || "").join("")
      ).join("\n");
      onUserEdit(text);
    }
  }, [onBlur, onUserEdit, editor]);

  return (
    <Plate editor={editor} onChange={handleChange}>
      <PlateContent
        className="editor-content"
        onFocus={handleFocus}
        onBlur={handleBlur}
      />
    </Plate>
  );
}

// ── Toolbar Icon Components ──

const BoldIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 2.5h4.5a3 3 0 0 1 0 6H4V2.5Z" stroke="currentColor" strokeWidth="1.5" /><path d="M4 8.5h5.5a3 3 0 0 1 0 6H4V8.5Z" stroke="currentColor" strokeWidth="1.5" /></svg>
);
const ItalicIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 2H6.5M9.5 14H6M8.5 2L7 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
);
const UnderlineIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 2v5a4 4 0 0 0 8 0V2M3 14h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
);
const StrikeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M5.5 4.5A2.5 2.5 0 0 1 8 2c1.5 0 3 .8 3 2.5M10.5 11.5A2.5 2.5 0 0 1 8 14c-1.5 0-3-.8-3-2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
);
const LinkIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6.5 9.5l3-3M5.5 7L4 8.5a2.5 2.5 0 0 0 3.5 3.5L9 10.5M10.5 9l1.5-1.5A2.5 2.5 0 0 0 8.5 4L7 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
);
const ExternalLinkIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5.5 2.5H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V9M8 2h4v4M12 2L6 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

// ── Main App ──

export default function DocumentPreview() {
  const [documentInfo, setDocumentInfo] = useState<DocumentInfo | null>(null);
  const [nodes, setNodes] = useState<SlateNode[] | null>(null);
  const [wordCount, setWordCount] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();
  const pollRef = useRef<ReturnType<typeof setInterval>>();
  const isEditingRef = useRef(false);
  const resumePollTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const { app, error: appError } = useApp({
    appInfo: { name: "Draft Document Preview", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (appInstance: any) => {
      appInstance.ontoolinput = () => {};
      appInstance.ontoolresult = (result: CallToolResult) => {
        const info = parseToolResult(result);
        if (info) setDocumentInfo(info);
      };
      appInstance.onhostcontextchanged = (ctx: McpUiHostContext) => {
        setHostContext((prev: any) => ({ ...prev, ...ctx }));
      };
      appInstance.onteardown = async () => {
        if (pollRef.current) clearInterval(pollRef.current);
        return {};
      };
    },
  });

  useEffect(() => {
    if (app) setHostContext(app.getHostContext());
  }, [app]);

  // Poll for document content (paused while user is editing)
  const startPolling = useCallback(() => {
    if (!app || !documentInfo) return;
    if (pollRef.current) clearInterval(pollRef.current);
    const poll = async () => {
      if (isEditingRef.current) return;
      try {
        const result = await app.callServerTool({ name: "poll_document", arguments: {} });
        const parsed = parsePollResult(result);
        if (parsed) { setNodes(parsed.nodes); setWordCount(parsed.wordCount); }
      } catch (e) { console.error("Poll error:", e); }
    };
    poll();
    pollRef.current = setInterval(poll, 2000);
  }, [app, documentInfo]);

  useEffect(() => {
    startPolling();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [startPolling]);

  const handleUserEdit = useCallback(async (text: string) => {
    if (!app) return;
    try {
      await app.callServerTool({ name: "apply_user_edit", arguments: { content: text } });
    } catch (e) { console.error("Edit sync error:", e); }
  }, [app]);

  const handleEditorFocus = useCallback(() => {
    isEditingRef.current = true;
    if (resumePollTimerRef.current) clearTimeout(resumePollTimerRef.current);
    // Pause polling
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = undefined; }
  }, []);

  const handleEditorBlur = useCallback(() => {
    isEditingRef.current = false;
    // Resume polling after 5 seconds
    if (resumePollTimerRef.current) clearTimeout(resumePollTimerRef.current);
    resumePollTimerRef.current = setTimeout(() => {
      startPolling();
    }, 5000);
  }, [startPolling]);

  const toggleFullscreen = useCallback(async () => {
    if (!app) return;
    const newMode = isFullscreen ? "inline" : "fullscreen";
    const result = await app.requestDisplayMode({ mode: newMode });
    setIsFullscreen(result.mode === "fullscreen");
  }, [app, isFullscreen]);

  const handleOpenInDraft = useCallback(async () => {
    if (!app || !documentInfo) return;
    const url = `${DRAFT_BASE_URL}/d/${encodeURIComponent(documentInfo.documentName)}`;
    await app.openLink({ url });
  }, [app, documentInfo]);

  const handleSendToClaude = useCallback(async () => {
    if (!app || !nodes) return;
    const text = nodes.map(n => (n.children || []).map((c: any) => c.text || "").join("")).join("\n");
    await app.sendMessage({
      role: "user",
      content: [{ type: "text", text: `Here's the current document content:\n\n${text}` }],
    });
  }, [app, nodes]);

  const canFullscreen = hostContext?.availableDisplayModes?.includes("fullscreen");

  if (appError) {
    return <div className="center-container"><p style={{ color: "#c0392b", fontSize: 13 }}>Failed to connect: {appError.message}</p></div>;
  }

  if (!documentInfo) {
    return <div className="center-container"><div className="spinner" /><p className="muted-text">Connecting to document...</p></div>;
  }

  return (
    <div className="app-container" style={{ borderRadius: isFullscreen ? 0 : 8 }}>
      {/* Header bar */}
      <div className="header-bar">
        <div className="header-left">
          <span className="draft-logo">Draft</span>
          <span className="separator">/</span>
          <span className="doc-name">{documentInfo.documentName}</span>
        </div>
        <div className="header-right">
          {wordCount > 0 && <span className="word-count">{wordCount} words</span>}
          <span className="live-dot" title="Connected" />
          <button onClick={handleOpenInDraft} className="header-btn open-btn" title="Open in Draft">
            <ExternalLinkIcon />
            <span>Open</span>
          </button>
          <button onClick={handleSendToClaude} className="header-btn" title="Send to Claude">
            Send to Chat
          </button>
          {canFullscreen && (
            <button onClick={toggleFullscreen} className="header-btn" title={isFullscreen ? "Shrink" : "Enlarge"}>
              {isFullscreen ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 1v4h4M5 13V9H1M9 5L13 1M5 9l-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 5V1h4M13 9v4h-4M5 1L1 5M9 13l4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
              )}
              <span>{isFullscreen ? "Shrink" : "Enlarge"}</span>
            </button>
          )}
        </div>
      </div>

      {/* Formatting toolbar — matches the web app */}
      <div className="format-toolbar">
        <div className="format-group">
          <span className="font-label">Georgia</span>
          <span className="font-size-label">17</span>
        </div>
        <div className="format-divider" />
        <div className="format-group">
          <button className="format-btn" title="Heading 1">H1</button>
          <button className="format-btn" title="Heading 2">H2</button>
          <button className="format-btn" title="Heading 3">H3</button>
        </div>
        <div className="format-divider" />
        <div className="format-group">
          <button className="format-btn" title="Bold"><BoldIcon /></button>
          <button className="format-btn" title="Italic"><ItalicIcon /></button>
          <button className="format-btn" title="Underline"><UnderlineIcon /></button>
          <button className="format-btn" title="Strikethrough"><StrikeIcon /></button>
          <button className="format-btn" title="Code">&lt;/&gt;</button>
        </div>
        <div className="format-divider" />
        <div className="format-group">
          <button className="format-btn" title="Blockquote">&ldquo;</button>
          <button className="format-btn" title="Align left">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 3h12M2 6.5h8M2 10h12M2 13.5h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
          </button>
          <button className="format-btn" title="Align center">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 3h12M4 6.5h8M2 10h12M4 13.5h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
          </button>
          <button className="format-btn" title="Align right">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 3h12M6 6.5h8M2 10h12M6 13.5h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
          </button>
          <button className="format-btn" title="Justify">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 3h12M2 6.5h12M2 10h12M2 13.5h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div className="format-divider" />
        <div className="format-group">
          <button className="format-btn" title="Image">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><circle cx="5.5" cy="5.5" r="1.5" fill="currentColor"/><path d="M2 11l3-3 2 2 3-3 4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button className="format-btn" title="Table">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M2 6h12M2 10h12M6 2v12M10 2v12" stroke="currentColor" strokeWidth="1"/></svg>
          </button>
          <button className="format-btn" title="Link"><LinkIcon /></button>
        </div>
      </div>

      {/* Document page */}
      <div className="page-background">
        <div className="page-container">
          <div className="page-content">
            {nodes ? (
              <LiveEditor nodes={nodes} onUserEdit={handleUserEdit} onFocus={handleEditorFocus} onBlur={handleEditorBlur} onWordCountChange={setWordCount} />
            ) : (
              <div className="center-container" style={{ minHeight: 200 }}>
                <div className="spinner" />
                <p className="muted-text">Loading document...</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
