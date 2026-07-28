export interface NavigationItem {
  path: string
  label: string
  marker: string
  description: string
}

export const navigationItems: readonly NavigationItem[] = [
  { path: 'overview', label: '项目概览', marker: '概', description: '查看小说项目的整体创作状态。' },
  { path: 'chat', label: 'AI 对话', marker: '聊', description: '围绕当前小说项目与 AI 进行讨论。' },
  { path: 'world', label: '世界观', marker: '世', description: '维护世界背景、规则、地点与势力。' },
  { path: 'characters', label: '人物', marker: '人', description: '管理人物档案、关系和当前状态。' },
  { path: 'outline', label: '大纲', marker: '纲', description: '组织故事总纲、分卷与章节规划。' },
  { path: 'chapters', label: '章节', marker: '章', description: '进入章节树与正文创作区域。' },
  { path: 'skills', label: 'Skill', marker: '技', description: '管理可复用的写作规则与提示词模块。' },
  { path: 'versions', label: '版本历史', marker: '版', description: '查看内容版本和恢复入口。' },
  { path: 'settings', label: '设置', marker: '设', description: '管理应用基础设置和数据目录。' }
]
