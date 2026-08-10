import type { BookExportSnapshot } from '../shared/chapter.ts'
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'

const encoder = new TextEncoder()

export const renderText = (snapshot: BookExportSnapshot): Uint8Array => {
  const sections: string[] = [snapshot.title]
  let volume: string | null = null
  for (const chapter of snapshot.chapters) {
    if (chapter.volumeTitle !== volume) {
      volume = chapter.volumeTitle
      if (volume !== null) sections.push(volume)
    }
    sections.push(chapter.title, chapter.content)
  }
  return encoder.encode(`${sections.join('\r\n\r\n')}\r\n`)
}

export const renderMarkdown = (snapshot: BookExportSnapshot): Uint8Array => {
  const sections: string[] = [`# ${snapshot.title}`]
  let volume: string | null = null
  for (const chapter of snapshot.chapters) {
    if (chapter.volumeTitle !== volume) {
      volume = chapter.volumeTitle
      if (volume !== null) sections.push(`## ${volume}`)
    }
    sections.push(`${volume === null ? '##' : '###'} ${chapter.title}`, chapter.content)
  }
  return encoder.encode(`${sections.join('\n\n')}\n`)
}

export const renderDocx = async (snapshot: BookExportSnapshot): Promise<Uint8Array> => {
  const children: Paragraph[] = [new Paragraph({
    heading: HeadingLevel.TITLE,
    children: [new TextRun(snapshot.title)]
  })]
  let volume: string | null = null
  for (const chapter of snapshot.chapters) {
    if (chapter.volumeTitle !== volume) {
      volume = chapter.volumeTitle
      if (volume !== null) {
        children.push(new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun(volume)]
        }))
      }
    }
    children.push(new Paragraph({
      heading: volume === null ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
      children: [new TextRun(chapter.title)]
    }))
    for (const line of chapter.content.replace(/\r\n?/g, '\n').split('\n')) {
      children.push(new Paragraph({ children: [new TextRun(line)] }))
    }
  }
  const document = new Document({ sections: [{ children }] })
  return new Uint8Array(await Packer.toBuffer(document))
}
