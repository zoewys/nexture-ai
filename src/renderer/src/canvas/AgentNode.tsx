import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { Bot, Code2 } from 'lucide-react'

export interface AgentNodeData {
  agentId: string
  agentName: string
  role: string
  vendor: string
  model: string
  index?: number
  [key: string]: unknown
}

export type AgentNodeType = Node<AgentNodeData, 'agent'>

const vendorConfig: Record<string, { icon: typeof Bot; color: string; label: string }> = {
  claude: { icon: Bot, color: '#6c8cff', label: 'claude' },
  codex: { icon: Code2, color: '#4caf7d', label: 'codex' },
}

export function AgentNode({ data, selected }: NodeProps<AgentNodeType>) {
  const vendor = vendorConfig[data.vendor] ?? { icon: Bot, color: '#9aa3b5', label: data.vendor }
  const nodeTitle = data.role || data.agentName

  return (
    <div
      className={`workflow-agent-node${selected ? ' workflow-agent-node-selected' : ''}`}
      data-vendor={data.vendor}
      style={{ '--node-vendor-color': vendor.color } as React.CSSProperties}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="workflow-node-port workflow-node-port-in"
      />

      <span className="workflow-agent-node-vendor">{vendor.label}</span>
      <span className="workflow-agent-node-title">{nodeTitle}</span>

      <Handle
        type="source"
        position={Position.Right}
        className="workflow-node-port workflow-node-port-out"
      />
    </div>
  )
}
