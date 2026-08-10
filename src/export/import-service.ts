import { countChineseProseCharacters, type ImportPreview } from '../shared/chapter.ts'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

type PreviewImportInput = Pick<ImportPreview, 'sourceName' | 'format' | 'mode'> & {
  text: string
}

const normalizeText = (text: string): string =>
  text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim()

const sourceTitle = (sourceName: string): string => {
  const trimmed = sourceName.trim().replace(/\.(?:txt|md|markdown)$/i, '').trim()
  return trimmed.length > 0 ? trimmed : '导入章节'
}

const createChapter = (title: string, content: string) => {
  const normalizedContent = content.trim()
  return {
    title: title.trim().slice(0, 120),
    content: normalizedContent,
    characterCount: countChineseProseCharacters(normalizedContent)
  }
}

const splitText = (text: string, format: PreviewImportInput['format']) => {
  const lines = text.split('\n')
  const headings: Array<{ index: number; consumed: number; title: string }> = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (format === 'markdown' || format === 'paste') {
      const atx = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/)
      if (atx !== null) {
        headings.push({ index, consumed: 1, title: atx[1] })
        continue
      }
      if (
        line.trim().length > 0 &&
        index + 1 < lines.length &&
        /^\s*(?:=+|-+)\s*$/.test(lines[index + 1])
      ) {
        headings.push({ index, consumed: 2, title: line.trim() })
        index += 1
        continue
      }
    }
    const chinese = line.match(/^\s*(第[0-9零〇一二三四五六七八九十百千万两]+[章节回](?:[ \t　]+.+)?)\s*$/)
    if (chinese !== null) headings.push({ index, consumed: 1, title: chinese[1] })
  }

  if (headings.length === 0) return [createChapter('导入章节', text)]
  const chapters = []
  const preface = lines.slice(0, headings[0].index).join('\n').trim()
  if (preface.length > 0) chapters.push(createChapter('前言', preface))
  headings.forEach((heading, headingIndex) => {
    const next = headings[headingIndex + 1]
    const content = lines.slice(
      heading.index + heading.consumed,
      next?.index ?? lines.length
    ).join('\n').trim()
    if (content.length > 0) chapters.push(createChapter(heading.title, content))
  })
  return chapters
}

export const previewImport = (input: PreviewImportInput): ImportPreview => {
  const sourceName = input.sourceName.trim() || '粘贴文本'
  const text = normalizeText(input.text)
  if (input.mode === 'reference') {
    return { sourceName, format: input.format, mode: input.mode, referenceContent: text, chapters: [] }
  }
  if (input.mode === 'single-chapter') {
    return {
      sourceName,
      format: input.format,
      mode: input.mode,
      referenceContent: null,
      chapters: text.length === 0 ? [] : [createChapter(sourceTitle(sourceName), text)]
    }
  }
  const chapters = splitText(text, input.format)
  if (chapters.length === 1 && chapters[0].title === '导入章节') {
    chapters[0] = createChapter(sourceTitle(sourceName), chapters[0].content)
  }
  return { sourceName, format: input.format, mode: input.mode, referenceContent: null, chapters }
}

export const writeReferenceAttachment = async (input: {
  attachmentsRoot: string
  preview: ImportPreview
  fileId: string
}): Promise<{ relativePath: string; absolutePath: string }> => {
  if (input.preview.mode !== 'reference' || input.preview.referenceContent === null) {
    throw new Error('Reference preview is required')
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(input.fileId)) {
    throw new Error('Reference id is invalid')
  }
  const rawName = basename(input.preview.sourceName.replace(/\\/g, '/'))
  const safeName = rawName
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 100) || '参考资料.txt'
  const relativePath = `${input.fileId}-${safeName}`
  const absolutePath = join(input.attachmentsRoot, relativePath)
  const temporary = join(input.attachmentsRoot, `.${input.fileId}.tmp`)
  await mkdir(input.attachmentsRoot, { recursive: true })
  try {
    await writeFile(temporary, input.preview.referenceContent, { encoding: 'utf8', flag: 'wx' })
    await rename(temporary, absolutePath)
    return { relativePath, absolutePath }
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}
