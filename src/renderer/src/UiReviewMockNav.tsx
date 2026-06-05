export type UiReviewMockNavActive = 'workflow' | 'new-run' | 'templates' | 'agents' | 'single'

interface UiReviewMockNavProps {
  active: UiReviewMockNavActive
}

const items: { id: UiReviewMockNavActive; label: string }[] = [
  { id: 'workflow', label: 'Workflow' },
  { id: 'new-run', label: 'New Run Drawer' },
  { id: 'templates', label: 'Templates' },
  { id: 'agents', label: 'Agents' },
  { id: 'single', label: 'Single' }
]

export function UiReviewMockNav({ active }: UiReviewMockNavProps): JSX.Element {
  return (
    <div className="ui-review-mock-nav" aria-label="UI review mockup navigation">
      {items.map((item) => (
        <span
          className={[
            'ui-review-mock-nav-item',
            active === item.id ? 'ui-review-mock-nav-item-active' : ''
          ].filter(Boolean).join(' ')}
          key={item.id}
        >
          {item.label}
        </span>
      ))}
    </div>
  )
}
