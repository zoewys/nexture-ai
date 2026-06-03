import { useEffect, useState } from 'react'
import type { AgentVendor, CliCheckResult, RunConfig } from '@shared/types'
import { ALL_VENDORS } from '@shared/types'
import { useRun } from './useRun'
import { TranscriptViewer } from './TranscriptViewer'

export function App(): JSX.Element {
  const { state, start, push, abort, reset } = useRun()
  const [clis, setClis] = useState<CliCheckResult | null>(null)
  const [vendor, setVendor] = useState<AgentVendor>('claude')
  const [cwd, setCwd] = useState('')
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('')
  const [interjection, setInterjection] = useState('')

  useEffect(() => {
    window.api.checkClis().then(setClis)
  }, [])

  const canStart = !state.running && cwd.trim() !== '' && prompt.trim() !== ''

  const handleStart = async (): Promise<void> => {
    const config: RunConfig = {
      vendor,
      prompt: prompt.trim(),
      cwd: cwd.trim(),
      model: model.trim() || undefined
    }
    await start(config)
  }

  const handlePickDir = async (): Promise<void> => {
    const dir = await window.api.pickDir()
    if (dir) setCwd(dir)
  }

  const handleInterject = async (): Promise<void> => {
    const text = interjection.trim()
    if (!text) return
    setInterjection('')
    await push(text)
  }

  const cliAvailable = clis ? clis[vendor] : true

  return (
    <div className="app">
      <header className="app-header">
        <h1>Agent Studio</h1>
        <span className="app-subtitle">M1 · single agent · {vendor}</span>
      </header>

      <div className="app-body">
        <aside className="panel panel-config">
          <label className="field">
            <span>Vendor</span>
            <select value={vendor} onChange={(e) => setVendor(e.target.value as AgentVendor)}>
              {ALL_VENDORS.map((v) => (
                <option key={v} value={v}>
                  {v}
                  {clis && !clis[v] ? ' (not installed)' : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Model (optional)</span>
            <input
              value={model}
              placeholder="e.g. sonnet, opus"
              onChange={(e) => setModel(e.target.value)}
            />
          </label>

          <label className="field">
            <span>Project directory</span>
            <div className="field-row">
              <input
                value={cwd}
                placeholder="/path/to/project"
                onChange={(e) => setCwd(e.target.value)}
              />
              <button onClick={handlePickDir} type="button">
                Browse…
              </button>
            </div>
          </label>

          <label className="field field-grow">
            <span>Prompt</span>
            <textarea
              value={prompt}
              placeholder="Describe the task for this agent…"
              onChange={(e) => setPrompt(e.target.value)}
            />
          </label>

          {!cliAvailable && (
            <div className="warn">
              {vendor} CLI not detected on PATH. Install it or pick another vendor.
            </div>
          )}

          <div className="actions">
            <button className="primary" disabled={!canStart} onClick={handleStart} type="button">
              {state.running ? 'Running…' : 'Start run'}
            </button>
            {state.running && (
              <button onClick={abort} type="button">
                Stop
              </button>
            )}
            {!state.running && state.events.length > 0 && (
              <button onClick={reset} type="button">
                Clear
              </button>
            )}
          </div>
        </aside>

        <main className="panel panel-transcript">
          <TranscriptViewer events={state.events} />

          {state.running && vendor === 'claude' && (
            <div className="interject">
              <input
                value={interjection}
                placeholder="Interject (only affects the current agent)…"
                onChange={(e) => setInterjection(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleInterject()
                }}
              />
              <button onClick={handleInterject} type="button">
                Send
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
