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
  claude: { icon: Bot, color: '#6c8cff', label: 'Claude' },
  codex: { icon: Code2, color: '#4caf7d', label: 'Codex' },
}

export function AgentNode({ data, selected }: NodeProps<AgentNodeType>) {
  const vendor = vendorConfig[data.vendor] ?? { icon: Bot, color: '#9aa3b5', label: data.vendor }
  const VendorIcon = vendor.icon

  return (
    <div style={{
      background: '#20232b',
      border: `1.5px solid ${selected ? '#6c8cff' : '#343946'}`,
      borderRadius: 10,
      padding: '8px 14px',
      minWidth: 180,
      boxShadow: selected
        ? '0 0 12px rgba(108, 140, 255, 0.35)'
        : '0 2px 8px rgba(0, 0, 0, 0.25)',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      cursor: 'grab',
      transition: 'border-color 0.15s, box-shadow 0.15s',
    }}>
      <Handle
        type="target"
        position={Position.Left}
        style={{ width: 8, height: 8, background: '#6c8cff', border: '2px solid #20232b', left: -4 }}
      />

      {/* Index badge */}
      {data.index != null && (
        <div style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 10,
          fontWeight: 700,
          color: '#9aa3b5',
          flexShrink: 0,
        }}>
          {data.index + 1}
        </div>
      )}

      {/* Vendor icon */}
      <div style={{
        width: 28,
        height: 28,
        borderRadius: 6,
        background: vendor.color + '22',
        border: `1px solid ${vendor.color}55`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}>
        <VendorIcon size={14} color={vendor.color} />
      </div>

      {/* Info */}
      <div style={{ overflow: 'hidden', flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#eef2f8', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {data.agentName}
        </div>
        <div style={{ fontSize: 10, color: '#9aa3b5', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span style={{ color: vendor.color, fontWeight: 600 }}>{vendor.label}</span>
          {data.model && <span> / {data.model}</span>}
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        style={{ width: 8, height: 8, background: '#6c8cff', border: '2px solid #20232b', right: -4 }}
      />
    </div>
  )
}
