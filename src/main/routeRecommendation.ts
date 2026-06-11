import type { AgentVendor } from '@shared/types'

export interface VendorModelRecommendation {
  vendor: AgentVendor
  model: string
  reason: string
}

const ROLE_RECOMMENDATIONS: Record<string, VendorModelRecommendation> = {
  product: { vendor: 'claude', model: 'sonnet', reason: '需求理解和文档输出能力强' },
  design: { vendor: 'claude', model: 'sonnet', reason: '创意和结构化输出平衡' },
  dev: { vendor: 'codex', model: '', reason: '代码生成效率高、成本低' },
  test: { vendor: 'claude', model: 'sonnet', reason: '测试用例设计需要推理能力' },
  review: { vendor: 'claude', model: 'opus', reason: '代码审查需要深度推理' },
  docs: { vendor: 'claude', model: 'haiku', reason: '文档生成简单任务用小模型省钱' }
}

export function getRecommendation(role: string): VendorModelRecommendation | null {
  const normalized = role.toLowerCase().trim()
  return ROLE_RECOMMENDATIONS[normalized] ?? null
}
