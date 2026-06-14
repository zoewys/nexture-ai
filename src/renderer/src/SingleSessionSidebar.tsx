import type { SingleSession } from '@shared/types'
import { MessageSquare, Plus } from 'lucide-react'

interface SingleSessionSidebarProps {
  sessions: SingleSession[]
  selectedSessionId: string | null
  onNewSession: () => void
  onSelectSession: (id: string) => void
}

export function SingleSessionSidebar({
  sessions,
  selectedSessionId,
  onNewSession,
  onSelectSession
}: SingleSessionSidebarProps): JSX.Element {
  return (
    <aside className="single-session-sidebar">
      <div className="single-session-sidebar-head">
        <div>
          <span className="section-title">Single</span>
          <h2>Sessions</h2>
        </div>
        <button
          type="button"
          className="icon-text"
          onClick={onNewSession}
        >
          <Plus size={14} /> New
        </button>
      </div>

      <div className="single-session-cards">
        {sessions.length === 0 ? (
          <div className="single-session-empty">
            <MessageSquare size={18} />
            <span>No sessions yet</span>
          </div>
        ) : sessions.map((session) => (
          <button
            key={session.id}
            type="button"
            className={[
              'single-session-card',
              selectedSessionId === session.id ? 'single-session-card-active' : ''
            ].filter(Boolean).join(' ')}
            onClick={() => onSelectSession(session.id)}
          >
            <span className="single-session-card-head">
              <span className="single-session-card-title">{session.title}</span>
              <span className="single-session-card-time">{formatTime(session.updatedAt)}</span>
            </span>
            <span className="single-session-card-meta">
              <span className="single-session-card-route">{routeSummary(session)}</span>
              <span className="single-session-card-preview">{session.preview || 'No messages yet'}</span>
            </span>
          </button>
        ))}
      </div>
    </aside>
  )
}

function routeSummary(session: SingleSession): string {
  const route = session.route
  if (!route) return session.cwd
  return [route.vendor, route.model].filter(Boolean).join(' · ')
}

function formatTime(ts: number): string {
  const date = new Date(ts)
  return Number.isFinite(date.getTime())
    ? date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : ''
}
