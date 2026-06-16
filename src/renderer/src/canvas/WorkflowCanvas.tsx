import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  Panel,
  useReactFlow,
  ReactFlowProvider,
  type Node
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Undo2,
  Redo2,
  Maximize2,
  ZoomIn,
  ZoomOut,
  ChevronsLeft,
  ChevronsRight,
  Bot,
  Code2,
  Cpu,
  FileText,
  Sparkles,
  GitFork,
  Info,
  Shield
} from 'lucide-react'

import type { AgentDefinition, FailureStrategy, WorkflowTemplate, StepRule } from '@shared/types'
import { AgentNode, type AgentNodeData } from './AgentNode'
import { ConditionalEdge } from './ConditionalEdge'
import { useCanvasState } from './useCanvasState'

// ── Theme tokens ──────────────────────────────────────────────────────────────

const colors = {
  bg: '#edeae3',
  bgPanel: 'rgba(255, 253, 248, 0.72)',
  border: 'rgba(120, 140, 130, 0.18)',
  accent: '#3d8e86',
  text: '#1e2e28',
  textMuted: '#5d746c',
  textDim: '#8aa099',
  hover: 'rgba(61, 142, 134, 0.06)'
}

// ── Vendor helpers ────────────────────────────────────────────────────────────

const vendorMeta: Record<string, { icon: typeof Bot; color: string }> = {
  claude: { icon: Bot, color: '#6c8cff' },
  codex: { icon: Code2, color: '#4caf7d' }
}

