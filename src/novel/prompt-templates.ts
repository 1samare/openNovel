import type {
  BibleEntry,
  NovelGenre,
  NovelProfile,
  OutlineNode,
  ProposalDomain
} from '../shared/novel.ts'

export type CoauthorPromptContext = {
  profile: NovelProfile | null
  entries: BibleEntry[]
  outline: OutlineNode[]
  sourceVersionIds: string[]
}

export type CoauthorPromptInput = {
  domain: ProposalDomain
  genre: NovelGenre
  request: string
  targetEntityId: string | null
  context: CoauthorPromptContext
}

const roleInstructions: Readonly<Record<ProposalDomain, string>> = {
  setting: '你是设定 Agent，负责世界规则、地点、势力、物品、时间线与伏笔的一致性。',
  character: '你是人物 Agent，负责人物动机、关系、弧光、状态与行为一致性。',
  plot: '你是剧情 Agent，负责总纲、分卷、故事阶段与章节规划的因果推进。'
}

const genreInstructions: Readonly<Record<NovelGenre, string>> = {
  'urban-campus': '题材为都市校园：所有建议必须尊重现实社会、校园制度、时间成本与人际后果，超常元素必须有明确边界。',
  'sci-fi-future': '题材为科幻未来：所有建议必须说明技术边界、资源限制、失效条件与使用代价，避免用万能科技消解冲突。'
}

const isAuthoritative = (value: { authorityStatus?: unknown }): boolean => (
  value.authorityStatus === 'user_confirmed' || value.authorityStatus === 'approved'
)

const serializeContext = (context: CoauthorPromptContext): string => JSON.stringify({
  profile: context.profile === null || !isAuthoritative(context.profile)
    ? null
    : {
      genre: context.profile.genre,
      audience: context.profile.audience,
      theme: context.profile.theme,
      narrativePov: context.profile.narrativePov,
      tone: context.profile.tone,
      styleSample: context.profile.styleSample,
      bannedExpressions: context.profile.bannedExpressions,
      sourceVersionId: context.profile.currentVersionId
    },
  entries: context.entries.filter(isAuthoritative).map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    title: entry.title,
    summary: entry.summary,
    fields: entry.fields,
    relatedEntityIds: entry.relatedEntityIds,
    sourceVersionId: entry.currentVersionId
  })),
  outline: context.outline.filter(isAuthoritative).map((node) => ({
    id: node.id,
    kind: node.kind,
    parentId: node.parentId,
    title: node.title,
    summary: node.summary,
    goal: node.goal,
    conflict: node.conflict,
    turningPoint: node.turningPoint,
    hook: node.hook,
    targetWords: node.targetWords,
    participantCharacterIds: node.participantCharacterIds,
    position: node.position,
    sourceVersionId: node.currentVersionId
  })),
  sourceVersionIds: context.sourceVersionIds
})

export const buildCoauthorPrompt = (input: CoauthorPromptInput): {
  system: string
  prompt: string
  input: CoauthorPromptInput
} => ({
  input,
  system: [
    roleInstructions[input.domain],
    '你只能输出待用户审核的结构化候选，不能声称已修改小说圣经。',
    '返回最多 3 条高价值候选；每条必须说明理由、影响对象、来源版本与显式冲突。',
    '不得把猜测写成既定事实，不得输出 schema 之外的字段。'
  ].join('\n'),
  prompt: [
    genreInstructions[input.genre],
    `用户请求：${input.request}`,
    `局部目标：${input.targetEntityId ?? '无，允许创建新条目'}`,
    '以下 JSON 仅含用户确认或已批准的权威资料：',
    serializeContext(input.context)
  ].join('\n')
})
