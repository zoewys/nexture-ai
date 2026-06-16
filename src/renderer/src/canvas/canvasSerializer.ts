/**
 * Bidirectional conversion between WorkflowTemplate steps and React Flow
 * canvas data (nodes + edges).
 *
 * `templateToCanvas`  – layout a step array as a visual graph.
 * `canvasToTemplate`  – reconstruct a step array from a user-edited graph.
 */

import type { Node, Edge } from '@xyflow/react'
import type {
  FailureStrategy,
  WorkflowStepNode,
  WorkflowTemplateStep,
  WorkflowParallelGroup,
  StepRule
} from '@shared/types'
import { isParallelGroup } from '@shared/types'

// ---------------------------------------------------------------------------
// Public data shapes
// ---------------------------------------------------------------------------

export interface CanvasData {
  nodes: Node[]
  edges: Edge[]
}

export interface AgentNodeData {
  agentId: string
  agentName: string
  role: string
  vendor: string
  model: string
  rules?: StepRule[]
  interactive?: boolean
  failureStrategy?: FailureStrategy
  [key: string]: unknown
}

interface AgentInfo {
  id: string
  name: string
  vendor: string
  model?: string
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const FIRST_STEP_X = 120
const X_SPACING = 220
const Y_CENTER = 200
const Y_PARALLEL_SPACING = 160
const ROW_SPACING = 190
const MAX_STAGES_PER_ROW = 4

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _edgeCounter = 0
function edgeId(): string {
  return `e-${Date.now()}-${++_edgeCounter}`
}

function findAgent(agents: AgentInfo[], agentId: string): AgentInfo | undefined {
  return agents.find((a) => a.id === agentId)
}

function flowEdge(source: string, target: string, data?: Record<string, unknown>): Edge {
  return {
    id: edgeId(),
    source,
    target,
    type: 'conditional',
    className: 'workflow-canvas-edge',
    data
  }
}

function stagePosition(stageIndex: number): { x: number; y: number } {
  const row = Math.floor(stageIndex / MAX_STAGES_PER_ROW)
  const col = stageIndex % MAX_STAGES_PER_ROW
  return {
    x: FIRST_STEP_X + col * X_SPACING,
    y: Y_CENTER + row * ROW_SPACING
  }
}

// ---------------------------------------------------------------------------
// templateToCanvas
// ---------------------------------------------------------------------------

export function templateToCanvas(
  steps: WorkflowStepNode[],
  agents: AgentInfo[]
): CanvasData {
  const nodes: Node[] = []
  const edges: Edge[] = []

  let stageIndex = 0
  let nodeIndex = 0

  /** Node ids produced by the previous step / group (for edge wiring). */
  let prevNodeIds: string[] = []

  for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
    const step = steps[stepIdx]

    if (isParallelGroup(step)) {
      const group = step as WorkflowParallelGroup
      const members = group.parallel
      const count = members.length
      const groupId = `pg-${stepIdx}`
      const basePosition = stagePosition(stageIndex)

      // Spread N nodes vertically, centred on the current stage row.
      const totalHeight = (count - 1) * Y_PARALLEL_SPACING
      const startY = basePosition.y - totalHeight / 2

      const currentNodeIds: string[] = []

      for (let pi = 0; pi < count; pi++) {
        const member = members[pi]
        const nodeId = `step-${stepIdx}-p${pi}`
        const agent = findAgent(agents, member.agentId)

        const data: AgentNodeData = {
          agentId: member.agentId,
          agentName: agent?.name ?? member.agentId,
          role: member.role ?? '',
          vendor: agent?.vendor ?? '',
          model: agent?.model ?? '',
          rules: member.rules,
          interactive: member.interactive,
          failureStrategy: member.failureStrategy,
          index: nodeIndex++
        }

        nodes.push({
          id: nodeId,
          type: 'agent',
          position: { x: basePosition.x, y: startY + pi * Y_PARALLEL_SPACING },
          data
        })

        currentNodeIds.push(nodeId)
      }

      // Fan-out edges: previous → each parallel node.
      for (const prevId of prevNodeIds) {
        for (const curId of currentNodeIds) {
          edges.push(flowEdge(prevId, curId, { groupId, join: group.join }))
        }
      }

      prevNodeIds = currentNodeIds
    } else {
      // Single step.
      const single = step as WorkflowTemplateStep
      const nodeId = `step-${stepIdx}`
      const agent = findAgent(agents, single.agentId)
      const position = stagePosition(stageIndex)

      const data: AgentNodeData = {
        agentId: single.agentId,
        agentName: agent?.name ?? single.agentId,
        role: single.role ?? '',
        vendor: agent?.vendor ?? '',
        model: agent?.model ?? '',
        rules: single.rules,
        interactive: single.interactive,
        failureStrategy: single.failureStrategy,
        index: nodeIndex++
      }

      nodes.push({
        id: nodeId,
        type: 'agent',
        position,
        data
      })

      // Sequential edges from previous nodes.
      for (const prevId of prevNodeIds) {
        edges.push(flowEdge(prevId, nodeId))
      }

      prevNodeIds = [nodeId]
    }

    stageIndex++
  }

