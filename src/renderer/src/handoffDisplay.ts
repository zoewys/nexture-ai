import type { HandoffArtifact, HandoffArtifactItem } from '../../shared/types'

export interface HandoffDisplayArtifactRow {
  type: NonNullable<HandoffArtifactItem['type']>
  path: string
  description: string
}

export interface HandoffDisplayModel {
  summary: {
    label: 'Summary'
    text: string
  }
  artifacts: {
    label: 'Artifacts'
    headers: ['Type', 'Path', 'Description']
    rows: HandoffDisplayArtifactRow[]
    emptyText: 'No artifacts reported.'
  }
  guidance: {
    label: 'Next Step Guidance'
    text: string
  } | null
}

export function formatHandoffDisplay(handoff: HandoffArtifact): HandoffDisplayModel {
  return {
    summary: {
      label: 'Summary',
      text: handoff.summary
    },
    artifacts: {
      label: 'Artifacts',
      headers: ['Type', 'Path', 'Description'],
      rows: handoff.artifacts.map((artifact) => ({
        type: artifact.type ?? 'other',
        path: artifact.path,
        description: artifact.description
      })),
      emptyText: 'No artifacts reported.'
    },
    guidance: handoff.nextStepGuidance
      ? {
          label: 'Next Step Guidance',
          text: handoff.nextStepGuidance
        }
      : null
  }
}
