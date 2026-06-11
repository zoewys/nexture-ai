import { useState, useCallback } from 'react'

interface DataItem {
  key: string
  label: string
  desc: string
  count: string
  required: boolean
}

interface ExportDialogProps {
  items: DataItem[]
  onExport: (selected: Set<string>) => Promise<void>
  onClose: () => void
}

export function ExportDialog({ items, onExport, onClose }: ExportDialogProps): JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(items.filter(i => i.required).map(i => i.key))
  )
  const [exporting, setExporting] = useState(false)

  const toggle = useCallback((key: string) => {
    const item = items.find(i => i.key === key)
    if (item?.required) return
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [items])

  const handleExport = useCallback(async () => {
    setExporting(true)
    try { await onExport(selected) } finally { setExporting(false) }
  }, [selected, onExport])

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>导出数据</h2>
          <p>选择要包含在 zip 文件中的数据</p>
        </div>
        <div className="dialog-body">
          {items.map(item => (
            <div
              key={item.key}
              className={`data-item${item.required ? ' required' : ''}`}
              onClick={() => toggle(item.key)}
            >
              <div className={`cb${selected.has(item.key) ? ' checked' : ''}${item.required ? ' disabled' : ''}`} />
              <div className="data-item-info">
                <div className="data-item-label">{item.label}</div>
                <div className="data-item-meta">{item.desc}</div>
              </div>
              <span className="data-item-count">{item.count}</span>
              {item.required && <span className="required-tag">必选</span>}
            </div>
          ))}
        </div>
        <div className="dialog-footer">
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={handleExport} disabled={exporting}>
            {exporting ? '导出中…' : '导出 →'}
          </button>
        </div>
      </div>
    </div>
  )
}
