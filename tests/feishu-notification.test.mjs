import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = (relativePath) => readFileSync(join(root, relativePath), 'utf8')

async function importFeishuNotifier() {
  const absPath = join(root, 'src/main/FeishuNotifier.ts')
  const testSource = source('src/main/FeishuNotifier.ts')
    .replace("import * as lark from '@larksuiteoapi/node-sdk'", 'const lark = {}')
  const transpiled = ts.transpileModule(testSource, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler
    },
    fileName: absPath
  })
  const dataUrl = `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString('base64')}`
  return import(dataUrl)
}

async function muteConsoleError(fn) {
  const original = console.error
  console.error = () => {}
  try {
    return await fn()
  } finally {
    console.error = original
  }
}

function createFakeLark({ startRejects = false, sendRejects = false } = {}) {
  const sentMessages = []
  const wsInstances = []
  class Client {
    constructor(options) {
      this.options = options
      this.im = {
        message: {
          create: async (payload) => {
            if (sendRejects) throw new Error('send failed')
            sentMessages.push(payload)
            return { data: { message_id: `message-${sentMessages.length}` } }
          },
          patch: async (messageId, payload) => {
            sentMessages.push({ patch: messageId, ...payload })
            return { data: { message_id: messageId } }
          }
        }
      }
    }
  }
  class WSClient {
    constructor(options) {
      this.options = options
      this.handlers = new Map()
      this.destroyed = false
      wsInstances.push(this)
    }

    on(eventName, handler) {
      this.handlers.set(eventName, handler)
    }

    async start() {
      if (startRejects) throw new Error('connect failed')
    }

    destroy() {
      this.destroyed = true
    }
  }
  return { sdk: { Client, WSClient }, sentMessages, wsInstances }
}

function feishuConfig(patch = {}) {
  return {
    appId: 'cli_a',
    appSecret: 'secret',
    chatId: 'oc_chat',
    userId: '',
    enabled: true,
    ...patch
  }
}

function workflowRun(patch = {}) {
  const run = {
    id: 'run-1',
    templateId: 'template-1',
    templateName: 'Release workflow',
    runName: 'Friday release',
    projectPath: '/tmp/project',
    initialPrompt: 'Ship it',
    status: 'awaiting-confirm',
    currentStepIndex: 0,
    startedAt: Date.now() - 120000,
    finishedAt: Date.now(),
    totalInputTokens: 10,
    totalOutputTokens: 20,
    totalCostUsd: 0.42,
    steps: [
      {
        agentId: 'agent-1',
        displayName: 'Review changes',
        role: 'review',
        status: 'awaiting-confirm',
        executions: [
          {
            id: 'exec-1',
            stepIndex: 0,
            agentId: 'agent-1',
            status: 'awaiting-confirm',
            startedAt: Date.now() - 60000,
            finishedAt: Date.now(),
            handoff: {
              summary: 'Reviewed the pending release and found no blockers.',
              artifacts: [
                { path: 'docs/release.md', description: 'Release notes', type: 'doc' }
              ],
              nextStepGuidance: 'Approve to continue.'
            },
            events: [],
            totalInputTokens: 10,
            totalOutputTokens: 20,
            totalCostUsd: 0.42
          }
        ]
      },
      {
        agentId: 'agent-2',
        displayName: 'Publish',
        role: 'ops',
        status: 'pending',
        executions: []
      }
    ],
    ...patch
  }
  return run
}

test('feishu SDK dependency is declared and locked', () => {
  assert.match(source('package.json'), /"@larksuiteoapi\/node-sdk":/)
  assert.match(source('pnpm-lock.yaml'), /@larksuiteoapi\/node-sdk/)
})

test('shared contract exposes Feishu settings defaults and IPC channels', () => {
  const types = source('src/shared/types.ts')

  assert.match(types, /export interface FeishuConfig/)
  assert.match(types, /appId: string/)
  assert.match(types, /appSecret: string/)
  assert.match(types, /chatId\?: string/)
  assert.match(types, /userId\?: string/)
  assert.match(types, /enabled: boolean/)
  assert.match(types, /export const DEFAULT_FEISHU_CONFIG: FeishuConfig =/)
  assert.match(types, /enabled: false/)
  assert.match(types, /export type FeishuConnectionStatus = 'disconnected' \| 'connecting' \| 'connected' \| 'error'/)
  assert.match(types, /feishu: FeishuConfig/)
  assert.match(types, /feishu: DEFAULT_FEISHU_CONFIG/)
  assert.match(types, /feishuTest: 'feishu:test'/)
  assert.match(types, /feishuStatus: 'feishu:status'/)
  assert.match(types, /feishuStatusChanged: 'feishu:status-changed'/)
})

