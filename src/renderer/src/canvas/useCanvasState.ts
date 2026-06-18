import { useState, useCallback, useRef, useEffect } from 'react'
import {
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  addEdge
} from '@xyflow/react'
import type {
  WorkflowTemplate,
  WorkflowStepNode,
  AgentDefinition,
  StepRule
} from '@shared/types'
import { templateToCanvas, canvasToTemplate } from './canvasSerializer'

// ── Types ───────────────────────────────────────────────────────────────────

interface HistoryEntry {
  nodes: Node[]
  edges: Edge[]
}

interface UseCanvasStateParams {
  template: WorkflowTemplate | null
  agents: AgentDefinition[]
}

interface UseCanvasStateReturn {
  nodes: Node[]
  edges: Edge[]
  onNodesChange: OnNodesChange
  onEdgesChange: OnEdgesChange
  onConnect: OnConnect
  selectedNodeId: string | null
  setSelectedNodeId: (id: string | null) => void
  isDirty: boolean
  addAgentNode: (agentId: string, position: { x: number; y: number }) => void
  removeNode: (nodeId: string) => void
  createParallelGroup: (nodeIds: string[]) => void
  getSteps: () => WorkflowStepNode[]
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  updateNodeData: (nodeId: string, data: Partial<Record<string, unknown>>) => void
}

// ── Constants ───────────────────────────────────────────────────────────────

const MAX_HISTORY = 50

function isMutatingNodeChange(change: NodeChange): boolean {
  if (change.type === 'select' || change.type === 'dimensions') return false
  if (change.type === 'position') return change.position != null
  return true
}