function VendorIcon({ vendor, size = 13 }: { vendor: string; size?: number }) {
  const meta = vendorMeta[vendor] ?? { icon: Bot, color: '#9aa3b5' }
  const Icon = meta.icon
  return <Icon size={size} color={meta.color} />
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface WorkflowCanvasProps {
  agents: AgentDefinition[]
  template: WorkflowTemplate | null
  onMarkDirty: () => void
  onStepsChange?: (steps: import('@shared/types').WorkflowStepNode[]) => void
  onSave?: (steps: import('@shared/types').WorkflowStepNode[]) => void
}

interface ContextMenuState {
  x: number
  y: number
  clientX: number
  clientY: number
  type: 'canvas' | 'selection'
}

// ── Node/Edge type maps ───────────────────────────────────────────────────────

const nodeTypes = { agent: AgentNode }
const edgeTypes = { conditional: ConditionalEdge }

// ── Inner Canvas (needs ReactFlowProvider ancestor) ───────────────────────────

function CanvasInner({ agents, template, onMarkDirty, onStepsChange, onSave }: WorkflowCanvasProps) {
  const reactFlowInstance = useReactFlow()

  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
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
  } = useCanvasState({ template, agents })

  // Track dirty state for parent
  const prevDirty = useRef(isDirty)
  useEffect(() => {
    if (isDirty && !prevDirty.current) onMarkDirty()
    prevDirty.current = isDirty
  }, [isDirty, onMarkDirty])

  // ── Right panel state ───────────────────────────────────────────────────────
  const [rightPanelOpen, setRightPanelOpen] = useState(false)
  const [rightPanelMode, setRightPanelMode] = useState<'properties' | 'agent-detail'>('properties')
  const [detailAgentId, setDetailAgentId] = useState<string | null>(null)

  const detailAgent = useMemo(
    () => agents.find((agent) => agent.id === detailAgentId) ?? null,
    [agents, detailAgentId]
  )

  const openAgentDetail = useCallback((agentId: string) => {
    setDetailAgentId(agentId)
    setRightPanelMode('agent-detail')
    setRightPanelOpen(true)
  }, [])

  // Auto-open when node selected, but allow manual close
  const prevSelectedRef = useRef(selectedNodeId)
  useEffect(() => {
    if (selectedNodeId && selectedNodeId !== prevSelectedRef.current) {
      setRightPanelOpen(true)
      setRightPanelMode('properties')
    }
    prevSelectedRef.current = selectedNodeId
  }, [selectedNodeId])
  const [sidebarExpanded, setSidebarExpanded] = useState(true)

  // ── Context menu ────────────────────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  useEffect(() => {
    if (!contextMenu) return
    const handler = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as HTMLElement)) {
        closeContextMenu()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [contextMenu, closeContextMenu])

  const onPaneContextMenu = useCallback(
    (event: MouseEvent | React.MouseEvent) => {
      event.preventDefault()
      const selectedNodes = nodes.filter((n) => n.selected)
      const stageRect = canvasRef.current?.getBoundingClientRect()
      const x = stageRect ? event.clientX - stageRect.left : event.clientX
      const y = stageRect ? event.clientY - stageRect.top : event.clientY
      if (selectedNodes.length >= 2) {
        setContextMenu({ x, y, clientX: event.clientX, clientY: event.clientY, type: 'selection' })
      } else {
        setContextMenu({ x, y, clientX: event.clientX, clientY: event.clientY, type: 'canvas' })
      }
    },
    [nodes]
  )

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  const getStepsRef = useRef(getSteps)
  getStepsRef.current = getSteps
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave
  const onStepsChangeRef = useRef(onStepsChange)
  onStepsChangeRef.current = onStepsChange

  useEffect(() => {
    onStepsChangeRef.current?.(getSteps())
  }, [nodes, edges, getSteps])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey

      if (meta && e.key === 's') {
        e.preventDefault()
        onSaveRef.current?.(getStepsRef.current())
      } else if (meta && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if (meta && e.key === 'z' && e.shiftKey) {
        e.preventDefault()
        redo()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeId) {
        const tag = (e.target as HTMLElement).tagName
        if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
          e.preventDefault()
          removeNode(selectedNodeId)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [undo, redo, removeNode, selectedNodeId])

  // ── Drag-and-drop from sidebar ──────────────────────────────────────────────
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const agentId = e.dataTransfer.getData('application/agent-id')
      if (!agentId) return

      const position = reactFlowInstance.screenToFlowPosition({
        x: e.clientX,
        y: e.clientY
      })
      // Snap to grid
      position.x = Math.round(position.x / 20) * 20
      position.y = Math.round(position.y / 20) * 20

      addAgentNode(agentId, position)
    },
    [reactFlowInstance, addAgentNode]
  )

  // ── Node selection sync ─────────────────────────────────────────────────────
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      setSelectedNodeId(node.id)
    },
    [setSelectedNodeId]
  )

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null)
    closeContextMenu()
  }, [setSelectedNodeId, closeContextMenu])

  // Ctrl+scroll to zoom
  const canvasRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        if (e.deltaY < 0) reactFlowInstance.zoomIn({ duration: 100 })
        else reactFlowInstance.zoomOut({ duration: 100 })
      }
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [reactFlowInstance])

  // ── Selected node data for property panel ───────────────────────────────────
  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  )

  // ── Toolbar actions ─────────────────────────────────────────────────────────
  const fitView = useCallback(() => reactFlowInstance.fitView({ padding: 0.2 }), [reactFlowInstance])
  const zoomIn = useCallback(() => reactFlowInstance.zoomIn(), [reactFlowInstance])
  const zoomOut = useCallback(() => reactFlowInstance.zoomOut(), [reactFlowInstance])

  useEffect(() => {
    if (nodes.length === 0) return
    const frame = window.requestAnimationFrame(() => {
      reactFlowInstance.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [nodes.length, reactFlowInstance])

  // ── Render ──────────────────────────────────────────────────────────────────
  const sidebarWidth = sidebarExpanded ? 220 : 40

  return (
    <div className="workflow-canvas-shell" data-edge-count={edges.length}>
      {/* ── Agent Sidebar ─────────────────────────────────────────────────── */}
      <div
        className={`workflow-canvas-agent-rail${sidebarExpanded ? ' expanded' : ''}`}
        style={{
          width: sidebarWidth,
          flexShrink: 0,
          background: colors.bgPanel,
          borderRight: `1px solid ${colors.border}`,
          display: 'flex',
          flexDirection: 'column',
          transition: 'width 0.15s ease',
          overflow: 'hidden'
        }}
      >
        {/* Header */}
        <div
          className="workflow-canvas-agent-rail-head"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: sidebarExpanded ? 'space-between' : 'center',
            padding: sidebarExpanded ? '8px 10px' : '8px 0',
            borderBottom: `1px solid ${colors.border}`,
            minHeight: 36
          }}
        >
          {sidebarExpanded && (
            <span className="workflow-canvas-agent-rail-title">Agents</span>
          )}
          <button
            className="workflow-canvas-icon-btn"
            onClick={() => setSidebarExpanded((v) => !v)}
            style={{
              background: 'transparent',
              border: 'none',
              color: colors.textMuted,
              cursor: 'pointer',
              padding: 4,
              display: 'flex',
              alignItems: 'center'
            }}
            title={sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            {sidebarExpanded ? <ChevronsLeft size={14} /> : <ChevronsRight size={14} />}
          </button>
        </div>

        {/* Agent list */}
        <div className="workflow-canvas-agent-list" style={{ alignItems: sidebarExpanded ? 'stretch' : 'center' }}>
          {agents.map((agent) => (
            <div
              key={agent.id}
              className="workflow-canvas-agent-palette-item"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/agent-id', agent.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              style={{
                display: 'grid',
                gridTemplateColumns: sidebarExpanded ? '24px minmax(0, 1fr) 26px' : '24px',
                alignItems: 'center',
                gap: 8,
                padding: sidebarExpanded ? '6px 10px' : '6px 0',
                cursor: 'grab',
                borderRadius: 6,
                margin: sidebarExpanded ? '2px 4px' : '2px 0',
                transition: 'background 0.1s',
                justifyContent: sidebarExpanded ? 'flex-start' : 'center'
              }}
              title={agent.name}
            >
              <div
                className="workflow-canvas-agent-palette-icon"
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 5,
                  background: (vendorMeta[agent.vendor]?.color ?? '#9aa3b5') + '22',
                  border: `1px solid ${(vendorMeta[agent.vendor]?.color ?? '#9aa3b5')}55`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}
              >
                <VendorIcon vendor={agent.vendor} size={13} />
              </div>
              {sidebarExpanded && (
                <span
                  style={{
                    fontSize: 11,
                    color: colors.text,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}
                >
                  {agent.name}
                </span>
              )}
              {sidebarExpanded && (
                <button
                  type="button"
                  draggable={false}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    openAgentDetail(agent.id)
                  }}
                  title={`View ${agent.name} details`}
                  aria-label={`View ${agent.name} details`}
                  style={{
                    width: 26,
                    height: 26,
                    minHeight: 26,
                    padding: 0,
                    borderRadius: 6,
                    border: `1px solid ${colors.border}`,
                    background: 'rgba(255,255,255,0.03)',
                    color: colors.textMuted,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer'
                  }}
                >
                  <Info size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Canvas area ───────────────────────────────────────────────────── */}
      <div ref={canvasRef} className="workflow-canvas-stage">
        <ReactFlow
          className="workflow-canvas-flow"
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          onPaneContextMenu={onPaneContextMenu}
          onDragOver={onDragOver}
          onDrop={onDrop}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          snapToGrid
          snapGrid={[20, 20]}
          panOnDrag
          panActivationKeyCode="Meta"
          selectionOnDrag
          selectionKeyCode={null}
          zoomOnScroll={false}
          zoomOnPinch
          zoomOnDoubleClick={false}
          preventScrolling={false}
          proOptions={{ hideAttribution: true }}
          style={{ background: colors.bg }}
        >
          <Background variant={BackgroundVariant.Dots} color={colors.border} gap={20} size={1} />

          {/* ── Floating Toolbar ──────────────────────────────────────────── */}
          <Panel position="top-center">
            <div
              className="workflow-canvas-mini-toolbar"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                background: colors.bgPanel,
                border: `1px solid ${colors.border}`,
                borderRadius: 8,
                padding: '4px 6px',
                boxShadow: '0 2px 12px rgba(0,0,0,0.3)'
              }}
            >
              <ToolbarButton onClick={undo} disabled={!canUndo} title="Undo (Cmd+Z)">
                <Undo2 size={14} />
              </ToolbarButton>
              <ToolbarButton onClick={redo} disabled={!canRedo} title="Redo (Cmd+Shift+Z)">
                <Redo2 size={14} />
              </ToolbarButton>
              <ToolbarButton onClick={fitView} title="Fit view">
                <Maximize2 size={14} />
              </ToolbarButton>
              <div style={{ width: 1, height: 18, background: colors.border, margin: '0 4px' }} />
              <ToolbarButton onClick={zoomIn} title="Zoom in">
                <ZoomIn size={14} />
              </ToolbarButton>
              <ToolbarButton onClick={zoomOut} title="Zoom out">
                <ZoomOut size={14} />
              </ToolbarButton>
            </div>
          </Panel>

          {/* ── MiniMap ───────────────────────────────────────────────────── */}
          <MiniMap
            className="workflow-canvas-minimap"
            position="bottom-right"
            style={{ background: colors.bgPanel, border: `1px solid ${colors.border}` }}
            nodeColor={() => colors.accent}
            maskColor="rgba(237, 234, 227, 0.72)"
          />

          <Controls
            showInteractive={false}
            style={{ display: 'none' }}
          />
        </ReactFlow>

        {/* ── Context Menu ─────────────────────────────────────────────────── */}
        {contextMenu && (
          <div
            ref={contextMenuRef}
            className="workflow-canvas-context-menu"
            style={{
              position: 'absolute',
              top: contextMenu.y,
              left: contextMenu.x,
              zIndex: 1000,
              background: colors.bgPanel,
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              padding: '4px 0',
              minWidth: 160,
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)'
            }}
          >
            {contextMenu.type === 'canvas' && (
              <>
                <div
                  style={{
                    padding: '6px 12px',
                    fontSize: 10,
                    color: colors.textDim,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5
                  }}
                >
                  Add Agent
                </div>
                {agents.map((agent) => (
                  <button
                    key={agent.id}
                    className="workflow-canvas-context-item"
                    onClick={() => {
                      const position = reactFlowInstance.screenToFlowPosition({
                        x: contextMenu.clientX,
                        y: contextMenu.clientY
                      })
                      position.x = Math.round(position.x / 20) * 20
                      position.y = Math.round(position.y / 20) * 20
                      addAgentNode(agent.id, position)
                      closeContextMenu()
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      textAlign: 'left',
                      padding: '6px 12px',
                      background: 'transparent',
                      border: 'none',
                      color: colors.text,
                      fontSize: 12,
                      cursor: 'pointer'
                    }}
                  >
                    <VendorIcon vendor={agent.vendor} size={12} />
                    {agent.name}
                  </button>
                ))}
              </>
            )}
            {contextMenu.type === 'selection' && (
              <button
                className="workflow-canvas-context-item"
                onClick={() => {
                  const selected = nodes.filter((n) => n.selected).map((n) => n.id)
                  if (selected.length >= 2) createParallelGroup(selected)
                  closeContextMenu()
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 12px',
                  background: 'transparent',
                  border: 'none',
                  color: colors.text,
                  fontSize: 12,
                  cursor: 'pointer'
                }}
              >
                <GitFork size={12} />
                Create Parallel Group
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Right Property Panel (collapsible) ──────────────────────────── */}
      {rightPanelOpen ? (
        <div
          className="workflow-canvas-inspector"
          style={{
            width: 240,
            flexShrink: 0,
            background: colors.bgPanel,
            borderLeft: `1px solid ${colors.border}`,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}
        >
          <div className="workflow-canvas-inspector-head" style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            borderBottom: `1px solid ${colors.border}`
          }}>
            <span style={{ fontSize: 11, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {rightPanelMode === 'agent-detail' ? 'Agent Details' : selectedNode ? 'Properties' : 'Template'}
            </span>
            <button
              className="workflow-canvas-icon-btn"
              onClick={() => setRightPanelOpen(false)}
              style={{ background: 'none', border: 'none', color: colors.textMuted, cursor: 'pointer', padding: 2, display: 'flex' }}
              title="Close panel"
            >
              <ChevronsLeft size={14} />
            </button>
          </div>
          <div className="workflow-canvas-inspector-body" style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {rightPanelMode === 'agent-detail' ? (
              <AgentDetailPanel
                agent={detailAgent}
                selectedNode={selectedNode}
                onAssignToSelected={(agent) => {
                  if (!selectedNode) return
                  updateNodeData(selectedNode.id, {
                    agentId: agent.id,
                    agentName: agent.name,
                    vendor: agent.vendor,
                    model: agent.model ?? '',
                    role: agent.role
                  })
                  setRightPanelMode('properties')
                }}
              />
            ) : selectedNode ? (
              <NodePropertyPanel
                node={selectedNode}
                agents={agents}
                allNodes={nodes}
                updateNodeData={updateNodeData}
                onOpenAgentDetail={openAgentDetail}
              />
            ) : (
              <TemplatePropertyPanel template={template} />
            )}
          </div>
        </div>
      ) : (
        <div className="workflow-canvas-inspector-toggle" style={{
          width: 36,
          flexShrink: 0,
          background: colors.bgPanel,
          borderLeft: `1px solid ${colors.border}`,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          paddingTop: 8
        }}>
          <button
            className="workflow-canvas-icon-btn"
            onClick={() => setRightPanelOpen(true)}
            style={{ background: 'none', border: 'none', color: colors.textMuted, cursor: 'pointer', padding: 4, display: 'flex' }}
            title="Open properties panel"
          >
            <ChevronsRight size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

// ── Node Property Panel ───────────────────────────────────────────────────────

function NodePropertyPanel({
  node,
  agents,
  allNodes,
  updateNodeData,
  onOpenAgentDetail
}: {
  node: Node
  agents: AgentDefinition[]
  allNodes: Node[]
  updateNodeData: (nodeId: string, data: Partial<Record<string, unknown>>) => void
  onOpenAgentDetail: (agentId: string) => void
}) {
  const data = node.data as AgentNodeData
  const currentAgent = agents.find((agent) => agent.id === data.agentId) ?? null
  const rules: StepRule[] = (data as unknown as { rules?: StepRule[] }).rules ?? []
  const failureStrategy =
    (data as unknown as { failureStrategy?: FailureStrategy }).failureStrategy ?? { type: 'stop' as const }
  const failureStrategyType = failureStrategy.type
  const failureStrategyMaxRetries = failureStrategy.maxRetries ?? 3
  const defaultGotoTarget = allNodes.findIndex((n) => n.id !== node.id)

  const getRule = (trigger: StepRule['on']): StepRule | undefined =>
    rules.find((r) => r.on === trigger)

  const setRuleForTrigger = (trigger: StepRule['on'], action: string, patch?: Partial<StepRule>) => {
    if (action === 'stop') {
      updateNodeData(node.id, { rules: rules.filter((r) => r.on !== trigger) })
      return
    }
    const existing = rules.find((r) => r.on === trigger)
    if (existing) {
      updateNodeData(node.id, {
        rules: rules.map((r) => r.on === trigger ? { ...r, action: action as StepRule['action'], ...patch } : r)
      })
    } else {
      updateNodeData(node.id, {
        rules: [...rules, { on: trigger, action: action as StepRule['action'], ...patch }]
      })
    }
  }

  const selectStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    padding: '6px 10px',
    borderRadius: 6,
    border: `1px solid ${colors.border}`,
    background: colors.bg,
    color: colors.text,
    fontSize: 12,
    fontFamily: 'inherit',
    appearance: 'auto' as const,
    cursor: 'pointer',
    outline: 'none',
    paddingRight: 8
  }

  const numStyle: React.CSSProperties = {
    width: 48,
    padding: '5px 8px',
    borderRadius: 5,
    border: `1px solid ${colors.border}`,
    background: colors.bg,
    color: colors.text,
    fontSize: 12,
    fontFamily: 'inherit',
    textAlign: 'center',
    outline: 'none'
  }

  const hintStyle: React.CSSProperties = {
    fontSize: 10,
    color: colors.textDim,
    lineHeight: 1.4,
    marginTop: 4
  }

  const errorRule = getRule('error')
  const handoffRule = getRule('handoff-failed')
  const errorAction = errorRule?.action ?? 'stop'
  const handoffAction = handoffRule?.action ?? 'stop'
  const setFailureStrategy = (next: FailureStrategy | undefined) => {
    updateNodeData(node.id, { failureStrategy: next })
  }
  const setFailureStrategyType = (type: FailureStrategy['type']) => {
    if (type === 'stop') {
      setFailureStrategy(undefined)
      return
    }
    setFailureStrategy({
      type,
      maxRetries: failureStrategyMaxRetries,
      ...(type === 'retry-then-goto' ? { gotoTarget: failureStrategy.gotoTarget ?? Math.max(0, defaultGotoTarget) } : {})
    })
  }
  const updateFailureStrategyPatch = (patch: Partial<FailureStrategy>) => {
    const type = failureStrategyType === 'stop' ? 'retry-then-notify' : failureStrategyType
    setFailureStrategy({
      type,
      maxRetries: failureStrategyMaxRetries,
      ...(type === 'retry-then-goto' ? { gotoTarget: failureStrategy.gotoTarget ?? Math.max(0, defaultGotoTarget) } : {}),
      ...patch
    })
  }

  return (
    <>
      {/* Agent name */}
      <div style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>{data.agentName}</div>

      {/* Agent select */}
      <label style={{ fontSize: 11, color: colors.textMuted }}>
        Agent
        <select
          value={data.agentId}
          onChange={(e) => {
            const agent = agents.find((a) => a.id === e.target.value)
            if (agent) {
              updateNodeData(node.id, {
                agentId: agent.id,
                agentName: agent.name,
                vendor: agent.vendor,
                model: agent.model ?? '',
                role: agent.role
              })
            }
          }}
          style={{ ...selectStyle, marginTop: 4 }}
        >
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </label>

      {currentAgent && (
        <button
          type="button"
          onClick={() => onOpenAgentDetail(currentAgent.id)}
          style={{
            width: '100%',
            padding: '7px 9px',
            borderRadius: 6,
            border: `1px solid ${colors.border}`,
            background: colors.bg,
            color: colors.textMuted,
            fontSize: 11,
            cursor: 'pointer',
            display: 'grid',
            gridTemplateColumns: '18px minmax(0, 1fr) auto',
            alignItems: 'center',
            gap: 7,
            textAlign: 'left'
          }}
        >
          <Info size={14} />
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {currentAgent.vendor} · {currentAgent.model || 'default model'}
          </span>
          <span style={{ color: colors.accent, fontWeight: 650 }}>Details</span>
        </button>
      )}

      {/* Role input */}
      <label style={{ fontSize: 11, color: colors.textMuted }}>
        Role
        <input
          type="text"
          value={data.role}
          onChange={(e) => updateNodeData(node.id, { role: e.target.value })}
          style={{
            display: 'block',
            width: '100%',
            marginTop: 4,
            padding: '6px 8px',
            background: colors.bg,
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            color: colors.text,
            fontSize: 12,
            outline: 'none'
          }}
        />
      </label>

      <div style={{ height: 1, background: colors.border, margin: '4px 0' }} />

      {/* Error handling — simplified */}
      <div>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.textDim, marginBottom: 8, fontWeight: 600 }}>
          出错处理
        </div>
        <select
          value={errorAction}
          onChange={(e) => setRuleForTrigger('error', e.target.value, e.target.value === 'retry' ? { maxRetries: 2 } : undefined)}
          style={selectStyle}
        >
          <option value="stop">停止运行</option>
          <option value="retry">自动重试</option>
          <option value="skip">跳过继续</option>
          <option value="goto">跳转到指定步骤</option>
        </select>

        {errorAction === 'retry' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, padding: '6px 10px', background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 6 }}>
            <span style={{ fontSize: 11, color: colors.textDim }}>最多重试</span>
            <input
              type="number"
              min={1}
              max={5}
              value={errorRule?.maxRetries ?? 2}
              onChange={(e) => setRuleForTrigger('error', 'retry', { maxRetries: Number(e.target.value) })}
              style={numStyle}
            />
            <span style={{ fontSize: 11, color: colors.textDim }}>次</span>
          </div>
        )}

        {errorAction === 'goto' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, padding: '6px 10px', background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 6 }}>
            <span style={{ fontSize: 11, color: colors.textDim, whiteSpace: 'nowrap' }}>跳转到</span>
            <select
              value={errorRule?.target ?? 0}
              onChange={(e) => setRuleForTrigger('error', 'goto', { target: Number(e.target.value) })}
              style={{ ...selectStyle, marginTop: 0, flex: 1 }}
            >
              {allNodes.map((n, i) => {
                if (n.id === node.id) return null
                const nd = n.data as AgentNodeData
                return <option key={n.id} value={i}>#{i + 1} {nd.agentName || 'Step'}{nd.role ? ` (${nd.role})` : ''}</option>
              })}
            </select>
          </div>
        )}

        <div style={hintStyle}>
          {errorAction === 'stop' && '出错时整个工作流停止，等待人工处理。'}
          {errorAction === 'retry' && '出错后自动重新执行当前步骤。'}
          {errorAction === 'skip' && '出错时跳过下一步继续执行。'}
          {errorAction === 'goto' && '出错时自动跳转到指定步骤。'}
        </div>
      </div>

      {/* Handoff parse failure */}
      <div>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.textDim, marginBottom: 8, fontWeight: 600 }}>
          Handoff 解析失败
        </div>
        <select
          value={handoffAction}
          onChange={(e) => setRuleForTrigger('handoff-failed', e.target.value, e.target.value === 'retry' ? { maxRetries: 1 } : undefined)}
          style={selectStyle}
        >
          <option value="stop">停止运行</option>
          <option value="retry">自动重试</option>
          <option value="skip">跳过继续</option>
        </select>

        {handoffAction === 'retry' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, padding: '6px 10px', background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 6 }}>
            <span style={{ fontSize: 11, color: colors.textDim }}>最多重试</span>
            <input
              type="number"
              min={1}
              max={5}
              value={handoffRule?.maxRetries ?? 1}
              onChange={(e) => setRuleForTrigger('handoff-failed', 'retry', { maxRetries: Number(e.target.value) })}
              style={numStyle}
            />
            <span style={{ fontSize: 11, color: colors.textDim }}>次</span>
          </div>
        )}

        <div style={hintStyle}>
          {handoffAction === 'stop' && 'Agent 输出格式不对时停止运行。'}
          {handoffAction === 'retry' && 'Agent 输出格式不对时自动重试。'}
          {handoffAction === 'skip' && 'Agent 输出格式不对时跳过继续。'}
        </div>
      </div>

      <div style={{ height: 1, background: colors.border, margin: '4px 0' }} />

      {/* Interactive mode */}
      <div>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.textDim, marginBottom: 8, fontWeight: 600 }}>
          交互模式
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 12, color: colors.text }}>允许步骤内对话</span>
          <button
            type="button"
            className={`settings-switch${data.interactive ? ' on' : ''}`}
            style={{ minHeight: 'auto', flexShrink: 0 }}
            title="允许步骤内对话"
            aria-label="允许步骤内对话"
            onClick={() => updateNodeData(node.id, { interactive: !data.interactive })}
          />
        </div>
        <div style={hintStyle}>开启后，Agent 未输出 handoff 时步骤暂停等待用户回复。</div>
      </div>

      <div style={{ height: 1, background: colors.border, margin: '4px 0' }} />

      {/* Failure strategy */}
      <div>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.textDim, marginBottom: 8, fontWeight: 600 }}>
          失败策略
        </div>
        <select
          value={failureStrategyType}
          onChange={(e) => setFailureStrategyType(e.target.value as FailureStrategy['type'])}
          style={selectStyle}
        >
          <option value="stop">停止</option>
          <option value="retry-then-notify">重试后通知</option>
          <option value="retry-then-goto">重试后跳转</option>
        </select>

        {failureStrategyType !== 'stop' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, padding: '6px 10px', background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 6 }}>
            <span style={{ fontSize: 11, color: colors.textDim }}>最大重试次数</span>
            <input
              type="number"
              min={1}
              max={10}
              value={failureStrategyMaxRetries}
              onChange={(e) => updateFailureStrategyPatch({ maxRetries: Math.min(10, Math.max(1, Number(e.target.value) || 1)) })}
              style={{ ...numStyle, width: 56 }}
            />
          </div>
        )}

        {failureStrategyType === 'retry-then-goto' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, padding: '6px 10px', background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 6 }}>
            <span style={{ fontSize: 11, color: colors.textDim, whiteSpace: 'nowrap' }}>跳转目标</span>
            <select
              value={failureStrategy.gotoTarget ?? Math.max(0, defaultGotoTarget)}
              onChange={(e) => updateFailureStrategyPatch({ gotoTarget: Number(e.target.value) })}
              style={{ ...selectStyle, marginTop: 0, flex: 1 }}
            >
              {allNodes.map((n, i) => {
                if (n.id === node.id) return null
                const nd = n.data as AgentNodeData
                return <option key={n.id} value={i}>#{i + 1} {nd.agentName || 'Step'}{nd.role ? ` (${nd.role})` : ''}</option>
              })}
            </select>
          </div>
        )}

        <div style={hintStyle}>StepRule 优先于此配置；失败策略作为兜底处理。</div>
      </div>

      {/* Recommend button */}
      <button
        onClick={async () => {
          const result = await window.api.routeRecommend(data.role)
          if (!result) return
          const match = agents.find((a) => a.vendor === result.vendor && (!result.model || a.model?.includes(result.model)))
          if (match) {
            updateNodeData(node.id, {
              agentId: match.id,
              agentName: match.name,
              vendor: match.vendor,
              model: match.model ?? ''
            })
          }
        }}
        style={{
          marginTop: 8,
          padding: '6px 12px',
          background: colors.accent + '22',
          border: `1px solid ${colors.accent}55`,
          borderRadius: 6,
          color: colors.accent,
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6
        }}
      >
        <Sparkles size={12} />
        Recommend
      </button>
    </>
  )
}

