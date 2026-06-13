import assert from 'node:assert/strict'

// Mirrors filterCodexStderr in src/main/adapters/codexAdapter.ts.
// Keep in sync with the TypeScript source.
function filterCodexStderr(text) {
  const withoutPluginAssetIconWarnings = text.replace(
    /(?:\S+\s+WARN\s+)?codex_core_skills::loader: ignoring\s+interface\.icon_(?:small|large): icon path with '\.\.' must\s+resolve under plugin assets\/?/g,
    ''
  )

  const lines = withoutPluginAssetIconWarnings.split('\n')
  const noiseLines = []
  const mcpLines = []

  for (const line of lines) {
    if (!line.trim()) continue
    if (
      /rmcp::transport::worker/.test(line) ||
      /MCP grant token/.test(line) ||
      /grant token not valid/.test(line) ||
      /Missing or invalid access token/.test(line) ||
      /AuthRequired\b/.test(line) ||
      /UnexpectedContentType/.test(line)
    ) {
      mcpLines.push(line.trim())
    } else {
      noiseLines.push(line)
    }
  }

  return { noise: noiseLines.join('\n'), mcp: mcpLines.join('\n') }
}

const pluginIconWarning = [
  '2026-06-04T14:55:36.146981Z  WARN',
  'codex_core_skills::loader: ignoring',
  "interface.icon_small: icon path with '..' must",
  'resolve under plugin assets/'
].join('\n')

const pluginIconLargeWarning = pluginIconWarning.replace('icon_small', 'icon_large')

// Plugin icon warnings → noise bucket only (suppressed)
assert.deepEqual(
  filterCodexStderr(pluginIconWarning),
  { noise: '', mcp: '' },
  'Codex plugin asset icon warnings should land in noise (empty after trim)'
)

assert.deepEqual(
  filterCodexStderr(pluginIconLargeWarning),
  { noise: '', mcp: '' },
  'Codex plugin large-icon asset warnings should also be suppressed'
)

// MCP auth messages → mcp bucket (surfaced as system events)
assert.deepEqual(
  filterCodexStderr('2026-06-04T14:55:36Z WARN Missing or invalid access token'),
  { noise: '', mcp: '2026-06-04T14:55:36Z WARN Missing or invalid access token' },
  'MCP auth messages should route to mcp bucket for transcript visibility'
)

// Mixed: plugin noise should be stripped; real stderr should remain in noise
{
  const result = filterCodexStderr(`${pluginIconWarning}\nfatal: not a git repository`)
  assert.equal(result.noise, 'fatal: not a git repository', 'real stderr mixed with plugin noise should stay in noise')
  assert.equal(result.mcp, '', 'no MCP messages in git error')
}

// Pure unrelated stderr → noise bucket
{
  const result = filterCodexStderr('fatal: not a git repository')
  assert.equal(result.noise, 'fatal: not a git repository', 'unrelated stderr should land in noise')
  assert.equal(result.mcp, '', 'no MCP messages')
}

// MCP message mixed with real stderr → split correctly
{
  const result = filterCodexStderr('fatal: not a git repository\nMissing or invalid access token')
  assert.equal(result.noise, 'fatal: not a git repository', 'real stderr goes to noise')
  assert.equal(result.mcp, 'Missing or invalid access token', 'MCP auth goes to mcp')
}

// Multiple MCP lines → all in mcp
{
  const result = filterCodexStderr('MCP grant token\nMissing or invalid access token\nAuthRequired')
  assert.equal(result.noise, '', 'all MCP lines should not be in noise')
  assert.equal(result.mcp, 'MCP grant token\nMissing or invalid access token\nAuthRequired', 'all MCP lines go to mcp')
}

// rmcp transport worker → mcp
{
  const result = filterCodexStderr('rmcp::transport::worker connection lost')
  assert.equal(result.noise, '', 'rmcp transport messages should not be noise')
  assert.equal(result.mcp, 'rmcp::transport::worker connection lost', 'rmcp transport goes to mcp')
}

console.log('✓ All codex stderr filter tests passed')
