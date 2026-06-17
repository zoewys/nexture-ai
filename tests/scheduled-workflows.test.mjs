/**
 * Scheduled workflow tests.
 *
 * These combine behavior checks for the standalone cron parser with source
 * contract checks for Electron/UI integration points that are expensive to
 * instantiate in node:test.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

const source = (relativePath) => readFileSync(join(root, relativePath), 'utf8')

async function importTs(relativePath) {
  const absPath = join(root, relativePath)
  const transpiled = ts.transpileModule(readFileSync(absPath, 'utf8'), {
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

test('shared contract exposes schedules, scheduled runs, app setting, and IPC channels', () => {
  const types = source('src/shared/types.ts')

  assert.match(types, /interface WorkflowSchedule/)
  assert.match(types, /templateId: string/)
  assert.match(types, /cron: string/)
  assert.match(types, /lastRunStatus\?: 'completed' \| 'error' \| 'running'/)
  assert.match(types, /autoConfirm\?: boolean/)
  assert.match(types, /scheduledBy\?: string/)
  assert.match(types, /minimizeToTray: boolean/)
  assert.match(types, /minimizeToTray: true/)
  assert.match(types, /schedulesList: 'schedules:list'/)
  assert.match(types, /schedulesSave: 'schedules:save'/)
  assert.match(types, /schedulesDelete: 'schedules:delete'/)
  assert.match(types, /schedulesToggle: 'schedules:toggle'/)
  assert.match(types, /cronValidate: 'cron:validate'/)
  assert.match(types, /cronDescribe: 'cron:describe'/)
})

test('cron parser supports required syntax, validation, next fire time, and descriptions', async () => {
  const { parseCron, nextFireTime, isValidCron, describeCron } = await importTs('src/main/cronParser.ts')

  assert.deepEqual(parseCron('0 9 * * 1-5'), {
    minute: [0],
    hour: [9],
    dayOfMonth: Array.from({ length: 31 }, (_, index) => index + 1),
    month: Array.from({ length: 12 }, (_, index) => index + 1),
    dayOfWeek: [1, 2, 3, 4, 5]
  })

  assert.deepEqual(parseCron('*/30 * * * *').minute, [0, 30])
  assert.deepEqual(parseCron('0 9,18 * * *').hour, [9, 18])
  assert.equal(isValidCron('abc'), false)
  assert.equal(isValidCron('* * * * *'), false)
  assert.equal(isValidCron('0 9 * * *'), true)
  assert.equal(describeCron('0 9 * * 1-5'), '工作日 09:00')

  const after = new Date(2026, 5, 12, 18, 1, 0, 0)
  const next = nextFireTime('0 18 * * 5', after)
  assert.equal(next.getFullYear(), 2026)
  assert.equal(next.getMonth(), 5)
  assert.equal(next.getDate(), 19)
  assert.equal(next.getHours(), 18)
  assert.equal(next.getMinutes(), 0)
})

