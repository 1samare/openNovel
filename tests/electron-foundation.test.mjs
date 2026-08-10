import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const projectFile = (path) => new URL(`../${path}`, import.meta.url)
const readProjectFile = (path) => readFile(projectFile(path), 'utf8')

test('Electron 窗口采用隔离且无 Node 注入的安全默认值', async () => {
  const source = await readProjectFile('src/main/index.ts')

  assert.match(source, /contextIsolation:\s*true/)
  assert.match(source, /nodeIntegration:\s*false/)
  assert.match(source, /sandbox:\s*true/)
  assert.match(source, /setWindowOpenHandler/)
  assert.match(source, /preload:\s*join\(__dirname, '\.\.\/preload\/index\.cjs'\)/)
})

test('沙箱 Preload 显式构建为 CommonJS 工件', async () => {
  const source = await readProjectFile('electron.vite.config.ts')

  assert.match(source, /preload:\s*\{[\s\S]*?rollupOptions:\s*\{[\s\S]*?output:\s*\{[\s\S]*?format:\s*'cjs'/)
  assert.match(source, /entryFileNames:\s*'\[name\]\.cjs'/)
})

test('主进程持有活动窗口引用直到窗口关闭', async () => {
  const source = await readProjectFile('src/main/index.ts')

  assert.match(source, /const activeWindows = new Set<BrowserWindow>\(\)/)
  assert.match(source, /activeWindows\.add\(mainWindow\)/)
  assert.match(source, /mainWindow\.once\('closed', \(\) => activeWindows\.delete\(mainWindow\)\)/)
})

test('生产入口为 Mock 流注入可中止的片段延迟', async () => {
  const source = await readProjectFile('src/main/index.ts')

  assert.match(source, /const delayMockChunk = \(signal: AbortSignal\): Promise<void>/)
  assert.match(source, /signal\.addEventListener\('abort', finish, \{ once: true \}\)/)
  assert.match(source, /executorDelay:\s*delayMockChunk/)
})

test('预加载层仅暴露命名 Agent/Project/Chapter/Model 桥接且不暴露通用 Electron 或 Node API', async () => {
  const source = await readProjectFile('src/preload/index.ts')

  assert.match(source, /contextBridge\.exposeInMainWorld\(\s*'openNovel'/)
  assert.match(source, /agent:\s*createAgentApi\(ipcRenderer\)/)
  assert.match(source, /projects:\s*createProjectApi\(ipcRenderer\)/)
  assert.match(source, /chapters:\s*createChapterApi\(ipcRenderer\)/)
  assert.match(source, /models:\s*createModelApi\(ipcRenderer\)/)
  assert.match(source, /lifecycle:\s*createRendererFlushApi\(ipcRenderer\)/)
  assert.doesNotMatch(source, /exposeInMainWorld\(\s*['"](?:electron|ipcRenderer|node)['"]/)
  assert.doesNotMatch(source, /require\s*\(/)
  assert.match(source, /process\.contextIsolated/)
})

test('主进程组合项目与章节数据库、固定 IPC 和异步退出等待', async () => {
  const source = await readProjectFile('src/main/index.ts')

  assert.match(source, /ProjectService\.start/)
  assert.match(source, /registerProjectIpcHandlers/)
  assert.match(source, /createChapterRuntime/)
  assert.match(source, /registerChapterIpcHandlers/)
  assert.match(source, /createProjectShutdownGate/)
  assert.match(source, /await flushActiveRenderers\(\)/)
  assert.match(source, /app\.on\('before-quit'/)
})

test('控制数据库启动失败时显示安全恢复提示并清理后退出', async () => {
  const source = await readProjectFile('src/main/index.ts')

  assert.match(source, /应用启动失败/)
  assert.match(source, /await shutdownApplicationResources\(\)\.catch/)
  assert.match(source, /dialog\.showMessageBox\(\{[\s\S]*?安全退出/)
  assert.match(source, /app\.quit\(\)/)
})

test('依赖安装后显式准备 Electron 二进制', async () => {
  const manifest = JSON.parse(await readProjectFile('package.json'))

  assert.equal(manifest.scripts.postinstall, 'install-electron')
  assert.equal(manifest.config.electron_mirror, 'https://npmmirror.com/mirrors/electron/')
})

test('类型检查配置不在项目根目录生成构建缓存', async () => {
  const nodeConfig = JSON.parse(await readProjectFile('tsconfig.node.json'))
  const webConfig = JSON.parse(await readProjectFile('tsconfig.web.json'))

  assert.equal(nodeConfig.compilerOptions.composite, undefined)
  assert.equal(webConfig.compilerOptions.composite, undefined)
})
