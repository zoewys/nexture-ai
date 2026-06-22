/**
 * ComposerBar.tsx — 可复用的输入框组件
 *
 * 支持文件附件、文本输入、发送。在 Workflow 和 Single Agent 模式中共用。
 */

import { ArrowUp, Code2, FileText, Image, Paperclip, Plus, X } from 'lucide-react'
import type { ClipboardEvent } from 'react'

interface ComposerBarProps {
  value: string
  onChange: (value: string) => void
  onSend: () => Promise<void>
  disabled: boolean
  placeholder: string
  attachedFiles: string[]
  onPickFiles: () => Promise<void>
  onPasteImages?: (files: File[]) => Promise<void>
  onRemoveFile: (file: string) => void
  className?: string
}

export function ComposerBar({
  value,
  onChange,
  onSend,
  disabled,
  placeholder,
  attachedFiles,
  onPickFiles,
  onPasteImages,
  onRemoveFile,
  className
}: ComposerBarProps): JSX.Element {
  const canSend = !disabled && (value.trim() !== '' || attachedFiles.length > 0)
  const handlePaste = (event: ClipboardEvent<HTMLInputElement>): void => {
    if (disabled || !onPasteImages) return
    const imageFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)
    if (imageFiles.length === 0) return
    event.preventDefault()
    void onPasteImages(imageFiles)
  }

  return (
    <div className={`composer-bar ${className ?? ''}`}>
      {attachedFiles.length > 0 && (
        <div className="composer-attachments">
          {attachedFiles.map((file) => {
            const fileName = file.split('/').pop() || file
            const ext = (fileName.split('.').pop() || '').toLowerCase()
            const isImg = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp'].includes(ext)
            const isCode = ['ts', 'tsx', 'js', 'jsx', 'json', 'css', 'html', 'py', 'rb', 'go', 'rs'].includes(ext)
            const ChipIcon = isImg ? Image : isCode ? Code2 : ext === 'md' ? FileText : Paperclip
            const chipClass = isImg ? 'img' : isCode ? 'code' : ext === 'md' ? 'doc' : 'file'
            return (
              <div className="composer-chip" key={file}>
                <div className={`composer-chip-icon ${chipClass}`}><ChipIcon size={12} /></div>
                <span className="composer-chip-name" title={file}>{fileName}</span>
                <button type="button" className="composer-chip-remove" onClick={() => onRemoveFile(file)}><X size={12} /></button>
              </div>
            )
          })}
        </div>
      )}
      <div className="composer-row">
        <button type="button" className="composer-attach-btn" onClick={() => void onPickFiles()} title="添加文件或图片"><Plus size={16} /></button>
        <input
          className="composer-input"
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void onSend() } }}
        />
        <button
          type="button"
          className="composer-send-btn"
          onClick={() => void onSend()}
          disabled={!canSend}
        ><ArrowUp size={16} /></button>
      </div>
    </div>
  )
}
