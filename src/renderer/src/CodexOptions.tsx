/**
 * CodexOptions.tsx — Codex CLI 专属配置子表单
 *
 * 当选择 vendor=codex 时显示，提供：
 *  - Reasoning Effort 选择（low / medium / high / xhigh）
 *  - Service Tier 选择（由 CLI 模型目录动态提供选项）
 */

import type {
  CodexReasoningEffort,
  CodexServiceTierOption,
  VendorModelCatalog
} from '@shared/types'
import { CODEX_REASONING_EFFORTS } from '@shared/types'
import { Select } from './Select'

const DEFAULT_SERVICE_TIERS: CodexServiceTierOption[] = [
  { id: 'priority', label: 'Fast', description: 'Use Codex priority service tier' }
]

export interface CodexOptionsProps {
  model: string
  modelInfo: VendorModelCatalog | null
  reasoningEffort?: CodexReasoningEffort
  serviceTier?: string
  onReasoningEffortChange: (value: CodexReasoningEffort | undefined) => void
  onServiceTierChange: (value: string | undefined) => void
}

export function CodexOptions({
  model,
  modelInfo,
  reasoningEffort,
  serviceTier,
  onReasoningEffortChange,
  onServiceTierChange
}: CodexOptionsProps): JSX.Element {
  const selectedModel = modelInfo?.models.find((option) => option.id === model) ?? null
  const reasoningEfforts =
    selectedModel?.codexReasoningEfforts && selectedModel.codexReasoningEfforts.length > 0
      ? selectedModel.codexReasoningEfforts
      : CODEX_REASONING_EFFORTS
  const serviceTiers = mergeServiceTiers(selectedModel?.codexServiceTiers ?? [])

  return (
    <div className="field-row codex-options">
      <label className="field field-grow">
        <span>Reasoning</span>
        <Select
          value={reasoningEffort ?? ''}
          onChange={(v) => onReasoningEffortChange(v ? (v as CodexReasoningEffort) : undefined)}
          placeholder={`CLI default${selectedModel?.codexDefaultReasoningEffort ? ` (${selectedModel.codexDefaultReasoningEffort})` : ''}`}
        >
          <Select.Item value="">
            CLI default{selectedModel?.codexDefaultReasoningEffort ? ` (${selectedModel.codexDefaultReasoningEffort})` : ''}
          </Select.Item>
          {reasoningEfforts.map((effort) => (
            <Select.Item key={effort} value={effort}>
              {reasoningLabel(effort)}
            </Select.Item>
          ))}
        </Select>
      </label>

      <label className="field field-grow">
        <span>Speed</span>
        <Select
          value={serviceTier ?? ''}
          onChange={(v) => onServiceTierChange(v || undefined)}
          placeholder="CLI default"
        >
          <Select.Item value="">CLI default</Select.Item>
          {serviceTiers.map((tier) => (
            <Select.Item key={tier.id} value={tier.id}>
              {tier.label === tier.id ? tier.id : `${tier.label} (${tier.id})`}
            </Select.Item>
          ))}
        </Select>
      </label>
    </div>
  )
}

function mergeServiceTiers(modelTiers: CodexServiceTierOption[]): CodexServiceTierOption[] {
  const tiers = [...modelTiers]
  for (const fallback of DEFAULT_SERVICE_TIERS) {
    if (!tiers.some((tier) => tier.id === fallback.id)) tiers.push(fallback)
  }
  return tiers
}

function reasoningLabel(effort: CodexReasoningEffort): string {
  switch (effort) {
    case 'low':
      return 'Low'
    case 'medium':
      return 'Medium'
    case 'high':
      return 'High'
    case 'xhigh':
      return 'Extra High'
  }
}
