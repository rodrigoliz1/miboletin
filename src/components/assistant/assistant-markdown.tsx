"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function AssistantMarkdown({ content }: { content: string }) {
  return <div className="assistant-markdown">
    <ReactMarkdown
      remarkPlugins={[[remarkGfm, { singleTilde: false }]]}
      components={{
        h1: ({ children }) => <h2>{children}</h2>,
        img: () => null,
        a: ({ href, children }) => {
          const external = Boolean(href && /^https?:\/\//i.test(href));
          return <a href={href} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>{children}</a>;
        },
        table: ({ children }) => <div className="assistant-table-scroll" tabIndex={0} role="region" aria-label="Tabla de resultados"><table>{children}</table></div>,
      }}
    >{content}</ReactMarkdown>
  </div>;
}
