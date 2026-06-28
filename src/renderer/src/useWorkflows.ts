/**
 * useWorkflows.ts — 工作流运行管理 hook
 *
 * 统一管理 workflow 模板和运行实例的前端状态：
 *  - templates: 从主进程加载的模板列表（CRUD）
 *  - runs: 所有工作流运行实例（按 startedAt 倒序排列）
 *  - selectedRun: 当前选中的运行
 *  - 操作方法：start / confirmStep / rerunStep / abort / pushInput / deleteRun
 *
 * 订阅主进程的 WorkflowEventEnvelope 流，实时更新运行状态和步骤 events。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  WorkflowEventEnvelope,
  WorkflowRun,
  WorkflowRunGitSafety,
  WorkflowStartInput,
  WorkflowTemplate
} from '@shared/types'
import { sortWorkflowRunsByStartedAt } from './workflowRunView'

export interface WorkflowDraft extends Omit<WorkflowTemplate, 'id'> {
  id?: string
}

export function useWorkflows() {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null,
    [runs, selectedRunId]
  )

  const reload = useCallback(async () => {
    setTemplates(await window.api.listWorkflows())
  }, [])

  const reloadRuns = useCallback(async () => {
    const loaded = sortWorkflowRunsByStartedAt(await window.api.listWorkflowRuns())
    setRuns(loaded)
    setSelectedRunId((prev) => prev ?? loaded[0]?.id ?? null)
  }, [])

  const save = useCallback(async (draft: WorkflowDraft) => {
    const saved = await window.api.saveWorkflow(draft)
    setTemplates((prev) => {
      const idx = prev.findIndex((item) => item.id === saved.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = saved
        return next
      }
      return [saved, ...prev]
    })
    return saved
  }, [])

  const remove = useCallback(async (id: string) => {
    await window.api.deleteWorkflow(id)
    setTemplates((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const start = useCallback(async (input: WorkflowStartInput) => {
    const { run } = await window.api.startWorkflow(input)
    setRuns((prev) =>
      sortWorkflowRunsByStartedAt([run, ...prev.filter((item) => item.id !== run.id)])
    )
    setSelectedRunId(run.id)
    return run
  }, [])

  const confirmStep = useCallback(async (stepIndex?: number) => {
    if (!selectedRun) return
    const run = await window.api.confirmWorkflowStep(selectedRun.id, stepIndex)
    setRuns((prev) => applyRunUpdate(prev, run))
    setSelectedRunId(run.id)
  }, [selectedRun])

  const finishInteractiveStep = useCallback(async (stepIndex: number) => {
    if (!selectedRun) return
    const run = await window.api.finishInteractiveStep(selectedRun.id, stepIndex)
    setRuns((prev) => applyRunUpdate(prev, run))
    setSelectedRunId(run.id)
  }, [selectedRun])

  const rerunStep = useCallback(
    async (stepIndex: number) => {
      if (!selectedRun) return
      const run = await window.api.rerunWorkflowStep(selectedRun.id, stepIndex)
      setRuns((prev) => applyRunUpdate(prev, run))
      setSelectedRunId(run.id)
    },
    [selectedRun]
  )

  const abort = useCallback(async () => {
    if (!selectedRun) return
    const run = await window.api.abortWorkflow(selectedRun.id)
    setRuns((prev) => applyRunUpdate(prev, run))
    setSelectedRunId(run.id)
  }, [selectedRun])

  const skipStep = useCallback(async () => {
    if (!selectedRun) return
    const run = await window.api.skipWorkflowStep(selectedRun.id)
    setRuns((prev) => applyRunUpdate(prev, run))
    setSelectedRunId(run.id)
  }, [selectedRun])

  const pushInput = useCallback(
    async (stepIndex: number, text: string) => {
      if (!selectedRun) return
      const run = await window.api.pushWorkflowInput(selectedRun.id, stepIndex, text)
      setRuns((prev) => applyRunUpdate(prev, run))
      setSelectedRunId(run.id)
    },
    [selectedRun]
  )

  const updatePrompt = useCallback(
    async (runId: string, newPrompt: string) => {
      const run = await window.api.updateWorkflowPrompt(runId, newPrompt)
      setRuns((prev) => applyRunUpdate(prev, run))
    },
    []
  )

  const deleteRun = useCallback(async (runId: string) => {
    await window.api.deleteWorkflowRun(runId)
    setRuns((prev) => {
      const next = prev.filter((run) => run.id !== runId)
      setSelectedRunId((selected) => (selected === runId ? next[0]?.id ?? null : selected))
      return next
    })
  }, [])

  const inspectGitSafety = useCallback(
    (projectPath: string): Promise<WorkflowRunGitSafety> =>
      window.api.inspectWorkflowGitSafety(projectPath),
    []
  )

  const clearRun = useCallback(() => setSelectedRunId(null), [])

  useEffect(() => {
    void reload()
    void reloadRuns()
  }, [reload, reloadRuns])

  useEffect(() => {
    const unsub = window.api.onWorkflowEvent((envelope: WorkflowEventEnvelope) => {
      setRuns((prev) => applyWorkflowEventToRuns(prev, envelope))
    })
    return unsub
  }, [])

  return {
    templates,
    runs,
    selectedRun,
    selectedRunId,
    currentRun: selectedRun,
    selectRun: setSelectedRunId,
    reload,
    reloadRuns,
    save,
    remove,
    start,
    confirmStep,
    finishInteractiveStep,
    rerunStep,
    abort,
    skipStep,
    pushInput,
    updatePrompt,
    deleteRun,
    inspectGitSafety,
    clearRun
  }
}

export type UseWorkflowsResult = ReturnType<typeof useWorkflows>

function applyRunUpdate(runs: WorkflowRun[], updated: WorkflowRun): WorkflowRun[] {
  const next = runs.map((run) => (run.id === updated.id ? updated : run))
  if (!next.some((run) => run.id === updated.id)) next.push(updated)
  return sortWorkflowRunsByStartedAt(next)
}

function applyWorkflowEventToRuns(
  current: WorkflowRun[],
  { runId, event }: WorkflowEventEnvelope
): WorkflowRun[] {
  if (event.kind === 'run-updated') return applyRunUpdate(current, event.run)

  return current.map((run) => {
    if (run.id !== runId || event.kind !== 'agent-event') return run
    return {
      ...run,
      steps: run.steps.map((step, stepIndex) => {
        if (stepIndex !== event.stepIndex) return step
        return {
          ...step,
          executions: step.executions.map((execution) => {
            if (execution.id !== event.executionId) return execution
            return {
              ...execution,
              events: [...execution.events, event.event],
              sessionId:
                event.event.kind === 'session-started' ? event.event.sessionId : execution.sessionId
            }
          })
        }
      })
    }
  })
}
