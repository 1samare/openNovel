import assert from 'node:assert/strict'
import test from 'node:test'

import {
  countChineseProseCharacters,
  isChapterDocument,
  isChapterSummary
} from '../src/shared/chapter.ts'

const chapter = {
  id: 'chapter-1',
  projectId: 'project-1',
  parentId: null,
  kind: 'chapter',
  title: '第一章 雨夜',
  position: 0,
  currentVersionId: null,
  createdAt: '2026-08-10T03:00:00.000Z',
  updatedAt: '2026-08-10T03:00:00.000Z'
}

test('counts prose characters after removing Unicode whitespace and punctuation', () => {
  assert.equal(countChineseProseCharacters('你，好！\nA 1…🙂'), 5)
  assert.equal(countChineseProseCharacters('“ ”　\t—？！'), 0)
})

test('accepts only exact canonical chapter summaries', () => {
  assert.equal(isChapterSummary(chapter), true)
  assert.equal(isChapterSummary({ ...chapter, extra: true }), false)
  assert.equal(isChapterSummary({ ...chapter, title: '  ' }), false)
  assert.equal(isChapterSummary({ ...chapter, position: -1 }), false)
  assert.equal(isChapterSummary({ ...chapter, updatedAt: '2026-08-10 03:00' }), false)
  assert.equal(isChapterSummary({ ...chapter, kind: 'scene' }), false)
})

test('validates chapter documents including revision, saved time, and shared count', () => {
  const document = {
    chapter,
    content: '你好，世界！',
    draftRevision: 2,
    savedAt: '2026-08-10T03:01:00.000Z',
    characterCount: 4
  }
  assert.equal(isChapterDocument(document), true)
  assert.equal(isChapterDocument({ ...document, draftRevision: -1 }), false)
  assert.equal(isChapterDocument({ ...document, savedAt: null }), true)
  assert.equal(isChapterDocument({ ...document, characterCount: 6 }), false)
  assert.equal(isChapterDocument({ ...document, unexpected: 'field' }), false)
})
