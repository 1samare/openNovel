import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createChapterRuntime } from '../src/main/chapter-runtime.ts'
import { ProjectService } from '../src/novel/project-service.ts'

test('uses system-selected files for import/export and rejects changed previews', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-chapter-runtime-'))
  const projectRoot = join(sandbox, 'project')
  const importPath = join(sandbox, '导入.md')
  const referencePath = join(sandbox, '资料.txt')
  const invalidUtf8Path = join(sandbox, '损坏.txt')
  const exportPath = join(sandbox, '导出.md')
  await writeFile(importPath, '# 第一章\n\n雨落下来。', 'utf8')
  await writeFile(referencePath, '人物资料。', 'utf8')
  await writeFile(invalidUtf8Path, new Uint8Array([0xc3, 0x28]))
  let selectedImport = importPath
  const projectService = await ProjectService.start(join(sandbox, 'control.sqlite3'))
  await projectService.create({ root: projectRoot, title: '星海来信' })
  const runtime = createChapterRuntime({
    project: projectService,
    senderPolicy: { appPageUrl: 'file:///app/renderer/index.html' },
    dialogs: {
      chooseImportFile: async () => selectedImport,
      chooseExportFile: async () => exportPath
    },
    now: () => '2026-08-10T06:00:00.000Z'
  })
  t.after(async () => {
    await runtime.close()
    await projectService.shutdown()
    await rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
  })

  const previewResult = await runtime.previewImport({
    mode: 'split-chapters',
    text: null,
    sourceName: null
  })
  assert.equal(previewResult.ok, true)
  assert.equal(previewResult.data.format, 'markdown')
  assert.deepEqual(previewResult.data.chapters.map(({ title }) => title), ['第一章'])

  const changed = structuredClone(previewResult.data)
  changed.chapters[0].content = '被篡改的正文'
  changed.chapters[0].characterCount = 6
  const rejected = await runtime.confirmImport(changed)
  assert.equal(rejected.ok, false)
  assert.equal(rejected.error.code, 'INVALID_PROJECT_COMMAND')

  const confirmed = await runtime.confirmImport(previewResult.data)
  assert.equal(confirmed.ok, true)
  assert.deepEqual(confirmed.data.map(({ title }) => title), ['第一章'])

  const exported = await runtime.exportBook('markdown')
  assert.equal(exported.ok, true)
  assert.equal(exported.data.path, exportPath)
  assert.equal(await readFile(exportPath, 'utf8'), '# 星海来信\n\n## 第一章\n\n雨落下来。\n')

  selectedImport = referencePath
  const reference = await runtime.previewImport({ mode: 'reference', text: null, sourceName: null })
  assert.equal(reference.ok, true)
  const savedReference = await runtime.confirmImport(reference.data)
  assert.deepEqual(savedReference, { ok: true, data: [] })
  const attachments = join(projectRoot, 'attachments')
  const attachmentName = (await import('node:fs/promises')).readdir(attachments).then((items) => items[0])
  await access(join(attachments, await attachmentName))
  assert.equal(await readFile(join(attachments, await attachmentName), 'utf8'), '人物资料。')

  selectedImport = invalidUtf8Path
  const invalidUtf8 = await runtime.previewImport({ mode: 'single-chapter', text: null, sourceName: null })
  assert.deepEqual(invalidUtf8, {
    ok: false,
    error: { code: 'CHAPTER_OPERATION_FAILED', message: 'Chapter operation failed' }
  })
})

test('returns a safe project-not-open result without touching dialogs', async () => {
  const runtime = createChapterRuntime({
    project: { current: () => undefined },
    senderPolicy: {},
    dialogs: {
      chooseImportFile: async () => assert.fail('dialog should not open'),
      chooseExportFile: async () => assert.fail('dialog should not open')
    }
  })
  const result = await runtime.list()
  assert.deepEqual(result, {
    ok: false,
    error: { code: 'PROJECT_NOT_OPEN', message: 'Chapter operation failed' }
  })
  await runtime.close()
})
