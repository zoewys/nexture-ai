/**
 * ComposerBar.tsx — 可复用的输入框组件
 *
 * 支持文件附件、文本输入、发送。在 Workflow 和 Single Agent 模式中共用。
 */

import { ArrowUp, BookOpen, Code2, FileText, Image, Paperclip, Plus, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ClipboardEvent, KeyboardEvent } from 'react'
import type { SkillSummary } from '@shared/types'

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
  skills?: SkillSummary[]
  selectedSkills?: SkillSummary[]
  onAddSkill?: (skill: SkillSummary) => void
  onRemoveSkill?: (skillId: string) => void
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
  skills = [],
  selectedSkills = [],
  onAddSkill,
  onRemoveSkill,
  className
}: ComposerBarProps): JSX.Element {
  const canSend = !disabled && (value.trim() !== '' || attachedFiles.length > 0)
  const [activeSkillIndex, setActiveSkillIndex] = useState(0)
  const [dismissedSlashValue, setDismissedSlashValue] = useState<string | null>(null)
  const slashQuery = useMemo(() => {
    const match = value.match(/^\/([^\s/]*)$/)
    return match ? match[1].toLowerCase() : null
  }, [value])
  const selectedSkillIds = useMemo(
    () => new Set(selectedSkills.map((skill) => skill.id)),
    [selectedSkills]
  )
  const filteredSkills = useMemo(() => {
    if (slashQuery === null) return []
    return skills
      .filter((skill) => !selectedSkillIds.has(skill.id))
      .filter((skill) => matchesSkillQuery(skill, slashQuery))
  }, [skills, selectedSkillIds, slashQuery])
  const showSkillMenu = !disabled &&
    slashQuery !== null &&
    dismissedSlashValue !== value &&
    !!onAddSkill &&
    filteredSkills.length > 0

  useEffect(() => {
    setActiveSkillIndex(0)
    if (dismissedSlashValue !== null && dismissedSlashValue !== value) {
      setDismissedSlashValue(null)
    }
  }, [dismissedSlashValue, value])

  const inputRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    if (disabled || !onPasteImages) return
    const imageFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)
    if (imageFiles.length === 0) return
    event.preventDefault()
    void onPasteImages(imageFiles)
  }
  const selectSkill = (skill: SkillSummary): void => {
    onAddSkill?.(skill)
    onChange('')
    setDismissedSlashValue(null)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (showSkillMenu) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveSkillIndex((index) => (index + 1) % filteredSkills.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveSkillIndex((index) => (index - 1 + filteredSkills.length) % filteredSkills.length)
        return
      }
      if (event.key === 'Tab' || event.key === 'Enter') {
        event.preventDefault()
        selectSkill(filteredSkills[activeSkillIndex] ?? filteredSkills[0])
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setDismissedSlashValue(value)
        return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void onSend()
    }
  }

  return (
    <div className={`composer-bar ${className ?? ''}`}>
      {showSkillMenu && (
        <div className="composer-skill-menu" role="listbox" aria-label="Skill list">
          <div className="composer-skill-menu-header">
            <Search size={13} />
            <span>Skills</span>
          </div>
          {filteredSkills.map((skill, index) => {
            const description = skill.description.trim()
            return (
              <button
                key={skill.id}
                type="button"
                className={`composer-skill-option${index === activeSkillIndex ? ' active' : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveSkillIndex(index)}
                onClick={() => selectSkill(skill)}
                role="option"
                aria-selected={index === activeSkillIndex}
              >
                <BookOpen size={14} />
                <span className="composer-skill-option-main">
                  <strong>{skill.name}</strong>
                  {description ? <span>{description}</span> : null}
                </span>
                <span className="composer-skill-source">{skill.sourceLabel}</span>
              </button>
            )
          })}
        </div>
      )}
      {selectedSkills.length > 0 && (
        <div className="composer-skill-chips" aria-label="Selected skills">
          {selectedSkills.map((skill) => (
            <div className="composer-chip composer-skill-chip" key={skill.id}>
              <div className="composer-chip-icon skill"><BookOpen size={12} /></div>
              <span className="composer-chip-name" title={`${skill.name} · ${skill.sourceLabel}`}>{skill.name}</span>
              <button type="button" className="composer-chip-remove" onClick={() => onRemoveSkill?.(skill.id)}><X size={12} /></button>
            </div>
          ))}
        </div>
      )}
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
        <textarea
          ref={inputRef}
          className="composer-input"
          value={value}
          rows={1}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
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

function matchesSkillQuery(skill: SkillSummary, query: string): boolean {
  if (!query) return true
  const haystack = [
    skill.name,
    skill.id,
    skill.description,
    skill.sourceLabel
  ].join(' ').toLowerCase()
  return haystack.includes(query)
}
