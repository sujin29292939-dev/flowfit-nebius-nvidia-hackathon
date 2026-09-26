"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { CodeBlock } from "@/components/flowfit/chat/CodeBlock";

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div className="flowfit-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className ?? "");
            const code = String(children).replace(/\n$/, "");

            if (!match) {
              return (
                <code className="rounded-md bg-zinc-800 px-1.5 py-0.5 text-[0.9em] text-zinc-100" {...props}>
                  {children}
                </code>
              );
            }

            return <CodeBlock language={match[1] ?? "text"} code={code} />;
          },
          a({ children, ...props }) {
            return (
              <a className="font-semibold text-sky-700 underline underline-offset-4" target="_blank" rel="noreferrer" {...props}>
                {children}
              </a>
            );
          },
          table({ children }) {
            return (
              <div className="my-4 overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200 text-sm">{children}</table>
              </div>
            );
          },
          th({ children }) {
            return <th className="bg-slate-50 px-3 py-2 text-left font-semibold text-slate-900">{children}</th>;
          },
          td({ children }) {
            return <td className="border-t border-slate-100 px-3 py-2 align-top text-slate-700">{children}</td>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
