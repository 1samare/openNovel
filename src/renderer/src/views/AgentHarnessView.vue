<script setup lang="ts">
import { computed, onMounted } from 'vue'

import type { AgentEvent, AgentRun, RunStatus } from '@shared/agent'
import { useAgentHarness } from '@renderer/agent/use-agent-harness'

const harness = useAgentHarness()

const statusLabels: Record<RunStatus, string> = {
  queued: '等待执行',
  running: '执行中',
  awaiting_approval: '等待审批',
  completed: '已完成',
  cancelled: '已取消',
  failed: '执行失败',
  interrupted: '已中断'
}

const eventLabels: Record<AgentEvent['type'], string> = {
  'run.created': 'Run 已创建',
  'run.started': '开始执行',
  'run.interrupted': '执行已中断',
  'run.resumed': '恢复执行',
  'run.completed': 'Run 已完成',
  'run.cancelled': 'Run 已取消',
  'run.failed': 'Run 执行失败',
  'step.started': '步骤开始',
  'step.delta': '收到流式内容',
  'step.completed': '步骤完成',
  'approval.requested': '等待人工审批',
  'approval.resolved': '审批已通过'
}

const selected = computed<AgentRun | undefined>(() =>
  harness.state.selectedRunId === undefined
    ? undefined
    : harness.runFor(harness.state.selectedRunId)
)
const timeline = computed(() => selected.value === undefined
  ? []
  : [...selected.value.events].sort((left, right) => left.sequence - right.sequence)
)
const actionsBusy = computed(() => harness.state.action !== undefined)

const selectRun = (id: string): void => harness.selectRun(id)
const createRun = (): void => { void harness.create() }
const approveSelected = (): void => {
  if (selected.value !== undefined) void harness.approve(selected.value.id)
}
const cancelSelected = (): void => {
  if (selected.value !== undefined) void harness.cancel(selected.value.id)
}
const resumeSelected = (): void => {
  if (selected.value !== undefined) void harness.resume(selected.value.id)
}

onMounted(() => { void harness.initialize() })
</script>

