/**
 * handoffDisplay.ts — HandoffArtifact 数据格式化工具
 *
 * 将 HandoffArtifact 原始数据转换为 HandoffPanel 所需的展示结构：
 * summary / artifacts 表格行 / guidance 文本。纯数据转换，无 UI 依赖。
 */

import type { HandoffArtifact, HandoffArtifactItem } from '../../shared/types'

export interface HandoffDisplayArtifactRow {
  type: NonNullable<HandoffArtifactItem['type']>
  path: string
  description: string
}

export interface HandoffDisplayModel {
  summary: {
    label: '摘要'
    text: string
  }
  artifacts: {
    label: '产物'
    headers: ['类型', '路径', '说明']
    rows: HandoffDisplayArtifactRow[]
    emptyText: '未报告产物。'
  }
  guidance: {
    label: '下一步建议'
    text: string
  } | null
}

export function formatHandoffDisplay(handoff: HandoffArtifact): HandoffDisplayModel {
  return {
    summary: {
      label: '摘要',
      text: handoff.summary
    },
    artifacts: {
      label: '产物',
      headers: ['类型', '路径', '说明'],
      rows: handoff.artifacts.map((artifact) => ({
        type: artifact.type ?? 'other',
        path: artifact.path,
        description: artifact.description
      })),
      emptyText: '未报告产物。'
    },
    guidance: handoff.nextStepGuidance
      ? {
          label: '下一步建议',
          text: handoff.nextStepGuidance
        }
      : null
  }
}
