import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const projectFile = (path) => new URL(`../${path}`, import.meta.url)
const readProjectFile = (path) => readFile(projectFile(path), 'utf8')

test('创作工作台包含产品设计要求的一级页面', async () => {
  const source = await readProjectFile('src/renderer/src/navigation/items.ts')
  const routes = [
    'overview',
    'chat',
    'world',
    'characters',
    'outline',
    'chapters',
    'skills',
    'versions',
    'settings'
  ]

  for (const route of routes) {
    assert.match(source, new RegExp(`path: '${route}'`))
  }
})

test('Electron 渲染入口定义限制性内容安全策略', async () => {
  const source = await readProjectFile('src/renderer/index.html')

  assert.match(source, /Content-Security-Policy/)
  assert.match(source, /default-src 'self'/)
  assert.match(source, /script-src 'self'/)
})
