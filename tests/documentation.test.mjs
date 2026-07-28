import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const projectFile = (path) => new URL(`../${path}`, import.meta.url)
const readProjectFile = (path) => readFile(projectFile(path), 'utf8')

test('README 描述安装、运行、检查和构建命令', async () => {
  const readme = await readProjectFile('README.md')

  for (const command of ['npm install', 'npm run dev', 'npm run typecheck', 'npm test', 'npm run build']) {
    assert.match(readme, new RegExp(command.replaceAll(' ', '\\s+')))
  }
})

test('产品设计文档记录已确认的 Electron 技术方向', async () => {
  const design = await readProjectFile('小说AI辅助写作产品设计文档_V1.0.md')

  assert.match(design, /Electron \+ Vue 3 \+ TypeScript/)
  assert.doesNotMatch(design, /建议技术方向：\*\* Flutter Windows/)
})
