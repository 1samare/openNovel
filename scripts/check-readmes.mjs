import { existsSync, readFileSync } from 'node:fs'
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
const requiredReadmeHeadings = ['目录用途', '内容说明', '依赖边界', '维护规则', '变更同步']

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

const ancestorDirectoriesFor = (path) => {
  const directories = []
  let directory = directoryFor(path)

  while (true) {
    directories.push(directory)

    if (directory === '.') {
      return directories
    }

    directory = directoryFor(directory)
  }
}

const maintainedDirectoriesFor = (paths) => new Set(
  paths
    .filter(isMaintained)
    .flatMap(ancestorDirectoriesFor)
)

const changedDirectoriesFor = (paths) => new Set(paths.filter(isMaintained).map(directoryFor))

const resolveBaseReference = () => {
  if (process.env.README_CHECK_BASE) {
    return process.env.README_CHECK_BASE
  }

  if (!process.env.GITHUB_BASE_REF) {
    return process.env.GITHUB_EVENT_BEFORE && !/^0+$/.test(process.env.GITHUB_EVENT_BEFORE)
      ? process.env.GITHUB_EVENT_BEFORE
      : undefined
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

const maintainedDirectories = maintainedDirectoriesFor(trackedFiles)
const missingReadmes = [...maintainedDirectories]
  .filter((directory) => !existsSync(resolve(process.cwd(), readmeFor(directory))))
  .sort()

const incompleteReadmes = [...maintainedDirectories]
  .map(readmeFor)
  .filter((readme) => existsSync(resolve(process.cwd(), readme)))
  .filter((readme) => {
    const content = readFileSync(resolve(process.cwd(), readme), 'utf8')
    return requiredReadmeHeadings.some((heading) => !new RegExp(`^## ${heading}$`, 'm').test(content))
  })
  .sort()

const staleReadmes = [...changedDirectoriesFor([...changedFiles])]
  .filter((directory) => !changedFiles.has(readmeFor(directory)))
  .sort()

if (missingReadmes.length === 0 && incompleteReadmes.length === 0 && staleReadmes.length === 0) {
  console.log('README directory contract passed.')
} else {
  console.error('README directory contract failed:')

  if (missingReadmes.length > 0) {
    console.error(`Missing README.md: ${missingReadmes.join(', ')}`)
  }

  if (incompleteReadmes.length > 0) {
    console.error(`README.md is missing required sections: ${incompleteReadmes.join(', ')}`)
  }

  if (staleReadmes.length > 0) {
    console.error(`README.md was not changed with: ${staleReadmes.join(', ')}`)
  }

  process.exitCode = 1
}
