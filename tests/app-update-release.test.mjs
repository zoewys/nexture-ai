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
  assert.doesNotMatch(updater, /import\s*\{\s*autoUpdater[\s,}]/)
  assert.match(updater, /import electronUpdater from 'electron-updater'/)
  assert.match(updater, /const \{ autoUpdater \} = electronUpdater/)
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

test('release workflow builds Windows from git tags; macOS published from a signed local build', () => {
  const pkg = JSON.parse(source('package.json'))
  const builder = source('electron-builder.yml')
  const workspace = source('pnpm-workspace.yaml')

  assert.equal(existsSync(join(root, '.github/workflows/release.yml')), true)
  const workflow = source('.github/workflows/release.yml')

  assert.match(builder, /publish:\s*\n\s*provider:\s*github/)
  assert.match(builder, /owner:\s*zoewys/)
  assert.match(builder, /repo:\s*nexture-ai/)
  assert.match(builder, /releaseType:\s*release/)
  assert.match(builder, /mac:[\s\S]*-\s*dmg[\s\S]*-\s*zip/)
  assert.match(builder, /win:[\s\S]*-\s*nsis/)
  assert.match(builder, /portable:/)

  assert.equal(pkg.scripts['release:mac'], 'npm run build && electron-builder --mac --publish always')
  assert.equal(pkg.scripts['release:win'], 'npm run build && electron-builder --win --x64 --publish always')
  assert.equal(pkg.packageManager, 'pnpm@10.32.1')

  assert.match(workflow, /tags:\s*\n\s*-\s*'v\*'/)
  assert.match(workflow, /contents:\s*write/)
  assert.doesNotMatch(workflow, /runs-on:\s*macos/)
  assert.match(workflow, /windows-latest/)
  assert.match(workflow, /pnpm\/action-setup@v6/)
  assert.match(workflow, /version:\s*10\.32\.1/)
  assert.match(workflow, /pnpm config set store-dir \.pnpm-store/)
  assert.doesNotMatch(workflow, /cache:\s*pnpm/)
  assert.match(workflow, /ELECTRON_SKIP_BINARY_DOWNLOAD:\s*'1'/)
  assert.match(workflow, /node --test tests\/app-update-release\.test\.mjs/)
  assert.doesNotMatch(workflow, /pnpm test/)
  assert.doesNotMatch(workflow, /electron-builder --mac/)
  assert.match(workflow, /pnpm exec electron-builder --win --x64 --publish never/)
  assert.match(workflow, /actions\/upload-artifact@v4/)
  assert.match(workflow, /actions\/download-artifact@v4/)
  assert.match(workflow, /latest\.yml/)
  assert.match(workflow, /gh release create/)
  assert.match(workflow, /gh release upload/)
  assert.match(workflow, /GH_TOKEN:\s*\$\{\{ secrets\.GITHUB_TOKEN \}\}/)
  assert.match(workflow, /GH_REPO:\s*\$\{\{ github\.repository \}\}/)

  assert.match(workspace, /packages:\s*\n\s*-\s*'\.'/)
  assert.doesNotMatch(workspace, /storeDir:\s*\/Users\//)
})
