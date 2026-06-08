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
        <select
          value={reasoningEffort ?? ''}
          onChange={(e) => {
            const value = e.target.value
            onReasoningEffortChange(value ? (value as CodexReasoningEffort) : undefined)
          }}
        >
          <option value="">
            CLI default{selectedModel?.codexDefaultReasoningEffort ? ` (${selectedModel.codexDefaultReasoningEffort})` : ''}
          </option>
          {reasoningEfforts.map((effort) => (
            <option key={effort} value={effort}>
              {reasoningLabel(effort)}
            </option>
          ))}
        </select>
      </label>

      <label className="field field-grow">
        <span>Speed</span>
        <select
          value={serviceTier ?? ''}
          onChange={(e) => onServiceTierChange(e.target.value || undefined)}
        >
          <option value="">CLI default</option>
          {serviceTiers.map((tier) => (
            <option key={tier.id} value={tier.id}>
              {tier.label === tier.id ? tier.id : `${tier.label} (${tier.id})`}
            </option>
          ))}
        </select>
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
