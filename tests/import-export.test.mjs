import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { unzipSync } from 'fflate'

import { renderDocx, renderMarkdown, renderText } from '../src/export/export-service.ts'
import { previewImport, writeReferenceAttachment } from '../src/export/import-service.ts'
import { ChapterService } from '../src/novel/chapter-service.ts'
import { DatabaseWorkerClient } from '../src/novel/database-worker.ts'
import { ProjectDomainError } from '../src/shared/project.ts'

const openService = async (t, options = {}) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-import-export-'))
  const databasePath = join(sandbox, 'project.sqlite3')
  const database = await DatabaseWorkerClient.open(databasePath)
  await database.run(
    'INSERT INTO projects (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ['project-1', '星海来信', '2026-08-10T04:00:00.000Z', '2026-08-10T04:00:00.000Z']
  )
  await database.close()
  let id = 0
  let second = 0
  const service = await ChapterService.open(databasePath, 'project-1', {
    createId: options.createId ?? (() => `exchange-${++id}`),
    now: () => `2026-08-10T04:00:${String(second++).padStart(2, '0')}.000Z`
  })
  t.after(async () => {
    await service.close()
    await rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
  })
  return service
}

test('previews UTF-8 TXT chapters with BOM, CRLF, preface, and Chinese headings', () => {
  const preview = previewImport({
    sourceName: '旧稿.txt',
    format: 'txt',
    mode: 'split-chapters',
    text: '\uFEFF写在前面。\r\n\r\n第1章 雨夜\r\n雨落下来。\r\n\r\n第二章 重逢\r\n灯亮了。'
  })

  assert.deepEqual(preview.chapters.map(({ title, content, characterCount }) => ({
    title,
    content,
    characterCount
  })), [
    { title: '前言', content: '写在前面。', characterCount: 4 },
    { title: '第1章 雨夜', content: '雨落下来。', characterCount: 4 },
    { title: '第二章 重逢', content: '灯亮了。', characterCount: 3 }
  ])
})

test('previews ATX and Setext Markdown headings without inventing empty chapters', () => {
  const preview = previewImport({
    sourceName: 'outline.md',
    format: 'markdown',
    mode: 'split-chapters',
    text: '# 第一章 出发\n\n正文一。\n\n第二章 抵达\n---\n\n正文二。\n\n# 空标题后无正文'
  })

  assert.deepEqual(preview.chapters.map(({ title, content }) => ({ title, content })), [
    { title: '第一章 出发', content: '正文一。' },
    { title: '第二章 抵达', content: '正文二。' }
  ])
})

test('recognizes Markdown headings in pasted split-chapter content', () => {
  const preview = previewImport({
    sourceName: '粘贴内容',
    format: 'paste',
    mode: 'split-chapters',
    text: '# 第一章\n正文一。\n\n第二章\n---\n正文二。'
  })

  assert.deepEqual(preview.chapters.map(({ title, content }) => ({ title, content })), [
    { title: '第一章', content: '正文一。' },
    { title: '第二章', content: '正文二。' }
  ])
})

test('uses the source name for single chapter and keeps reference text out of chapters', () => {
  const chapter = previewImport({
    sourceName: '  终章.md  ',
    format: 'paste',
    mode: 'single-chapter',
    text: '  回声停在门外。  '
  })
  const reference = previewImport({
    sourceName: '资料.txt',
    format: 'txt',
    mode: 'reference',
    text: '地点资料。'
  })

  assert.deepEqual(chapter.chapters.map(({ title, content }) => ({ title, content })), [
    { title: '终章', content: '回声停在门外。' }
  ])
  assert.equal(reference.referenceContent, '地点资料。')
  assert.deepEqual(reference.chapters, [])
})