  return { nodes, edges }
}

// ---------------------------------------------------------------------------
// canvasToTemplate
// ---------------------------------------------------------------------------

export function canvasToTemplate(nodes: Node[], edges: Edge[]): WorkflowStepNode[] {
  const workNodes = nodes.filter((node) => node.type === 'agent' || (node.data as Partial<AgentNodeData>)?.agentId)
  const workNodeIds = new Set(workNodes.map((node) => node.id))
  const workEdges = edges.filter((edge) => workNodeIds.has(edge.source) && workNodeIds.has(edge.target))

  if (workNodes.length === 0) return []

  // 1. Build adjacency maps.
  const successors = new Map<string, string[]>()
  const predecessors = new Map<string, string[]>()

  for (const n of workNodes) {
    successors.set(n.id, [])
    predecessors.set(n.id, [])
  }

  for (const e of workEdges) {
    successors.get(e.source)?.push(e.target)
    predecessors.get(e.target)?.push(e.source)
  }

  // 2. Topological sort (Kahn's algorithm).
  const inDegree = new Map<string, number>()
  for (const n of workNodes) {
    inDegree.set(n.id, (predecessors.get(n.id) ?? []).length)
  }

  const queue: string[] = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }

  const sorted: string[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    sorted.push(id)
    for (const succ of successors.get(id) ?? []) {
      const newDeg = (inDegree.get(succ) ?? 1) - 1
      inDegree.set(succ, newDeg)
      if (newDeg === 0) queue.push(succ)
    }
  }

  // 3. Detect parallel groups.
  //    Nodes that share the exact same predecessor set AND the exact same
  //    successor set, with 2+ members, form a parallel group.
  const predKey = (id: string): string => {
    const preds = [...(predecessors.get(id) ?? [])].sort()
    return preds.join(',')
  }

  const succKey = (id: string): string => {
    const succs = [...(successors.get(id) ?? [])].sort()
    return succs.join(',')
  }

  const signatureMap = new Map<string, string[]>()
  for (const id of sorted) {
    const sig = `${predKey(id)}|${succKey(id)}`
    if (!signatureMap.has(sig)) signatureMap.set(sig, [])
    signatureMap.get(sig)!.push(id)
  }

  // Collect groups with 2+ members into a Set of node ids for fast lookup.
  const parallelGroups: string[][] = []
  const groupedNodeIds = new Set<string>()

  for (const members of signatureMap.values()) {
    if (members.length >= 2) {
      parallelGroups.push(members)
      for (const id of members) groupedNodeIds.add(id)
    }
  }

  // Map node id → group index.
  const nodeToGroup = new Map<string, number>()
  for (let gi = 0; gi < parallelGroups.length; gi++) {
    for (const id of parallelGroups[gi]) {
      nodeToGroup.set(id, gi)
    }
  }

  // 4. Build ordered WorkflowStepNode[].
  const nodeMap = new Map<string, Node>(workNodes.map((n) => [n.id, n]))
  const emittedGroups = new Set<number>()
  const result: WorkflowStepNode[] = []

  for (const id of sorted) {
    if (groupedNodeIds.has(id)) {
      const gi = nodeToGroup.get(id)!
      if (emittedGroups.has(gi)) continue
      emittedGroups.add(gi)

      // Determine `join` from edge data if present, default to true.
      let join = true
      for (const e of workEdges) {
        if (parallelGroups[gi].includes(e.source) || parallelGroups[gi].includes(e.target)) {
          if (e.data && typeof e.data === 'object' && 'join' in e.data) {
            join = Boolean(e.data.join)
            break
          }
        }
      }

      const parallel: WorkflowTemplateStep[] = parallelGroups[gi].map((nodeId) => {
        const node = nodeMap.get(nodeId)!
        return nodeToStep(node)
      })

      const group: WorkflowParallelGroup = { parallel, join }
      result.push(group)
    } else {
      const node = nodeMap.get(id)!
      result.push(nodeToStep(node))
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Internal: extract a WorkflowTemplateStep from a canvas node.
// ---------------------------------------------------------------------------

function nodeToStep(node: Node): WorkflowTemplateStep {
  const d = node.data as Partial<AgentNodeData> | undefined
  const step: WorkflowTemplateStep = {
    agentId: d?.agentId ?? node.id
  }
  if (d?.role) step.role = d.role
  if (d?.rules && d.rules.length > 0) step.rules = d.rules
  if (d?.interactive) step.interactive = true
  if (d?.failureStrategy) step.failureStrategy = d.failureStrategy
  return step
}