// ── Agent Detail Panel ───────────────────────────────────────────────────────

function AgentDetailPanel({
  agent,
  selectedNode,
  onAssignToSelected
}: {
  agent: AgentDefinition | null
  selectedNode: Node | null
  onAssignToSelected: (agent: AgentDefinition) => void
}) {
  if (!agent) {
    return (
      <div style={{ fontSize: 12, color: colors.textDim, fontStyle: 'italic', lineHeight: 1.5 }}>
        Select an agent from the workflow agent list to inspect its details.
      </div>
    )
  }

  const meta = vendorMeta[agent.vendor] ?? { icon: Bot, color: colors.textMuted }
  const selectedNodeData = selectedNode?.data as AgentNodeData | undefined

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 8,
            border: `1px solid ${meta.color}66`,
            background: `${meta.color}22`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}
        >
          <VendorIcon vendor={agent.vendor} size={18} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 750, color: colors.text, lineHeight: 1.25, overflowWrap: 'anywhere' }}>
            {agent.name}
          </div>
          <div style={{ fontSize: 11, color: colors.textMuted, lineHeight: 1.4, overflowWrap: 'anywhere' }}>
            {agent.role || 'No role'} · {agent.vendor}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <AgentDetailRow icon={<Cpu size={14} />} label="Model" value={agent.model || 'Default'} />
        <AgentDetailRow icon={<Shield size={14} />} label="Permission" value={permissionModeLabel(agent.permissionMode)} />
        {agent.vendor === 'codex' && (
          <>
            <AgentDetailRow icon={<Sparkles size={14} />} label="Reasoning" value={agent.codexReasoningEffort || 'Model default'} />
            <AgentDetailRow icon={<Code2 size={14} />} label="Tier" value={agent.codexServiceTier || 'Default'} />
          </>
        )}
      </div>

      <div style={{ height: 1, background: colors.border }} />

      <div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 8,
          fontSize: 10,
          color: colors.textDim,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          fontWeight: 700
        }}>
          <FileText size={13} />
          System Prompt
        </div>
        <div style={{
          maxHeight: 230,
          overflowY: 'auto',
          padding: 10,
          borderRadius: 8,
          border: `1px solid ${colors.border}`,
          background: colors.bg,
          color: colors.textMuted,
          fontSize: 11,
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere'
        }}>
          {agent.systemPrompt || 'No system prompt configured.'}
        </div>
      </div>

      {selectedNode && (
        <button
          type="button"
          onClick={() => onAssignToSelected(agent)}
          style={{
            width: '100%',
            padding: '8px 10px',
            borderRadius: 6,
            border: `1px solid ${colors.accent}66`,
            background: `${colors.accent}22`,
            color: colors.text,
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer'
          }}
        >
          Use for {selectedNodeData?.agentName || 'selected step'}
        </button>
      )}
    </>
  )
}