test('schedule store persists schedules and last trigger metadata', () => {
  assert.equal(existsSync(join(root, 'src/main/ScheduleStore.ts')), true)
  const store = source('src/main/ScheduleStore.ts')

  assert.match(store, /export class ScheduleStore/)
  assert.match(store, /schedules\.json/)
  assert.match(store, /list\(\): WorkflowSchedule\[\]/)
  assert.match(store, /save\(/)
  assert.match(store, /remove\(id: string\)/)
  assert.match(store, /toggle\(id: string, enabled: boolean\)/)
  assert.match(store, /updateLastTriggered\(id: string, runId: string, status:/)
  assert.match(store, /lastTriggeredAt/)
  assert.match(store, /lastRunId/)
  assert.match(store, /lastRunStatus/)
})

test('scheduler registers enabled schedules, starts auto-confirm runs, and updates terminal status', () => {
  assert.equal(existsSync(join(root, 'src/main/Scheduler.ts')), true)
  const scheduler = source('src/main/Scheduler.ts')

  assert.match(scheduler, /private timers = new Map<string, NodeJS\.Timeout>/)
  assert.match(scheduler, /start\(\): void/)
  assert.match(scheduler, /register\(schedule: WorkflowSchedule\): void/)
  assert.match(scheduler, /unregister\(scheduleId: string\): void/)
  assert.match(scheduler, /stopAll\(\): void/)
  assert.match(scheduler, /nextFireTime\(schedule\.cron/)
  assert.match(scheduler, /setTimeout/)
  assert.match(scheduler, /autoConfirm: true/)
  assert.match(scheduler, /scheduledBy: schedule\.id/)
  assert.match(scheduler, /updateLastTriggered\(schedule\.id, result\.run\.id, 'running'\)/)
  assert.match(scheduler, /handleWorkflowRunUpdated\(run: WorkflowRun\)/)
  assert.match(scheduler, /run\.scheduledBy/)
})

test('workflow manager records scheduled metadata and auto-confirms successful handoffs', () => {
  const manager = source('src/main/WorkflowManager.ts')

  assert.match(manager, /autoConfirm: input\.autoConfirm/)
  assert.match(manager, /scheduledBy: input\.scheduledBy/)
  assert.match(manager, /setRunSettledHandler/)
  assert.match(manager, /const shouldAutoAdvance = run\.autoConfirm \|\| templateStep\?\.interactive === true/)
  assert.match(manager, /execution\.status = shouldAutoAdvance \? 'done' : 'awaiting-confirm'/)
  assert.match(manager, /if \(shouldAutoAdvance\)/)
  assert.match(manager, /this\.startNextNode\(run\.id, nextIndex\)/)
  assert.match(manager, /run\.status = 'completed'/)
})

test('ipc and preload expose schedule CRUD plus cron preview helpers', () => {
  const ipc = source('src/main/ipc.ts')
  const preload = source('src/preload/index.ts')

  assert.match(ipc, /new ScheduleStore\(/)
  assert.match(ipc, /new Scheduler\(/)
  assert.match(ipc, /scheduler\.start\(\)/)
  assert.match(ipc, /IPC\.schedulesList/)
  assert.match(ipc, /IPC\.schedulesSave/)
  assert.match(ipc, /IPC\.schedulesDelete/)
  assert.match(ipc, /IPC\.schedulesToggle/)
  assert.match(ipc, /IPC\.cronValidate/)
  assert.match(ipc, /IPC\.cronDescribe/)

  assert.match(preload, /listSchedules/)
  assert.match(preload, /saveSchedule/)
  assert.match(preload, /deleteSchedule/)
  assert.match(preload, /toggleSchedule/)
  assert.match(preload, /cronValidate/)
  assert.match(preload, /cronDescribe/)
})

test('main process implements tray minimize, dock badge, and scheduled notifications', () => {
  const index = source('src/main/index.ts')

  assert.match(index, /Tray/)
  assert.match(index, /Menu/)
  assert.match(index, /Notification/)
  assert.match(index, /createTray/)
  assert.match(index, /minimizeToTray/)
  assert.match(index, /event\.preventDefault\(\)/)
  assert.match(index, /mainWindow\.hide\(\)/)
  assert.match(index, /app\.dock\.setBadge\('!'\)/)
  assert.match(index, /notifyScheduleResult/)
})

test('renderer exposes schedules tab, drawer, detail history, settings toggle, and scheduled run badge', () => {
  const workspace = source('src/renderer/src/WorkflowWorkspace.tsx')
  const modeRail = source('src/renderer/src/ModeRail.tsx')
  const app = source('src/renderer/src/App.tsx')
  const scheduleWorkspace = source('src/renderer/src/ScheduleWorkspace.tsx')
  const scheduleList = source('src/renderer/src/ScheduleList.tsx')
  const scheduleDetail = source('src/renderer/src/ScheduleDetail.tsx')
  const scheduleDrawer = source('src/renderer/src/ScheduleDrawer.tsx')
  const useSchedules = source('src/renderer/src/useSchedules.ts')
  const settings = source('src/renderer/src/SettingsPanel.tsx')
  const runList = source('src/renderer/src/WorkflowRunsList.tsx')
  const styles = source('src/renderer/src/styles.css')

  assert.match(modeRail, /'schedules'/)
  assert.match(app, /ScheduleWorkspace/)
  assert.match(app, /case 'schedules':\s*return '定时任务'/)
  assert.match(scheduleWorkspace, /ScheduleList/)
  assert.match(scheduleWorkspace, /ScheduleDetail/)
  assert.match(scheduleWorkspace, /ScheduleDrawer/)
  assert.match(scheduleWorkspace, /scheduleState\?: UseSchedulesResult/)
  assert.match(scheduleWorkspace, /const schedules = scheduleState \?\? liveSchedules/)
  assert.match(scheduleWorkspace, /'schedules' \| 'schedule-detail'/)
  assert.match(app, /scheduleState=\{uiReview\.enabled \? uiReview\.schedules : undefined\}/)
  assert.doesNotMatch(workspace, /'runs' \| 'schedules'/)
  assert.doesNotMatch(workspace, /ScheduleList/)

  assert.match(scheduleList, /WorkflowSchedule/)
  assert.match(scheduleList, /toggle/)
  assert.match(scheduleList, /cronDescribe/)
  assert.match(scheduleDetail, /scheduledBy/)
  assert.match(scheduleDetail, /onOpenRun/)
  assert.match(scheduleDrawer, /cronValidate/)
  assert.match(scheduleDrawer, /cronDescribe/)
  assert.match(scheduleDrawer, /save\(/)
  assert.match(useSchedules, /listSchedules/)
  assert.match(useSchedules, /saveSchedule/)
  assert.match(useSchedules, /toggleSchedule/)
  assert.match(useSchedules, /export interface UseSchedulesResult/)
  assert.match(settings, /minimizeToTray/)
  assert.match(runList, /scheduledBy/)
  assert.match(runList, /\[scheduled\]/)
  assert.match(styles, /schedule-dashboard-page/)
  assert.match(styles, /schedule-list/)
  assert.match(styles, /schedule-detail/)
})

test('schedule cron builder generates parser-compatible cron from simple picker state', async () => {
  const { buildScheduleCron, defaultScheduleCronState, scheduleCronStateFromPreset } =
    await importTs('src/renderer/src/scheduleCronBuilder.ts')
  const { isValidCron } = await importTs('src/main/cronParser.ts')

  const workdays = buildScheduleCron(scheduleCronStateFromPreset('workday'))
  assert.equal(workdays.cron, '0 9 * * 1,2,3,4,5')
  assert.equal(workdays.summary, '工作日 09:00')
  assert.equal(isValidCron(workdays.cron), true)

  const daily = buildScheduleCron(scheduleCronStateFromPreset('daily'))
  assert.equal(daily.cron, '0 9 * * *')
  assert.equal(daily.summary, '每天 09:00')
  assert.equal(isValidCron(daily.cron), true)

  const hourly = buildScheduleCron(scheduleCronStateFromPreset('hourly'))
  assert.equal(hourly.cron, '0 */2 * * *')
  assert.equal(hourly.summary, '每 2 小时第 00 分钟')
  assert.equal(isValidCron(hourly.cron), true)

  const offsetMinutes = buildScheduleCron({
    ...defaultScheduleCronState(),
    mode: 'minutes',
    minuteEvery: 15,
    minuteStart: 5
  })
  assert.equal(offsetMinutes.cron, '5,20,35,50 * * * *')
  assert.equal(offsetMinutes.summary, '每 15 分钟')
  assert.equal(isValidCron(offsetMinutes.cron), true)

  const monthly = buildScheduleCron({
    ...defaultScheduleCronState(),
    mode: 'months',
    monthDay: 1,
    monthlyTime: '09:00'
  })
  assert.equal(monthly.cron, '0 9 1 * *')
  assert.equal(monthly.summary, '每月 1 日 09:00')
  assert.equal(isValidCron(monthly.cron), true)
})

test('schedule drawer uses n8n-style interval picker instead of requiring cron first', () => {
  const scheduleDrawer = source('src/renderer/src/ScheduleDrawer.tsx')
  const styles = source('src/renderer/src/styles.css')

  assert.match(scheduleDrawer, /Trigger Interval/)
  assert.match(scheduleDrawer, /scheduleCronStateFromPreset/)
  assert.match(scheduleDrawer, /Every X minutes/)
  assert.match(scheduleDrawer, /Every X hours/)
  assert.match(scheduleDrawer, /Every day/)
  assert.match(scheduleDrawer, /Every week/)
  assert.match(scheduleDrawer, /Every month/)
  assert.match(scheduleDrawer, /Custom cron/)
  assert.match(scheduleDrawer, /工作日早上/)
  assert.match(scheduleDrawer, /buildScheduleCron/)
  assert.match(scheduleDrawer, /自动生成/)
  assert.match(scheduleDrawer, /Select\.Item/)
  assert.doesNotMatch(scheduleDrawer, /<select\b/)
  assert.doesNotMatch(scheduleDrawer, /<option\b/)
  assert.match(styles, /schedule-picker-box/)
  assert.match(styles, /schedule-preset-grid/)
  assert.match(styles, /schedule-weekday-chips/)
})
