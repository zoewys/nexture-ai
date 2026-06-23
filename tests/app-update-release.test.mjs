import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

const source = (relativePath) => readFileSync(join(root, relativePath), 'utf8')

test('main, preload, and settings expose app update controls', () => {
  const types = source('src/shared/types.ts')
  const ipc = source('src/main/ipc.ts')
  const mainIndex = source('src/main/index.ts')
  const preload = source('src/preload/index.ts')
  const settings = source('src/renderer/src/SettingsPanel.tsx')

  assert.equal(existsSync(join(root, 'src/main/appUpdater.ts')), true)
  const updater = source('src/main/appUpdater.ts')

  assert.match(types, /export interface AppUpdateState/)
  assert.match(types, /appVersionGet: 'app:version:get'/)
  assert.match(types, /appUpdateCheck: 'app:update:check'/)
  assert.match(types, /appUpdateInstall: 'app:update:install'/)
  assert.match(types, /appUpdateEvent: 'app:update:event'/)

  assert.match(updater, /autoUpdater/)
  assert.match(updater, /checkForUpdates/)
  assert.match(updater, /quitAndInstall/)
  assert.match(updater, /app\.isPackaged/)

  assert.match(mainIndex, /configureAppUpdater/)
  assert.match(mainIndex, /checkForAppUpdates\(\{ silent: true \}\)/)
  assert.match(ipc, /IPC\.appVersionGet/)
  assert.match(ipc, /IPC\.appUpdateCheck/)
  assert.match(ipc, /IPC\.appUpdateInstall/)
  assert.match(preload, /getAppVersion/)
  assert.match(preload, /checkForUpdates/)
  assert.match(preload, /installUpdate/)
  assert.match(preload, /onAppUpdateEvent/)
  assert.match(settings, /RefreshCw/)
  assert.match(settings, /checkForUpdates/)
  assert.match(settings, /installUpdate/)
})

test('release workflow builds and publishes macOS and Windows packages from git tags', () => {
  const pkg = JSON.parse(source('package.json'))
  const builder = source('electron-builder.yml')

  assert.equal(existsSync(join(root, '.github/workflows/release.yml')), true)
  const workflow = source('.github/workflows/release.yml')

  assert.match(builder, /publish:\s*\n\s*provider:\s*github/)
  assert.match(builder, /owner:\s*zoewys/)
  assert.match(builder, /repo:\s*nexture-ai/)
  assert.match(builder, /mac:[\s\S]*-\s*dmg[\s\S]*-\s*zip/)
  assert.match(builder, /win:[\s\S]*-\s*nsis/)
  assert.match(builder, /portable:/)

  assert.equal(pkg.scripts['release:mac'], 'npm run build && electron-builder --mac --publish always')
  assert.equal(pkg.scripts['release:win'], 'npm run build && electron-builder --win --x64 --publish always')

  assert.match(workflow, /tags:\s*\n\s*-\s*'v\*'/)
  assert.match(workflow, /contents:\s*write/)
  assert.match(workflow, /macos-latest/)
  assert.match(workflow, /windows-latest/)
  assert.match(workflow, /pnpm\/action-setup@v4/)
  assert.match(workflow, /pnpm run release:mac/)
  assert.match(workflow, /pnpm run release:win/)
  assert.match(workflow, /GH_TOKEN:\s*\$\{\{ secrets\.GITHUB_TOKEN \}\}/)
})