function AgentDetailRow({ icon, label, value }: { icon: JSX.Element; label: string; value: string }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '20px 72px minmax(0, 1fr)',
      alignItems: 'center',
      gap: 7,
      fontSize: 11,
      color: colors.textMuted
    }}>
      <span style={{ display: 'flex', color: colors.textDim }}>{icon}</span>
      <span>{label}</span>
      <strong style={{
        minWidth: 0,
        color: colors.text,
        fontWeight: 650,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }}>
        {value}
      </strong>
    </div>
  )
}

function permissionModeLabel(mode: AgentDefinition['permissionMode']): string {
  switch (mode) {
    case 'default':
      return 'Default'
    case 'acceptEdits':
      return 'Accept Edits'
    case 'bypassPermissions':
    case undefined:
      return 'Bypass Permissions'
    case 'plan':
      return 'Plan Mode'
  }
}

// ── Template Property Panel (no node selected) ────────────────────────────────

function TemplatePropertyPanel({ template }: { template: WorkflowTemplate | null }) {
  if (!template) {
    return (
      <div style={{ fontSize: 12, color: colors.textDim, fontStyle: 'italic' }}>
        No template loaded
      </div>
    )
  }

  return (
    <>
      <div style={{ fontSize: 11, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Template
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>{template.name}</div>
      {template.description && (
        <div style={{ fontSize: 11, color: colors.textMuted, lineHeight: 1.4 }}>
          {template.description}
        </div>
      )}
      {template.budgetUsd != null && (
        <div style={{ fontSize: 11, color: colors.textMuted }}>
          Budget: <strong style={{ color: colors.text }}>${template.budgetUsd}</strong>
        </div>
      )}
    </>
  )
}

// ── Toolbar Button ────────────────────────────────────────────────────────────

function ToolbarButton({
  onClick,
  disabled,
  title,
  children
}: {
  onClick: () => void
  disabled?: boolean
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      className="workflow-canvas-toolbar-button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        width: 28,
        height: 28,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        border: 'none',
        borderRadius: 5,
        color: disabled ? colors.textDim : colors.text,
        fontSize: 14,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1
      }}
    >
      {children}
    </button>
  )
}

// ── Exported wrapper with ReactFlowProvider ───────────────────────────────────

export default function WorkflowCanvas(props: WorkflowCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  )
}
