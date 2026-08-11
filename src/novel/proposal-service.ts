import {
  BibleDomainError,
  characterProposalCandidateSchema,
  plotProposalCandidateSchema,
  settingProposalCandidateSchema,
  settingProposalBatchSchema,
  characterProposalBatchSchema,
  plotProposalBatchSchema,
  type BibleProposal,
  type DecideBibleProposalInput,
  type GenerateBibleProposalsInput,
  type NovelBibleSnapshot,
  type ProposalCandidate,
  type ProposalDomain
} from '../shared/novel.ts'
import { ModelDomainError, type AgentRole, type GenerationMode } from '../shared/model.ts'
import type { ZodType } from 'zod'
import { BibleRepository } from './bible-repository.ts'
import { buildCoauthorPrompt } from './prompt-templates.ts'

export type RecordProposalCandidatesInput = {
  sourceRunId: string
  domain: ProposalDomain
  sourceVersionIds: string[]
  candidates: unknown[]
}

export type StructuredCoauthorPort = {
  generate(input: {
    role: AgentRole
    mode?: GenerationMode
    schema: ZodType
    system: string
    prompt: string
    signal: AbortSignal
  }): Promise<unknown>
}

export type ProposalServiceOptions = {
  coauthor?: StructuredCoauthorPort
}

const parseCandidate = (domain: ProposalDomain, value: unknown): ProposalCandidate => {
  if (domain === 'setting') return settingProposalCandidateSchema.parse(value)
  if (domain === 'character') return characterProposalCandidateSchema.parse(value)
  return plotProposalCandidateSchema.parse(value)
}

const compareCandidates = (
  left: { candidate: ProposalCandidate; index: number },
  right: { candidate: ProposalCandidate; index: number }
): number => {
  const priority = right.candidate.priority - left.candidate.priority
  if (priority !== 0) return priority
  const conflictEvidence = right.candidate.conflicts.length - left.candidate.conflicts.length
  if (conflictEvidence !== 0) return conflictEvidence
  const affected = right.candidate.affectedEntityIds.length - left.candidate.affectedEntityIds.length
  if (affected !== 0) return affected
  return left.index - right.index
}

export class ProposalService {
  readonly #repository: BibleRepository
  readonly #coauthor?: StructuredCoauthorPort

  constructor(repository: BibleRepository, options: ProposalServiceOptions = {}) {
    this.#repository = repository
    this.#coauthor = options.coauthor
  }

  async recordCandidates(input: RecordProposalCandidatesInput): Promise<BibleProposal[]> {
    if (new Set(input.sourceVersionIds).size !== input.sourceVersionIds.length) {
      throw new BibleDomainError('BIBLE_INVALID_COMMAND', 'Proposal source versions must be unique')
    }
    const candidates = input.candidates
      .map((value, index) => ({ candidate: parseCandidate(input.domain, value), index }))
      .filter(({ candidate }) => candidate.rationale.trim() !== '' && candidate.impact.trim() !== '')
      .sort(compareCandidates)
      .slice(0, 3)
      .map(({ candidate }) => candidate)
    return this.#repository.recordProposals({
      sourceRunId: input.sourceRunId,
      domain: input.domain,
      sourceVersionIds: input.sourceVersionIds,
      candidates
    })
  }

  decideProposal(input: DecideBibleProposalInput): Promise<NovelBibleSnapshot> {
    return this.#repository.decideProposal(input)
  }

  async generateProposals(
    input: GenerateBibleProposalsInput,
    signal: AbortSignal
  ): Promise<BibleProposal[]> {
    if (signal.aborted) {
      throw new BibleDomainError('BIBLE_GENERATION_CANCELLED', 'Bible generation was cancelled')
    }
    if (this.#coauthor === undefined) {
      throw new BibleDomainError('BIBLE_MODEL_NOT_CONFIGURED', 'No structured coauthor is configured')
    }
    const context = await this.#repository.authoritativeContext()
    if (context.profile === null) {
      throw new BibleDomainError('BIBLE_NOT_AVAILABLE', 'Save the novel profile before generating proposals')
    }
    const prompt = buildCoauthorPrompt({
      domain: input.domain,
      genre: context.profile.genre,
      request: input.request,
      targetEntityId: input.targetEntityId,
      context
    })
    const schema = input.domain === 'setting'
      ? settingProposalBatchSchema
      : input.domain === 'character'
        ? characterProposalBatchSchema
        : plotProposalBatchSchema
    const role: AgentRole = input.domain
    const generate = async (directedPrompt: string): Promise<{ proposals: ProposalCandidate[] }> => {
      if (signal.aborted) {
        throw new ModelDomainError('MODEL_CANCELLED', 'Model operation was cancelled')
      }
      const value = await this.#coauthor!.generate({
        role,
        mode: input.mode,
        schema,
        system: prompt.system,
        prompt: directedPrompt,
        signal
      })
      const parsed = schema.safeParse(value)
      if (!parsed.success) {
        throw new ModelDomainError('MODEL_INVALID_STRUCTURE', 'Proposal output did not match its schema')
      }
      return parsed.data as { proposals: ProposalCandidate[] }
    }

    let generated: { proposals: ProposalCandidate[] }
    try {
      generated = await generate(prompt.prompt)
    } catch (error) {
      if (!(error instanceof ModelDomainError) || error.code !== 'MODEL_INVALID_STRUCTURE') {
        throw this.#mapModelError(error, signal)
      }
      try {
        generated = await generate([
          prompt.prompt,
          '上一次输出未通过结构校验。只修复字段、类型和层级，重新输出完整 JSON；不得增加解释文本。'
        ].join('\n'))
      } catch (repairError) {
        throw this.#mapModelError(repairError, signal)
      }
    }
    if (input.targetEntityId !== null && generated.proposals.some(
      (candidate) => candidate.targetEntityId !== input.targetEntityId
    )) {
      throw new BibleDomainError('BIBLE_OPERATION_FAILED', 'Generated proposal changed the requested target')
    }
    if (signal.aborted) {
      throw new BibleDomainError('BIBLE_GENERATION_CANCELLED', 'Bible generation was cancelled')
    }
    return this.recordCandidates({
      sourceRunId: input.requestId,
      domain: input.domain,
      sourceVersionIds: context.sourceVersionIds,
      candidates: generated.proposals
    })
  }

  #mapModelError(error: unknown, signal: AbortSignal): BibleDomainError {
    if (signal.aborted || (error instanceof ModelDomainError && error.code === 'MODEL_CANCELLED')) {
      return new BibleDomainError('BIBLE_GENERATION_CANCELLED', 'Bible generation was cancelled')
    }
    if (error instanceof ModelDomainError && (
      error.code === 'MODEL_NOT_CONFIGURED' || error.code === 'MODEL_CAPABILITY_REQUIRED'
    )) {
      return new BibleDomainError('BIBLE_MODEL_NOT_CONFIGURED', 'A structured model route is not configured')
    }
    return new BibleDomainError(
      'BIBLE_OPERATION_FAILED',
      'Bible proposal generation failed',
      error instanceof ModelDomainError && error.retryable
    )
  }
}
