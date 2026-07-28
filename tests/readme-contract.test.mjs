import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const projectFile = (path) => new URL(`../${path}`, import.meta.url)
const checkerPath = fileURLToPath(projectFile('scripts/check-readmes.mjs'))

const run = (cwd, command, args) => execFileSync(command, args, { cwd, encoding: 'utf8' })

const writeFixtureFile = async (directory, path, content = '') => {
  const file = join(directory, path)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, content, 'utf8')
}

const createRepository = async (files) => {
  const directory = await mkdtemp(join(tmpdir(), 'open-novel-readmes-'))

  run(directory, 'git', ['init', '--quiet'])
  run(directory, 'git', ['config', 'user.email', 'tests@example.com'])
  run(directory, 'git', ['config', 'user.name', 'README contract tests'])
  run(directory, 'git', ['config', 'core.autocrlf', 'false'])

  for (const [path, content] of Object.entries(files)) {
    await writeFixtureFile(directory, path, content)
  }

  run(directory, 'git', ['add', '.'])
  run(directory, 'git', ['commit', '--quiet', '-m', 'fixture'])
  return directory
}

const runChecker = (cwd, environment = {}) => {
  try {
    return {
      status: 0,
      output: execFileSync(process.execPath, [checkerPath], {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, ...environment }
      })
    }
  } catch (error) {
    return {
      status: error.status,
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`
    }
  }
}

test('reports a tracked maintained directory without a README', async (t) => {
  const directory = await createRepository({
    'README.md': '# fixture\n',
    'src/app.mjs': 'export {}\n'
  })
  t.after(() => rm(directory, { recursive: true, force: true }))

  const result = runChecker(directory)

  assert.equal(result.status, 1)
  assert.match(result.output, /src/)
})

test('requires a README change when a tracked file changes', async (t) => {
  const directory = await createRepository({
    'README.md': '# fixture\n',
    'src/README.md': '# src\n',
    'src/app.mjs': 'export const version = 1\n'
  })
  t.after(() => rm(directory, { recursive: true, force: true }))

  await writeFixtureFile(directory, 'src/app.mjs', 'export const version = 2\n')
  const staleResult = runChecker(directory)

  assert.equal(staleResult.status, 1)
  assert.match(staleResult.output, /src/)

  await writeFixtureFile(directory, 'src/README.md', '# src\n\n- Updated with app changes.\n')
  const synchronizedResult = runChecker(directory)

  assert.equal(synchronizedResult.status, 0)
})

test('requires README synchronization for staged and untracked directory changes', async (t) => {
  const directory = await createRepository({
    'README.md': '# fixture\n',
    'docs/README.md': '# docs\n'
  })
  t.after(() => rm(directory, { recursive: true, force: true }))

  await writeFixtureFile(directory, 'scripts/step.mjs', 'export {}\n')
  run(directory, 'git', ['add', 'scripts/step.mjs'])
  await writeFixtureFile(directory, 'docs/note.md', '# note\n')

  const staleResult = runChecker(directory)

  assert.equal(staleResult.status, 1)
  assert.match(staleResult.output, /scripts/)
  assert.match(staleResult.output, /docs/)

  await writeFixtureFile(directory, 'scripts/README.md', '# scripts\n')
  await writeFixtureFile(directory, 'docs/README.md', '# docs\n\n- Updated with note.\n')
  const synchronizedResult = runChecker(directory)

  assert.equal(synchronizedResult.status, 0)
})

test('uses README_CHECK_BASE to include changes from the configured base reference', async (t) => {
  const directory = await createRepository({
    'README.md': '# fixture\n',
    'src/README.md': '# src\n',
    'src/app.mjs': 'export const version = 1\n'
  })
  t.after(() => rm(directory, { recursive: true, force: true }))

  run(directory, 'git', ['branch', '-M', 'main'])
  run(directory, 'git', ['checkout', '--quiet', '-b', 'feature/readme-check'])
  await writeFixtureFile(directory, 'src/app.mjs', 'export const version = 2\n')
  run(directory, 'git', ['add', 'src/app.mjs'])
  run(directory, 'git', ['commit', '--quiet', '-m', 'change app'])

  const result = runChecker(directory, { README_CHECK_BASE: 'main' })

  assert.equal(result.status, 1)
  assert.match(result.output, /src/)

  const githubResult = runChecker(directory, { GITHUB_BASE_REF: 'main' })

  assert.equal(githubResult.status, 1)
  assert.match(githubResult.output, /src/)
})
