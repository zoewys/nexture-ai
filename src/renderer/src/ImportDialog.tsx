import { useState, useCallback, useEffect } from 'react'
import { Check, RotateCcw } from 'lucide-react'

interface ImportPreviewItem {
  total: number
  new: number
  existing: number
}

interface ImportPreview {
  agents: ImportPreviewItem
  workflows: ImportPreviewItem
  workflowRuns: ImportPreviewItem
  schedules?: ImportPreviewItem
  settings?: boolean
  memories?: ImportPreviewItem
}

interface ImportDialogProps {
  filePath: string
  preview: ImportPreview
  onImport: (selected: Set<string>) => Promise<void>
  onClose: () => void
}

const ITEMS: { key: string; label: string; desc: string; required: boolean }[] = [
  { key: 'agents', label: 'Agent 定义', desc: '所有自定义的 AI Agent 角色和配置', required: true },
  { key: 'workflows', label: 'Workflow 模板', desc: 'DAG 画布上编排的所有模板', required: true },
  { key: 'workflowRuns', label: 'Workflow 运行历史', desc: '已执行的 workflow 记录，便于复盘', required: true },
  { key: 'schedules', label: '定时任务', desc: '已配置的 workflow 定时调度', required: false },
  { key: 'settings', label: 'App 设置', desc: '界面偏好和功能开关', required: false },
  { key: 'memories', label: '记忆库', desc: 'Agent 学习的历史经验', required: false }
]

export function ImportDialog({ filePath, preview, onImport, onClose }: ImportDialogProps): JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(ITEMS.filter(i => i.required).map(i => i.key))
  )
  const [importing, setImporting] = useState(false)

  const toggle = useCallback((key: string) => {
    if (ITEMS.find(i => i.key === key)?.required) return
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const handleImport = useCallback(async () => {
    setImporting(true)
    try { await onImport(selected) } finally { setImporting(false) }
  }, [selected, onImport])

  const getStat = (key: string): ImportPreviewItem | undefined => {
    return (preview as any)[key] as ImportPreviewItem | undefined
  }

  const fileName = filePath.split('/').pop() || filePath

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>导入数据</h2>
          <p>从导出的 zip 文件中恢复数据</p>
        </div>
        <div className="dialog-body">
          <div className="import-file">{fileName}</div>

          {ITEMS.map(item => {
            const stat = getStat(item.key)
            if (!stat && item.key !== 'settings') return null
            const hasData = item.key === 'settings' ? !!preview.settings : stat && stat.total > 0
            if (!hasData) return null

            const newCount = item.key === 'settings' ? null : stat?.new ?? 0
            const existingCount = item.key === 'settings' ? null : stat?.existing ?? 0
            const totalCount = item.key === 'settings' ? '—' : String(stat?.total ?? 0)

            return (
              <div
                key={item.key}
                className={`data-item${item.required ? ' required' : ''}`}
                onClick={() => toggle(item.key)}
              >
                <div className={`cb${selected.has(item.key) ? ' checked' : ''}${item.required ? ' disabled' : ''}`}>
                  {selected.has(item.key) && <Check size={11} />}
                </div>
                <div className="data-item-info">
                  <div className="data-item-label">{item.label}</div>
                  <div className="data-item-meta">
                    {newCount !== null && existingCount !== null
                      ? `${newCount} 个新 · ${existingCount} 个已存在（将跳过）`
                      : '将替换当前设置'}
                  </div>
                </div>
                <span className="data-item-count">{item.key === 'settings' ? '—' : `${totalCount} 条`}</span>
                {item.required && <span className="required-tag">必选</span>}
              </div>
            )
          })}

          <div className="restart-notice">
            <div className="icon"><RotateCcw size={16} /></div>
            <div className="text"><strong>导入后需要重启应用</strong><br/>完成导入后将自动加载新数据。</div>
          </div>
        </div>
        <div className="dialog-footer">
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={handleImport} disabled={importing}>
            {importing ? '导入中…' : '导入并重启'}
          </button>
        </div>
      </div>
    </div>
  )
}
