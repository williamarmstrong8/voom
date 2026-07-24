"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"

/**
 * Renders build-guide Markdown as Notion-style blocks (headers, bullets,
 * numbered lists, callouts, code blocks, tables) using the app's design tokens.
 * Pasted content from Notion's Markdown export maps cleanly onto these.
 */
function normalizeNotionMarkdown(markdown: string) {
  return markdown
    .replace(/<aside(?:\s[^>]*)?>\s*([\s\S]*?)\s*<\/aside>/gi, (_, content: string) =>
      content
        .trim()
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n"),
    )
    .replace(/^\s*<\/?aside(?:\s[^>]*)?>\s*$/gim, "")
}

export function GuideMarkdown({ children, className }: { children: string; className?: string }) {
  const markdown = normalizeNotionMarkdown(children)

  return (
    <div className={cn("min-w-0 max-w-full overflow-hidden break-words text-copy-14 leading-6 text-[var(--ds-gray-1000)] [overflow-wrap:anywhere]", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mt-6 mb-2 text-pretty text-heading-20 first:mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-5 mb-2 text-pretty text-heading-16 first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-4 mb-1.5 text-pretty text-heading-14 first:mt-0">{children}</h3>
          ),
          p: ({ children }) => <p className="my-2 text-pretty first:mt-0 last:mb-0">{children}</p>,
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="break-all font-medium text-[var(--ds-blue-700)] underline underline-offset-2 hover:opacity-80"
            >
              {children}
            </a>
          ),
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => (
            <ul className="my-2 flex list-disc flex-col gap-1.5 pl-5 marker:text-[var(--ds-gray-700)]">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 flex list-decimal flex-col gap-1.5 pl-5 marker:text-[var(--ds-gray-700)]">{children}</ol>
          ),
          li: ({ children }) => <li className="text-pretty pl-0.5 [&>p]:my-0">{children}</li>,
          hr: () => <hr className="my-5 border-[var(--ds-gray-alpha-400)]" />,
          blockquote: ({ children }) => (
            <blockquote className="my-3 rounded-md border border-[var(--ds-gray-alpha-400)] bg-[var(--ds-background-100)] px-3 py-2.5 text-pretty shadow-[var(--ds-shadow-border)] [&>p]:my-0">
              {children}
            </blockquote>
          ),
          pre: ({ children }) => (
            <pre className="my-3 max-w-full overflow-x-auto rounded-md bg-[var(--ds-gray-100)] p-3 font-mono text-copy-13 leading-6 shadow-[var(--ds-shadow-border)]">
              {children}
            </pre>
          ),
          code: ({ children, className: codeClass }) => {
            const isBlock = codeClass?.includes("language-") || String(children).includes("\n")
            if (isBlock) {
              return <code className={cn("font-mono text-foreground", codeClass)}>{children}</code>
            }
            return (
              <code className="rounded-sm border border-border bg-secondary px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">
                {children}
              </code>
            )
          },
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-md border border-border">
              <table className="w-full border-collapse text-copy-13">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-secondary/60">{children}</thead>,
          th: ({ children }) => <th className="border-b border-border px-3 py-1.5 text-left font-semibold">{children}</th>,
          td: ({ children }) => <td className="border-b border-border px-3 py-1.5 align-top">{children}</td>,
          img: ({ src, alt }) =>
            typeof src === "string" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src || "/placeholder.svg"} alt={alt ?? ""} className="my-3 w-full rounded-md border border-border" />
            ) : null,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}
