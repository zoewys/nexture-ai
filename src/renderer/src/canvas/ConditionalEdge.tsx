import { getBezierPath, EdgeLabelRenderer, Position, type EdgeProps } from '@xyflow/react'

export function ConditionalEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition = Position.Right,
  targetPosition = Position.Left,
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

  const pathStyle: React.CSSProperties = {
    ...style
  }

  const labelStyle: React.CSSProperties = {
    transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`
  }

  return (
    <>
      <path
        id={id}
        d={edgePath}
        style={pathStyle}
        className={[
          'react-flow__edge-path',
          'workflow-canvas-edge-path',
          isConditional ? 'workflow-canvas-edge-conditional' : 'workflow-canvas-edge-active'
        ].join(' ')}
        markerEnd={markerEnd}
      />
      {isConditional && (
        <EdgeLabelRenderer>
          <div style={labelStyle} className="workflow-canvas-edge-label nodrag nopan">
            {condition}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