function isMutatingEdgeChange(change: EdgeChange): boolean {
  return change.type !== 'select'
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useCanvasState({
  template,
  agents
}: UseCanvasStateParams): UseCanvasStateReturn {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)

  // Undo/redo stacks
  const undoStack = useRef<HistoryEntry[]>([])
  const redoStack = useRef<HistoryEntry[]>([])
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  // Track whether we are currently applying an undo/redo or initializing,
  // to avoid pushing those changes onto the history stack.
  const suppressHistory = useRef(false)

  // Keep a ref to the latest nodes/edges for history snapshot access
  const nodesRef = useRef<Node[]>(nodes)
  const edgesRef = useRef<Edge[]>(edges)
  useEffect(() => {
    nodesRef.current = nodes
    edgesRef.current = edges
  }, [nodes, edges])

  // ── History helpers ──────────────────────────────────────────────────────

  const pushHistory = useCallback(() => {
    if (suppressHistory.current) return
    undoStack.current = [
      ...undoStack.current.slice(-(MAX_HISTORY - 1)),
      { nodes: nodesRef.current, edges: edgesRef.current }
    ]
    redoStack.current = []
    setCanUndo(true)
    setCanRedo(false)
    setIsDirty(true)
  }, [])

  const undo = useCallback(() => {
    if (undoStack.current.length === 0) return
    const prev = undoStack.current[undoStack.current.length - 1]
    undoStack.current = undoStack.current.slice(0, -1)
    redoStack.current = [
      ...redoStack.current,
      { nodes: nodesRef.current, edges: edgesRef.current }
    ]
    suppressHistory.current = true
    setNodes(prev.nodes)
    setEdges(prev.edges)
    suppressHistory.current = false
    setCanUndo(undoStack.current.length > 0)
    setCanRedo(true)
  }, [setNodes, setEdges])

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return
    const next = redoStack.current[redoStack.current.length - 1]
    redoStack.current = redoStack.current.slice(0, -1)
    undoStack.current = [
      ...undoStack.current,
      { nodes: nodesRef.current, edges: edgesRef.current }
    ]
    suppressHistory.current = true
    setNodes(next.nodes)
    setEdges(next.edges)
    suppressHistory.current = false
    setCanUndo(true)
    setCanRedo(redoStack.current.length > 0)
  }, [setNodes, setEdges])

  // ── Initialize from template ────────────────────────────────────────────

  useEffect(() => {
    suppressHistory.current = true
    if (template) {
      const { nodes: initialNodes, edges: initialEdges } = templateToCanvas(
        template.steps,
        agents
      )
      setNodes(initialNodes)
      setEdges(initialEdges)
    } else {
      setNodes([])
      setEdges([])
    }
    // Reset history
    undoStack.current = []
    redoStack.current = []
    setCanUndo(false)
    setCanRedo(false)
    setIsDirty(false)
    suppressHistory.current = false
  }, [template, agents, setNodes, setEdges])

  // ── Wrapped change handlers that track history ──────────────────────────

  const handleNodesChange: OnNodesChange = useCallback(
    (changes) => {
      if (changes.some(isMutatingNodeChange)) pushHistory()
      onNodesChange(changes)
    },
    [onNodesChange, pushHistory]
  )

  const handleEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      if (changes.some(isMutatingEdgeChange)) pushHistory()
      onEdgesChange(changes)
    },
    [onEdgesChange, pushHistory]
  )

  // ── onConnect ───────────────────────────────────────────────────────────

  const onConnect: OnConnect = useCallback(
    (connection) => {
      pushHistory()
      setEdges((eds) => addEdge({
        ...connection,
        type: 'conditional',
        className: 'workflow-canvas-edge'
      }, eds))
    },
    [setEdges, pushHistory]
  )

  // ── addAgentNode ────────────────────────────────────────────────────────

  const addAgentNode = useCallback(
    (agentId: string, position: { x: number; y: number }) => {
      const agent = agents.find((a) => a.id === agentId)
      if (!agent) return

      pushHistory()

      const id = `agent-${agentId}-${Date.now()}`
      setNodes((nds) => {
        const newNode: Node = {
          id,
          type: 'agent',
          position,
          data: {
            agentId: agent.id,
            agentName: agent.name,
            role: agent.role,
            vendor: agent.vendor,
            model: agent.model ?? '',
            index: nds.length
          }
        }
        return [...nds, newNode]
      })
    },
    [agents, setNodes, pushHistory]
  )

  // ── removeNode ──────────────────────────────────────────────────────────

  const removeNode = useCallback(
    (nodeId: string) => {
      pushHistory()
      setNodes((nds) => nds.filter((n) => n.id !== nodeId))
      setEdges((eds) =>
        eds.filter((e) => e.source !== nodeId && e.target !== nodeId)
      )
      if (selectedNodeId === nodeId) {
        setSelectedNodeId(null)
      }
    },
    [setNodes, setEdges, selectedNodeId, pushHistory]
  )

  // ── createParallelGroup ─────────────────────────────────────────────────

  const createParallelGroup = useCallback(
    (nodeIds: string[]) => {
      if (nodeIds.length < 2) return

      pushHistory()

      const selectedSet = new Set(nodeIds)

      // Find common predecessor: a node that has edges leading into at least
      // one of the selected nodes but is NOT itself in the selection.
      const incomingEdges = edgesRef.current.filter(
        (e) => selectedSet.has(e.target) && !selectedSet.has(e.source)
      )
      const predecessors = [...new Set(incomingEdges.map((e) => e.source))]

      // Find common successor: a node that has edges coming from at least one
      // of the selected nodes but is NOT itself in the selection.
      const outgoingEdges = edgesRef.current.filter(
        (e) => selectedSet.has(e.source) && !selectedSet.has(e.target)
      )
      const successors = [...new Set(outgoingEdges.map((e) => e.target))]

      // Remove all edges connecting to/from the selected nodes
      const edgesToRemove = new Set(
        edgesRef.current
          .filter(
            (e) => selectedSet.has(e.source) || selectedSet.has(e.target)
          )
          .map((e) => e.id)
      )

      let newEdges = edgesRef.current.filter((e) => !edgesToRemove.has(e.id))

      // Create fan-out edges: from each predecessor to each selected node
      for (const pred of predecessors) {
        for (const nodeId of nodeIds) {
          newEdges.push({
            id: `e-${pred}-${nodeId}-${Date.now()}`,
            source: pred,
            target: nodeId
          })
        }
      }

      // Create fan-in edges: from each selected node to each successor
      for (const nodeId of nodeIds) {
        for (const succ of successors) {
          newEdges.push({
            id: `e-${nodeId}-${succ}-${Date.now()}`,
            source: nodeId,
            target: succ
          })
        }
      }

      setEdges(newEdges)
    },
    [setEdges, pushHistory]
  )

  // ── getSteps ────────────────────────────────────────────────────────────

  const getSteps = useCallback((): WorkflowStepNode[] => {
    return canvasToTemplate(nodesRef.current, edgesRef.current)
  }, [])

  // ── updateNodeData ──────────────────────────────────────────────────────

  const updateNodeData = useCallback(
    (nodeId: string, data: Partial<Record<string, unknown>>) => {
      pushHistory()
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n
        )
      )
    },
    [setNodes, pushHistory]
  )

  // ── Return ──────────────────────────────────────────────────────────────

  return {
    nodes,
    edges,
    onNodesChange: handleNodesChange,
    onEdgesChange: handleEdgesChange,
    onConnect,
    selectedNodeId,
    setSelectedNodeId,
    isDirty,
    addAgentNode,
    removeNode,
    createParallelGroup,
    getSteps,
    undo,
    redo,
    canUndo,
    canRedo,
    updateNodeData
  }
}
