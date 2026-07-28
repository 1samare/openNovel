import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'

const ignoredDirectories = new Set([
  '.git',
  '.worktrees',
  '.superpowers',
  'node_modules',
  'out',
  'dist',
  'coverage',
  '.cache',
  'cache',
  '.tmp',
  'tmp',
  '.temp',
  'temp'
])

const gitFiles = (args) => {
  try {
    return execFileSync('git', args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
      .split('\0')
      .filter(Boolean)
  } catch {
    return []
  }
}

const isMaintained = (path) => !path.split('/').some((segment) => ignoredDirectories.has(segment))

const directoryFor = (path) => {
  const directory = dirname(path)
  return directory === '.' ? '.' : directory.replaceAll('\\', '/')
}

const readmeFor = (directory) => (directory === '.' ? 'README.md' : `${directory}/README.md`)

const directoriesFor = (paths) => new Set(paths.filter(isMaintained).map(directoryFor))

const resolveBaseReference = () => {
  if (process.env.README_CHECK_BASE) {
    return process.env.README_CHECK_BASE
  }

  if (!process.env.GITHUB_BASE_REF) {
    return undefined
  }

  const remoteReference = `origin/${process.env.GITHUB_BASE_REF}`
  return gitFiles(['rev-parse', '--verify', '--quiet', remoteReference]).length > 0
    ? remoteReference
    : process.env.GITHUB_BASE_REF
}

const trackedFiles = gitFiles(['ls-files', '-z'])
const changedFiles = new Set([
  ...gitFiles(['diff', '--name-only', '-z']),
  ...gitFiles(['diff', '--cached', '--name-only', '-z']),
  ...gitFiles(['ls-files', '--others', '--exclude-standard', '-z'])
])
const baseReference = resolveBaseReference()

if (baseReference) {
  for (const file of gitFiles(['diff', '--name-only', '-z', `${baseReference}...HEAD`])) {
    changedFiles.add(file)
  }
}

const missingReadmes = [...directoriesFor(trackedFiles)]
  .filter((directory) => !existsSync(resolve(process.cwd(), readmeFor(directory))))
  .sort()

const staleReadmes = [...directoriesFor([...changedFiles])]
  .filter((directory) => !changedFiles.has(readmeFor(directory)))
  .sort()

if (missingReadmes.length === 0 && staleReadmes.length === 0) {
  console.log('README directory contract passed.')
} else {
  console.error('README directory contract failed:')

  if (missingReadmes.length > 0) {
    console.error(`Missing README.md: ${missingReadmes.join(', ')}`)
  }

  if (staleReadmes.length > 0) {
    console.error(`README.md was not changed with: ${staleReadmes.join(', ')}`)
  }

  process.exitCode = 1
}
