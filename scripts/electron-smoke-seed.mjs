import { basename, join, resolve } from 'node:path'

import { ProjectService } from '../src/novel/project-service.ts'

const userDataDir = process.argv[2]
if (typeof userDataDir !== 'string') {
  throw new Error('Electron smoke userData directory is required')
}

const resolvedUserData = resolve(userDataDir)
if (!basename(resolvedUserData).startsWith('open-novel-electron-smoke-')) {
  throw new Error('Refusing to seed an unowned Electron smoke directory')
}

const fixtures = [
  { key: 'urban-campus', title: '烟雨中学' },
  { key: 'sci-fi-future', title: '星港回声' }
]

const service = await ProjectService.start(join(resolvedUserData, 'control.sqlite3'))
const projects = []
try {
  for (const fixture of fixtures) {
    const summary = await service.create({
      root: join(resolvedUserData, 'smoke-projects', fixture.key),
      title: fixture.title
    })
    projects.push({ key: fixture.key, projectId: summary.projectId, title: summary.title })
    await service.close()
  }
} finally {
  await service.shutdown()
}

process.stdout.write(JSON.stringify(projects))
