import { useMemo } from 'react';
import { marked } from 'marked';

marked.setOptions({
  breaks: true,
  gfm: true,
});

export default function MarkdownContent({ content }: { content: string }) {
  const html = useMemo(() => {
    try {
      return marked.parse(content) as string;
    } catch {
      return content;
    }
  }, [content]);

  return (
    <div
      className="markdown-content"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
