import { createRequire } from 'node:module'
import { basename, join, resolve } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import net from 'node:net'

const require = createRequire(import.meta.url)
const ELECTRON_SMOKE_PREFIX = 'open-novel-electron-smoke-'
const MAX_CAPTURED_OUTPUT = 50000

export const buildElectronArgs = ({ mainPath, userDataDir, port }) => [
  mainPath,
  `--user-data-dir=${userDataDir}`,
  '--remote-debugging-address=127.0.0.1',
  `--remote-debugging-port=${port}`
]

export const buildKillTreeArgs = (pid) => ['/PID', String(pid), '/T', '/F']

export const buildNpmScriptInvocation = (script, {
  platform = process.platform,
  nodeExecutable = process.execPath,
  npmExecutable = process.env.npm_execpath,
  commandInterpreter = process.env.ComSpec ?? 'cmd.exe'
} = {}) => {
  if (npmExecutable) {
    return {
      command: nodeExecutable,
      args: [npmExecutable, 'run', script]
    }
  }
  if (platform === 'win32') {
    return {
      command: commandInterpreter,
      args: ['/d', '/s', '/c', `npm.cmd run ${script}`]
    }
  }
  return {
    command: 'npm',
    args: ['run', script]
  }
}

export const isOwnedSmokeDirectory = (directory) =>
  basename(directory).startsWith(ELECTRON_SMOKE_PREFIX)

const appendOutput = (current, chunk) => {
  const next = `${current}${chunk.toString('utf8')}`
  return next.length <= MAX_CAPTURED_OUTPUT ? next : next.slice(-MAX_CAPTURED_OUTPUT)
}

export const spawnTrackedProcess = (command, args, {
  cwd,
  env = process.env
} = {}) => {
  const child = spawn(command, args, {
    cwd,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const logs = { stdout: '', stderr: '' }
  child.stdout?.on('data', (chunk) => { logs.stdout = appendOutput(logs.stdout, chunk) })
  child.stderr?.on('data', (chunk) => { logs.stderr = appendOutput(logs.stderr, chunk) })
  const exit = new Promise((resolveExit) => {
    let settled = false
    const settle = (result) => {
      if (settled) return
      settled = true
      resolveExit(result)
    }
    child.once('error', (error) => settle({ code: null, signal: null, error }))
    child.once('exit', (code, signal) => settle({ code, signal }))
  })
  return { child, command, args, logs, exit }
}

export const waitForExit = async (record, timeoutMs = 30000) => {
  let timer
  try {
    return await Promise.race([
      record.exit,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Process timed out after ${timeoutMs}ms`)), timeoutMs)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

export const terminateProcessTree = async (record, timeoutMs = 10000) => {
  if (record?.child === undefined || record.child.exitCode !== null || record.child.signalCode !== null) {
    return record?.exit
  }

  if (process.platform === 'win32' && typeof record.child.pid === 'number') {
    const killer = spawnTrackedProcess('taskkill.exe', buildKillTreeArgs(record.child.pid), {
      cwd: process.cwd()
    })
    await waitForExit(killer, timeoutMs).catch(() => undefined)
  } else {
    record.child.kill('SIGTERM')
  }

  return waitForExit(record, timeoutMs).catch(() => undefined)
}

export const runCommand = async (command, args, {
  cwd,
  env,
  timeoutMs = 120000
} = {}) => {
  const record = spawnTrackedProcess(command, args, { cwd, env })
  try {
    const result = await waitForExit(record, timeoutMs)
    if (result.code !== 0) {
      throw Object.assign(new Error(`Command failed: ${command}`), { record, result })
    }
    return record
  } catch (error) {
    if (error?.record !== record) await terminateProcessTree(record)
    throw error
  }
}

export const allocatePort = async () => new Promise((resolvePort, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    server.close((error) => {
      if (error) reject(error)
      else resolvePort(address.port)
    })
  })
})

export const createSmokeUserDataDirectory = async () => mkdtemp(join(tmpdir(), ELECTRON_SMOKE_PREFIX))

export const removeSmokeUserDataDirectory = async (directory) => {
  if (!isOwnedSmokeDirectory(directory)) throw new Error('Refusing to remove an unowned smoke directory')
  await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}

export const resolveElectronBinary = () => require('electron')

export const spawnElectronProcess = ({ cwd, userDataDir, port }) => {
  const mainPath = resolve(cwd, 'out/main/index.js')
  return spawnTrackedProcess(resolveElectronBinary(), buildElectronArgs({ mainPath, userDataDir, port }), { cwd })
}
