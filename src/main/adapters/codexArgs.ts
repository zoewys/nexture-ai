import type { CodexReasoningEffort } from '@shared/types'

export interface CodexExecArgsInput {
  model?: string
  addDirs?: string[]
  codexReasoningEffort?: CodexReasoningEffort
  codexServiceTier?: string
  outputSchemaPath?: string
  resumeFrom?: string
}

export function buildCodexExecArgs(input: CodexExecArgsInput, prompt: string): string[] {
  return input.resumeFrom
    ? buildCodexResumeArgs(input, input.resumeFrom, prompt)
    : buildCodexInitialArgs(input, prompt)
}

export function buildCodexInitialArgs(input: CodexExecArgsInput, prompt: string): string[] {
  const args = ['exec']
  appendCommonCodexArgs(args, input)
  args.push(prompt)
  return args
}

export function buildCodexResumeArgs(
  input: CodexExecArgsInput,
  sessionId: string,
  prompt: string
): string[] {
  const args = ['exec', 'resume', sessionId]
  appendCommonCodexArgs(args, input)
  args.push(prompt)
  return args
}

function appendCommonCodexArgs(args: string[], input: CodexExecArgsInput): void {
  if (input.model) args.push('--model', input.model)
  for (const dir of input.addDirs ?? []) args.push('--add-dir', dir)
  appendConfig(args, 'model_reasoning_effort', input.codexReasoningEffort)
  appendConfig(args, 'service_tier', input.codexServiceTier)
  if (input.outputSchemaPath) args.push('--output-schema', input.outputSchemaPath)
  args.push('--json')
  args.push('--dangerously-bypass-approvals-and-sandbox')
  args.push('--skip-git-repo-check')
}

function appendConfig(args: string[], key: string, value: string | undefined): void {
  if (!value) return
  args.push('-c', `${key}=${JSON.stringify(value)}`)
}
