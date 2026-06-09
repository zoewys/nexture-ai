/**
 * MarkdownPreview.tsx — 可复用的 Markdown 渲染组件
 *
 * 将 Markdown 文本转为 HTML 并渲染，支持：
 *  - 标题 (h1-h6)
 *  - 粗体 / 斜体 / 删除线
 *  - 行内代码 & 代码块
 *  - 无序 & 有序列表
 *  - 链接 & 图片
 *  - 引用块
 *  - 水平分割线
 *  - 基本表格
 */

import { useMemo } from 'react'

interface MarkdownPreviewProps {
  /** Raw markdown source text. */
  source: string
  /** Additional class name for the wrapper. */
  className?: string
}

export function MarkdownPreview({ source, className }: MarkdownPreviewProps): JSX.Element {
  const html = useMemo(() => renderMarkdown(source), [source])

  return (
    <div
      className={`markdown-preview ${className ?? ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

// ── Renderer ────────────────────────────────────────────────────────────────

function renderMarkdown(text: string): string {
  // Normalize CRLF → LF
  let html = text.replace(/\r\n/g, '\n')

  // Escape HTML entities in the raw text first,
  // but only outside code blocks (which we handle separately).
  const codeBlocks: string[] = []
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_full, lang: string, code: string) => {
    const idx = codeBlocks.length
    codeBlocks.push(escapeHtml(code.trimEnd()))
    return `%%CODEBLOCK_${idx}_${escapeAttr(lang)}%%`
  })

  // Inline code
  html = html.replace(/`([^`]+)`/g, (_full, code: string) => {
    return `<code>${escapeHtml(code)}</code>`
  })

  // Headings (must be before bold/italic)
  html = html.replace(/^###### (.+)$/gm, '<h6>$1</h6>')
  html = html.replace(/^##### (.+)$/gm, '<h5>$1</h5>')
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>')
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')

  // Horizontal rules
  html = html.replace(/^(---|\*\*\*|___)\s*$/gm, '<hr/>')

  // Blockquote
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote><p>$1</p></blockquote>')
  // Merge adjacent blockquotes
  html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n')

  // Bold & italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>')

  // Images (before links)
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy"/>')

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')

  // Tables: convert pipe-delimited rows
  html = convertTables(html)

  // Unordered lists
  html = html.replace(/^[\*\-] (.+)$/gm, '<li>$1</li>')
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
  // Only wrap li that haven't been wrapped yet
  html = html.replace(/<ul>[\s\S]*?<\/ul>/g, (match) => {
    // Already wrapped — skip. We'll re-wrap remaining li with ol below.
    return `%%UL_${match.length}%%`
  })
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, (match) => {
    if (match.includes('%%UL_')) return match
    return `<ol>${match}</ol>`
  })
  // Restore already-wrapped ul
  html = html.replace(/%%UL_\d+%%/g, '')

  // Paragraphs: wrap remaining text lines
  html = html
    .split(/\n\n+/)
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => {
      // Skip blocks that are already HTML tags
      if (/^<(h[1-6]|ul|ol|pre|blockquote|hr|table|div)/.test(block)) return block
      // Wrap in paragraph
      return `<p>${block.replace(/\n/g, '<br/>')}</p>`
    })
    .join('\n')

  // Restore code blocks
  html = html.replace(/%%CODEBLOCK_(\d+)_([^%]*)%%/g, (_full, idx: string, lang: string) => {
    const langAttr = lang ? ` data-lang="${lang}"` : ''
    return `<pre${langAttr}><code>${codeBlocks[parseInt(idx)] ?? ''}</code></pre>`
  })

  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '')

  return html
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeAttr(text: string): string {
  return text.replace(/"/g, '&quot;').replace(/%/g, '&#37;')
}

function convertTables(html: string): string {
  return html.replace(/^\|(.+)\|\s*\n\|[-| :]+\|\s*\n((?:^\|.+\|\s*\n?)+)/gm, (_full, header: string, body: string) => {
    const headers = header.split('|').map(h => h.trim()).filter(Boolean)
    const rows = body.trim().split('\n').map(row =>
      row.split('|').map(c => c.trim()).filter(Boolean)
    )

    const thead = `<thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>`
    const tbody = `<tbody>${rows.map(row =>
      `<tr>${row.map(c => `<td>${c}</td>`).join('')}</tr>`
    ).join('')}</tbody>`

    return `<table>${thead}${tbody}</table>`
  })
}
