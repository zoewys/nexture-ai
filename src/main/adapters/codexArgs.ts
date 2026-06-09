import type { CodexReasoningEffort, ResumeHandle } from '@shared/types'

export interface CodexExecArgsInput {
  model?: string
  addDirs?: string[]
  resumeFrom?: ResumeHandle
  codexReasoningEffort?: CodexReasoningEffort
  codexServiceTier?: string
  outputSchemaPath?: string
}

export function buildCodexExecArgs(input: CodexExecArgsInput, prompt: string): string[] {
  const args = ['exec']
  if (input.model) args.push('--model', input.model)
  for (const dir of input.addDirs ?? []) args.push('--add-dir', dir)
  appendConfig(args, 'model_reasoning_effort', input.codexReasoningEffort)
  appendConfig(args, 'service_tier', input.codexServiceTier)
  if (input.outputSchemaPath) args.push('--output-schema', input.outputSchemaPath)
  args.push('--json')
  if (input.resumeFrom?.sessionId) args.push('--resume', input.resumeFrom.sessionId)
  args.push('--dangerously-bypass-approvals-and-sandbox')
  args.push('--skip-git-repo-check')
  args.push(prompt)
  return args
}

function appendConfig(args: string[], key: string, value: string | undefined): void {
  if (!value) return
  args.push('-c', `${key}=${JSON.stringify(value)}`)
}
