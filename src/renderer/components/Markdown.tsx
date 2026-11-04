import { isValidElement, memo, useEffect, useId, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import { Copy, Check } from 'lucide-react'
import 'katex/dist/katex.min.css'
import 'highlight.js/styles/github-dark.css'
function Diagram({ source }: { source: string }) {
  const id = `mermaid-${useId().replace(/:/g, '')}`
  const [svg, setSvg] = useState('')
  useEffect(() => {
    let alive = true
    void import('mermaid')
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'neutral',
          suppressErrorRendering: true,
          maxTextSize: 24000,
        })
        const result = await mermaid.render(id, source)
        if (alive) setSvg(result.svg)
      })
      .catch(() => {
        if (alive) setSvg('')
      })
    return () => {
      alive = false
    }
  }, [source, id])
  // Mermaid's strict security mode sanitizes generated SVG. No raw HTML from Markdown is enabled.
  return svg ? (
    <div className="diagram" dangerouslySetInnerHTML={{ __html: svg }} />
  ) : (
    <pre>{source}</pre>
  )
}
function codeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(codeText).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return codeText(node.props.children)
  return ''
}
function Code({
  code,
  language,
  highlighted,
}: {
  code: string
  language: string
  highlighted: ReactNode
}) {
  const [copied, setCopied] = useState(false)
  return (
    <details className="code-block" open>
      <summary>
        <span>{language || 'code'}</span>
        <button
          title="Copy code"
          onClick={(e) => {
            e.preventDefault()
            void navigator.clipboard.writeText(code).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            })
          }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </summary>
      {language === 'mermaid' ? (
        <Diagram source={code} />
      ) : (
        <pre>
          <code>{highlighted}</code>
        </pre>
      )}
    </details>
  )
}
export const Markdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        components={{
          a: ({ children }) => <span className="text-link">{children}</span>,
          img: ({ alt }) => <span>[Image: {alt}]</span>,
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const code = codeText(children).replace(/\n$/, '')
            const language = /language-(\w+)/.exec(className || '')?.[1] || ''
            return language || code.includes('\n') ? (
              <Code language={language} code={code} highlighted={children} />
            ) : (
              <code>{children}</code>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