test('preload exposes typed Feishu bridge methods', () => {
  const preload = source('src/preload/index.ts')

  assert.match(preload, /type FeishuConnectionStatus/)
  assert.match(preload, /feishuTest: \(\): Promise<\{ ok: boolean; error\?: string \}>/)
  assert.match(preload, /ipcRenderer\.invoke\(IPC\.feishuTest\)/)
  assert.match(preload, /feishuStatus: \(\): Promise<FeishuConnectionStatus>/)
  assert.match(preload, /ipcRenderer\.invoke\(IPC\.feishuStatus\)/)
  assert.match(preload, /onFeishuStatusChanged/)
  assert.match(preload, /ipcRenderer\.on\(IPC\.feishuStatusChanged, handler\)/)
  assert.match(preload, /removeListener\(IPC\.feishuStatusChanged, handler\)/)
})

test('ipc wires FeishuNotifier into workflow updates, settings, actions, and shutdown', () => {
  const ipc = source('src/main/ipc.ts')

  assert.match(ipc, /import \{ FeishuNotifier \} from '\.\/FeishuNotifier'/)
  assert.match(ipc, /const feishuNotifier = new FeishuNotifier\(\)/)
  assert.match(ipc, /envelope\.event\.kind === 'run-updated'/)
  assert.match(ipc, /feishuNotifier\.handleRunUpdate\(envelope\.event\.run\)/)
  assert.match(ipc, /const initFeishu = \(\): void =>/)
  assert.match(ipc, /appSettingsStore\.get\(\)/)
  assert.match(ipc, /feishuNotifier\.configure\(/)
  assert.match(ipc, /webContents\.send\(IPC\.feishuStatusChanged, status\)/)
  assert.match(ipc, /workflowManager\.confirmStep\(runId, stepIndex\)/)
  assert.match(ipc, /workflowManager\.abort\(runId\)/)
  assert.match(ipc, /workflowManager\.rerunStep\(runId, stepIndex\)/)
  assert.match(ipc, /appSettingsStore\.save\(settings\)[\s\S]*initFeishu\(\)/)
  assert.match(ipc, /ipcMain\.handle\(IPC\.feishuTest/)
  assert.match(ipc, /ipcMain\.handle\(IPC\.feishuStatus/)
  assert.match(ipc, /feishuNotifier\.destroy\(\)/)
})

test('settings panel exposes Feishu configuration UI and bridge interactions', () => {
  const panel = source('src/renderer/src/SettingsPanel.tsx')
  const styles = source('src/renderer/src/styles.css')

  assert.match(panel, /MessageSquare/)
  assert.match(panel, /FeishuConnectionStatus/)
  assert.match(panel, /DEFAULT_FEISHU_CONFIG/)
  assert.match(panel, /feishuDraft/)
  assert.match(panel, /feishuStatus/)
  assert.match(panel, /feishuTesting/)
  assert.match(panel, /feishuSaving/)
  assert.match(panel, /onFeishuStatusChanged/)
  assert.match(panel, /window\.api\.feishuStatus\(\)/)
  assert.match(panel, /window\.api\.feishuTest\(\)/)
  assert.match(panel, /飞书机器人/)
  assert.match(panel, /App ID/)
  assert.match(panel, /App Secret/)
  assert.match(panel, /Chat ID/)
  assert.match(panel, /User ID/)
  assert.match(panel, /保存配置/)
  assert.match(panel, /发送测试通知/)
  assert.match(panel, /settings\.feishu\.enabled/)
  assert.match(panel, /onSave\(\{ \.\.\.settings, feishu:/)
  assert.match(styles, /\.feishu-config-fields/)
  assert.match(styles, /\.feishu-status-badge/)
})

test('FeishuNotifier configures disabled and connected states', async () => {
  assert.equal(existsSync(join(root, 'src/main/FeishuNotifier.ts')), true)
  const { FeishuNotifier } = await importFeishuNotifier()
  const fake = createFakeLark()
  const notifier = new FeishuNotifier(fake.sdk)
  const statuses = []

  await notifier.configure(feishuConfig({ enabled: false }), (status) => statuses.push(status), () => {})
  assert.equal(fake.wsInstances.length, 0)
  assert.equal(notifier.getStatus(), 'disconnected')

  await notifier.configure(feishuConfig(), (status) => statuses.push(status), () => {})
  assert.equal(fake.wsInstances.length, 1)
  assert.deepEqual(statuses.slice(-2), ['connecting', 'connected'])
  assert.equal(notifier.getStatus(), 'connected')
})

test('FeishuNotifier ignores run updates when disabled or missing credentials', async () => {
  const { FeishuNotifier } = await importFeishuNotifier()
  const fake = createFakeLark()
  const notifier = new FeishuNotifier(fake.sdk)
  const errors = []
  const original = console.error
  console.error = (...args) => { errors.push(args) }
  try {
    await notifier.configure(feishuConfig({ enabled: false }), () => {}, () => {})
    await notifier.handleRunUpdate(workflowRun())
    await notifier.configure(feishuConfig({ appId: '', appSecret: '', enabled: true }), () => {}, () => {})
    await notifier.handleRunUpdate(workflowRun({ status: 'completed' }))
  } finally {
    console.error = original
  }

  assert.equal(fake.sentMessages.length, 0)
  assert.equal(errors.length, 0)
})

test('FeishuNotifier dispatches card actions and destroys previous websocket clients', async () => {
  const { FeishuNotifier } = await importFeishuNotifier()
  const fake = createFakeLark()
  const actions = []
  const notifier = new FeishuNotifier(fake.sdk)

  await notifier.configure(feishuConfig(), () => {}, (runId, action, stepIndex) => {
    actions.push({ runId, action, stepIndex })
  })
  await notifier.configure(feishuConfig({ chatId: 'oc_other' }), () => {}, (runId, action, stepIndex) => {
    actions.push({ runId, action, stepIndex })
  })

  assert.equal(fake.wsInstances[0].destroyed, true)
  const handler = fake.wsInstances[1].handlers.get('card.action.trigger')
  assert.equal(typeof handler, 'function')
  const result = await handler({
    action: { value: { action: 'approve', runId: 'run-9', stepIndex: 2 } }
  })

  assert.deepEqual(actions, [{ runId: 'run-9', action: 'approve', stepIndex: 2 }])
  assert.match(JSON.stringify(result), /已批准/)

  notifier.destroy()
  assert.equal(fake.wsInstances[1].destroyed, true)
  assert.equal(notifier.getStatus(), 'disconnected')
})

test('FeishuNotifier sends deduped approval cards and ignores unrelated run states', async () => {
  const { FeishuNotifier } = await importFeishuNotifier()
  const fake = createFakeLark()
  const notifier = new FeishuNotifier(fake.sdk)

  await notifier.configure(feishuConfig(), () => {}, () => {})
  await notifier.handleRunUpdate(workflowRun())
  await notifier.handleRunUpdate(workflowRun())
  await notifier.handleRunUpdate(workflowRun({ status: 'running' }))

  assert.equal(fake.sentMessages.length, 1)
  const payload = JSON.stringify(fake.sentMessages[0])
  assert.match(payload, /oc_chat/)
  assert.match(payload, /Workflow 需要审批/)
  assert.match(payload, /Friday release/)
  assert.match(payload, /Review changes/)
  assert.match(payload, /approve/)
  assert.match(payload, /reject/)
  assert.match(payload, /rerun/)
})

test('FeishuNotifier sends terminal cards, test cards, and handles send failures without throwing', async () => {
  const { FeishuNotifier } = await importFeishuNotifier()
  const fake = createFakeLark()
  const notifier = new FeishuNotifier(fake.sdk)

  await notifier.configure(feishuConfig({ chatId: '', userId: 'ou_user' }), () => {}, () => {})
  await notifier.handleRunUpdate(workflowRun({ status: 'completed' }))
  await notifier.handleRunUpdate(workflowRun({ status: 'error' }))
  const testResult = await notifier.sendTestNotification()

  assert.equal(testResult.ok, true)
  assert.equal(fake.sentMessages.length, 3)
  assert.match(JSON.stringify(fake.sentMessages), /open_id/)
  assert.match(JSON.stringify(fake.sentMessages), /Workflow 已完成/)
  assert.match(JSON.stringify(fake.sentMessages), /Workflow 运行出错/)
  assert.match(JSON.stringify(fake.sentMessages), /Agent Studio 测试通知/)

  const missingTarget = new FeishuNotifier(fake.sdk)
  await missingTarget.configure(feishuConfig({ chatId: '', userId: '' }), () => {}, () => {})
  const missingTargetResult = await muteConsoleError(() => missingTarget.sendTestNotification())
  assert.equal(missingTargetResult.ok, false)

  const failing = createFakeLark({ sendRejects: true })
  const failingNotifier = new FeishuNotifier(failing.sdk)
  await failingNotifier.configure(feishuConfig(), () => {}, () => {})
  await muteConsoleError(() =>
    assert.doesNotReject(() => failingNotifier.handleRunUpdate(workflowRun({ id: 'run-failing' })))
  )
})