<template>
  <main class="workspace-page agent-harness" aria-labelledby="agent-harness-title">
    <header class="workspace-page__header agent-harness__header">
      <div>
        <span class="eyebrow">AGENT HARNESS</span>
        <h1 id="agent-harness-title">AI 对话</h1>
        <p>创建离线 Run，查看流式推理，并在最终输出前进行人工审批。</p>
      </div>
      <span class="status-pill">本地 Mock 流</span>
    </header>

    <form class="agent-composer" @submit.prevent="createRun">
      <div class="agent-composer__copy">
        <label for="agent-prompt">Prompt</label>
        <p id="agent-prompt-helper">描述希望 Agent 完成的小说写作任务；内容仅交给本地离线 Harness。</p>
      </div>
      <textarea
        id="agent-prompt"
        v-model="harness.state.prompt"
        aria-describedby="agent-prompt-helper"
        :disabled="actionsBusy"
        placeholder="例如：梳理这一章的冲突升级，并给出可执行的下一步。"
        rows="3"
      />
      <button class="agent-button agent-button--primary" type="submit" :disabled="actionsBusy">
        {{ harness.state.action === 'create' ? '正在创建 Run…' : '创建 Run' }}
      </button>
    </form>

    <section v-if="harness.state.error" class="agent-notice agent-notice--error" role="alert" aria-live="assertive">
      <div>
        <strong>{{ harness.state.error.code }}</strong>
        <p>{{ harness.state.error.message }}</p>
      </div>
      <button
        v-if="harness.canRetry"
        class="agent-button agent-button--quiet"
        type="button"
        :disabled="harness.state.loading"
        @click="harness.retry"
      >
        重试加载
      </button>
      <p v-else class="agent-notice__hint">此错误不可自动重试，请调整输入或检查本地 Agent 服务状态。</p>
    </section>

    <section v-if="harness.state.issues.length > 0" class="agent-notice agent-notice--warning" aria-labelledby="run-issues-title">
      <div>
        <strong id="run-issues-title">发现损坏的 Run 记录</strong>
        <p>其余可读取的 Run 仍可继续使用。</p>
      </div>
      <ul>
        <li v-for="issue in harness.state.issues" :key="`${issue.id}-${issue.code}`">
          <strong>{{ issue.code }}</strong>：{{ issue.message }}
        </li>
      </ul>
    </section>

    <p class="agent-loading" aria-live="polite">{{ harness.state.loading ? '正在加载 Run 列表…' : '' }}</p>

    <section class="agent-workspace" aria-label="Agent Run 工作区">
      <aside class="run-list-panel" aria-labelledby="run-list-title">
        <div class="agent-panel__heading">
          <div>
            <span class="eyebrow">RUNS</span>
            <h2 id="run-list-title">Run 列表</h2>
          </div>
          <span>{{ harness.state.runs.length }} 项</span>
        </div>
        <p v-if="harness.state.runs.length === 0" class="agent-empty">尚无 Run。填写 Prompt 后创建第一个离线执行任务。</p>
        <div v-else class="run-list">
          <button
            v-for="run in harness.state.runs"
            :key="run.id"
            class="run-list__item"
            :class="{ 'run-list__item--selected': run.id === harness.state.selectedRunId }"
            type="button"
            :aria-pressed="run.id === harness.state.selectedRunId"
            @click="selectRun(run.id)"
          >
            <span class="run-list__prompt">{{ run.prompt }}</span>
            <span class="run-list__meta">
              <span class="agent-status" :data-status="run.status">{{ statusLabels[run.status] }}</span>
              <time :datetime="run.updatedAt">{{ new Date(run.updatedAt).toLocaleTimeString() }}</time>
            </span>
          </button>
        </div>
      </aside>

      <section v-if="selected" class="run-detail-panel" aria-labelledby="run-detail-title">
        <div class="agent-panel__heading">
          <div>
            <span class="eyebrow">SELECTED RUN</span>
            <h2 id="run-detail-title">执行详情</h2>
          </div>
          <span class="agent-status" :data-status="selected.status">{{ statusLabels[selected.status] }}</span>
        </div>

        <dl class="run-summary">
          <div>
            <dt>Prompt</dt>
            <dd>{{ selected.prompt }}</dd>
          </div>
          <div>
            <dt>Run ID</dt>
            <dd>{{ selected.id }}</dd>
          </div>
          <div>
            <dt>最近更新</dt>
            <dd><time :datetime="selected.updatedAt">{{ new Date(selected.updatedAt).toLocaleString() }}</time></dd>
          </div>
        </dl>

        <section v-if="selected.status === 'awaiting_approval'" class="approval-card" aria-labelledby="approval-title">
          <div>
            <span class="eyebrow">HUMAN CHECKPOINT</span>
            <h3 id="approval-title">分析已完成，等待审批</h3>
            <p>通过后才会继续生成最终结果；也可以取消本次 Run。</p>
          </div>
          <button class="agent-button agent-button--approval" type="button" :disabled="actionsBusy" @click="approveSelected">
            {{ harness.state.action === 'approve' ? '正在审批…' : '审批通过' }}
          </button>
        </section>

        <div class="run-actions" aria-label="Run 操作">
          <button
            v-if="harness.canResume(selected)"
            class="agent-button agent-button--quiet"
            type="button"
            :disabled="actionsBusy"
            @click="resumeSelected"
          >
            {{ harness.state.action === 'resume' ? '正在恢复…' : '恢复执行' }}
          </button>
          <button
            v-if="harness.canCancel(selected)"
            class="agent-button agent-button--danger"
            type="button"
            :disabled="actionsBusy"
            @click="cancelSelected"
          >
            {{ harness.state.action === 'cancel' ? '正在取消…' : '取消 Run' }}
          </button>
        </div>

        <section class="agent-output" aria-labelledby="analysis-output-title">
          <div>
            <span class="eyebrow">STREAMED ANALYSIS</span>
            <h3 id="analysis-output-title">分析输出</h3>
          </div>
          <p v-if="selected.output.analysis">{{ selected.output.analysis }}</p>
          <p v-else class="agent-empty">流式分析会在这里逐步显示。</p>
        </section>

        <section v-if="selected.status === 'completed'" class="agent-output agent-output--result" aria-labelledby="final-output-title">
          <div>
            <span class="eyebrow">COMPLETED RESULT</span>
            <h3 id="final-output-title">最终结果</h3>
          </div>
          <p v-if="selected.output.final">{{ selected.output.final }}</p>
          <p v-else class="agent-empty">该 Run 已完成，但没有返回最终文本。</p>
        </section>

        <section class="agent-timeline" aria-labelledby="timeline-title">
          <div class="agent-panel__heading">
            <div>
              <span class="eyebrow">EVENTS</span>
              <h3 id="timeline-title">按序事件时间线</h3>
            </div>
            <span>{{ timeline.length }} 条</span>
          </div>
          <ol>
            <li v-for="event in timeline" :key="event.sequence">
              <span class="agent-timeline__sequence">{{ event.sequence }}</span>
              <div>
                <strong>{{ eventLabels[event.type] }}</strong>
                <p v-if="event.type === 'step.delta' && typeof event.payload.text === 'string'">{{ event.payload.text }}</p>
                <time :datetime="event.timestamp">{{ new Date(event.timestamp).toLocaleTimeString() }}</time>
              </div>
            </li>
          </ol>
        </section>
      </section>

      <section v-else class="run-detail-panel run-detail-panel--empty" aria-live="polite">
        <h2>选择一个 Run</h2>
        <p>Run 的状态、流式输出、审批和恢复操作会显示在这里。</p>
      </section>
    </section>
  </main>
</template>
