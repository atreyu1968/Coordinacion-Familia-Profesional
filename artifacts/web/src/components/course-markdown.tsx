import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Markdown is rendered as React elements; uploaded HTML is never executed. */
export function CourseMarkdown({ text }: { text: string }) {
  return (
    <div className="min-w-0 space-y-4 break-words text-sm leading-7">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
        h1: ({ children }) => <h2 className="mt-6 text-2xl font-semibold leading-tight">{children}</h2>,
        h2: ({ children }) => <h3 className="mt-6 text-xl font-semibold leading-snug">{children}</h3>,
        h3: ({ children }) => <h4 className="mt-5 text-lg font-semibold">{children}</h4>,
        h4: ({ children }) => <h5 className="mt-4 font-semibold">{children}</h5>,
        h5: ({ children }) => <h6 className="mt-4 font-semibold">{children}</h6>,
        h6: ({ children }) => <h6 className="mt-4 font-semibold">{children}</h6>,
        p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
        ul: ({ children }) => <ul className="list-disc space-y-1 pl-6">{children}</ul>,
        ol: ({ children, start }) => <ol start={start} className="list-decimal space-y-1 pl-6">{children}</ol>,
        a: ({ children, href }) => href
          ? <a href={href} target="_blank" rel="noopener noreferrer" className="break-words text-primary underline underline-offset-2">{children}</a>
          : <span>{children}</span>,
        blockquote: ({ children }) => <blockquote className="border-l-4 border-primary/40 pl-4 text-muted-foreground">{children}</blockquote>,
        pre: ({ children }) => <pre className="overflow-x-auto rounded-md bg-muted p-4 text-xs leading-6">{children}</pre>,
        code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{children}</code>,
        hr: () => <hr className="my-6 border-border" />,
        img: ({ src, alt }) => <img src={src} alt={alt ?? ""} loading="lazy" referrerPolicy="no-referrer" className="max-w-full rounded-md" />,
        table: ({ children }) => <div role="region" aria-label="Tabla de la lección" tabIndex={0} className="max-w-full overflow-x-auto rounded-md border border-border"><table className="w-full border-collapse text-left text-sm">{children}</table></div>,
        thead: ({ children }) => <thead className="bg-muted">{children}</thead>,
        th: ({ children, style }) => <th style={style} className="border-b border-border px-3 py-2 font-semibold">{children}</th>,
        td: ({ children, style }) => <td style={style} className="border-b border-border px-3 py-2 align-top">{children}</td>,
      }}>{text}</ReactMarkdown>
    </div>
  );
}
