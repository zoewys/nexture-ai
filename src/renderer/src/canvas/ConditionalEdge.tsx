import { getBezierPath, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react'

export function ConditionalEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  style,
}: EdgeProps) {
  const condition = data?.condition as string | undefined

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const isConditional = Boolean(condition)

  const pathStyle: React.CSSProperties = isConditional
    ? {
        stroke: '#d4a548',
        strokeWidth: 1.5,
        strokeDasharray: '6 3',
        fill: 'none',
        ...style,
      }
    : {
        stroke: '#6c8cff',
        strokeWidth: 1.5,
        fill: 'none',
        ...style,
      }

  const labelStyle: React.CSSProperties = {
    position: 'absolute',
    transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
    fontSize: 9,
    fontWeight: 500,
    color: '#eef2f8',
    background: '#2e2a1f',
    border: '1px solid #d4a54866',
    borderRadius: 4,
    padding: '2px 6px',
    pointerEvents: 'all',
    whiteSpace: 'nowrap',
    maxWidth: 120,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }

  return (
    <>
      <path
        id={id}
        d={edgePath}
        style={pathStyle}
        className="react-flow__edge-path"
        markerEnd={markerEnd}
      />
      {isConditional && (
        <EdgeLabelRenderer>
          <div style={labelStyle} className="nodrag nopan">
            {condition}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
