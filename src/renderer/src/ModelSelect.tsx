/**
 * ModelSelect.tsx — 模型选择下拉框
 *
 * 根据当前 vendor 的模型目录渲染 <select>，支持自由输入模式（当目录为空时）。
 * 显示 loading 状态和 "unavailable" 提示。
 */

import { useState } from 'react'
import type { ModelOption, VendorModelCatalog } from '@shared/types'
import { Select } from './Select'

const CUSTOM_VALUE = '__custom_model__'

export interface ModelSelectProps {
  value: string
  loading?: boolean
  modelInfo: VendorModelCatalog | null
  onChange: (value: string) => void
}

export function ModelSelect({
  value,
  loading = false,
  modelInfo,
  onChange
}: ModelSelectProps): JSX.Element {
  const [customMode, setCustomMode] = useState(false)
  const options = modelInfo?.models ?? []
  const hasMatchingOption = options.some((option) => option.id === value)
  const showCustomInput = customMode || (value.trim() !== '' && !hasMatchingOption)
  const selectValue = showCustomInput ? CUSTOM_VALUE : value

  const handleSelect = (next: string): void => {
    if (next === CUSTOM_VALUE) {
      setCustomMode(true)
      return
    }
    setCustomMode(false)
    onChange(next)
  }

  return (
    <>
      <Select
        value={selectValue}
        disabled={loading}
        onChange={handleSelect}
        placeholder={loading ? 'Loading models...' : 'CLI default'}
      >
        <Select.Item value="">
          {loading ? 'Loading models...' : 'CLI default'}
        </Select.Item>
        {options.map((option) => (
          <Select.Item key={option.id} value={option.id}>
            {formatModelLabel(option)}
          </Select.Item>
        ))}
        <Select.Item value={CUSTOM_VALUE}>Custom model...</Select.Item>
      </Select>

      {showCustomInput && (
        <input
          className="model-custom-input"
          value={value}
          placeholder="Custom model ID"
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {modelInfo?.message && <div className="field-hint">{modelInfo.message}</div>}
    </>
  )
}

function formatModelLabel(option: ModelOption): string {
  return option.label === option.id ? option.id : `${option.label} (${option.id})`
}