test('writes a reference inside attachments with a safe UTF-8 filename', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-reference-'))
  t.after(() => rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 }))
  const preview = previewImport({
    sourceName: '..\\人物资料.txt',
    format: 'txt',
    mode: 'reference',
    text: '林澈，十八岁。'
  })

  const saved = await writeReferenceAttachment({
    attachmentsRoot: sandbox,
    preview,
    fileId: 'reference-1'
  })
  assert.equal(saved.relativePath, 'reference-1-人物资料.txt')
  assert.equal(await readFile(join(sandbox, saved.relativePath), 'utf8'), '林澈，十八岁。')
})

test('confirms the exact preview in one transaction and rolls back duplicate ids', async (t) => {
  const preview = previewImport({
    sourceName: '导入.txt',
    format: 'txt',
    mode: 'split-chapters',
    text: '第一章\n甲。\n第二章\n乙。'
  })
  const service = await openService(t)
  const imported = await service.confirmImport(preview)
  assert.deepEqual(imported.map(({ title }) => title), ['第一章', '第二章'])
  assert.deepEqual(await Promise.all(imported.map(async ({ id }) => (await service.load(id)).content)), ['甲。', '乙。'])

  const failing = await openService(t, { createId: () => 'duplicate-id' })
  await assert.rejects(failing.confirmImport(preview), (error) => {
    assert.equal(error instanceof ProjectDomainError, true)
    assert.equal(error.code, 'DATABASE_TRANSACTION_FAILED')
    return true
  })
  assert.deepEqual(await failing.listTree(), [])
})

test('renders TXT and Markdown from one ordered database snapshot', async (t) => {
  const service = await openService(t)
  const volume = await service.create({ kind: 'volume', title: '第一卷 启程' })
  const first = await service.create({ kind: 'chapter', parentId: volume.chapter.id, title: '第一章 雨夜' })
  const second = await service.create({ kind: 'chapter', parentId: volume.chapter.id, title: '第二章 清晨' })
  await service.saveDraft({ chapterId: first.chapter.id, content: '雨落下来。', expectedRevision: 0 })
  await service.saveDraft({ chapterId: second.chapter.id, content: '天亮了。', expectedRevision: 0 })

  const snapshot = await service.exportSnapshot()
  const text = new TextDecoder().decode(renderText(snapshot))
  const markdown = new TextDecoder().decode(renderMarkdown(snapshot))
  assert.equal(snapshot.chapters.reduce((sum, chapter) => sum + chapter.characterCount, 0), 7)
  assert.equal(text, '星海来信\r\n\r\n第一卷 启程\r\n\r\n第一章 雨夜\r\n\r\n雨落下来。\r\n\r\n第二章 清晨\r\n\r\n天亮了。\r\n')
  assert.equal(markdown, '# 星海来信\n\n## 第一卷 启程\n\n### 第一章 雨夜\n\n雨落下来。\n\n### 第二章 清晨\n\n天亮了。\n')
})

test('renders a macro-free DOCX with the same book, volume, chapter, and body order', async () => {
  const snapshot = {
    projectId: 'project-1',
    title: '星海来信',
    createdAt: '2026-08-10T04:00:00.000Z',
    chapters: [
      { id: 'chapter-1', title: '第一章 雨夜', volumeTitle: '第一卷 启程', content: '雨落下来。', characterCount: 4 },
      { id: 'chapter-2', title: '第二章 清晨', volumeTitle: '第一卷 启程', content: '天亮了。', characterCount: 3 }
    ]
  }
  const archive = unzipSync(await renderDocx(snapshot))
  const xml = new TextDecoder().decode(archive['word/document.xml'])

  assert.equal('word/vbaProject.bin' in archive, false)
  const ordered = ['星海来信', '第一卷 启程', '第一章 雨夜', '雨落下来。', '第二章 清晨', '天亮了。']
  let cursor = -1
  for (const text of ordered) {
    const next = xml.indexOf(text)
    assert.equal(next > cursor, true, `${text} should follow the previous section`)
    cursor = next
  }
})
