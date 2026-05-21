"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
// Don't import a hljs stylesheet here — globals.css owns the syntax
// colors and provides both light (GitHub Light) and `.dark` (GitHub Dark)
// variants. Importing one of hljs' shipped stylesheets pins the colors
// to a single theme and overrides the light variant.

export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
