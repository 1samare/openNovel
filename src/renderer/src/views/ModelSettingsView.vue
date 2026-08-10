<script setup lang="ts">
import { onMounted } from 'vue'

import type { AgentRole } from '@shared/model'
import { useModelSettings } from '@renderer/model/use-model-settings'

const settings = useModelSettings(window.openNovel.models)

const routeTarget = (profileId: string): string => {
  const profile = settings.profiles.value.find(({ id }) => id === profileId)
  return profile === undefined
    ? '尚未选择'
    : `${profile.label} · ${settings.connectionName(profile.connectionId)}`
}

const roleRequirement = (role: AgentRole): string =>
  role === 'writer' ? '需要流式文本能力' : '需要结构化输出能力'

onMounted(() => void settings.load())
</script>

<template>
  <main class="workspace-page model-settings" aria-labelledby="model-settings-title">
    <header class="workspace-page__header model-settings__header">
      <div>
        <span class="eyebrow">BYOK · LOCAL-FIRST</span>
        <h1 id="model-settings-title">模型与 API 密钥</h1>
        <p>先连接供应商，再创建可复用档案，最后为当前项目设置模式默认与角色覆盖。</p>
      </div>
      <span class="status-pill">阶段 3</span>
    </header>

    <aside class="model-security-note" aria-labelledby="model-security-title">
      <div>
        <strong id="model-security-title">密钥只在本机加密保存</strong>
        <p>界面不会回显已保存的完整密钥，也不会把密钥写入项目数据库、日志或错误提示。</p>
      </div>
      <p class="model-security-note__boundary">
        Windows 安全存储会保护静态密文，但无法防止同一 Windows 用户下运行的其他程序访问当前用户权限内的数据。
      </p>
    </aside>

    <section v-if="settings.loading.value" class="model-feedback" role="status" aria-live="polite">
      <span class="model-spinner" aria-hidden="true" />
      正在加载模型设置…
    </section>
    <section v-else-if="settings.loadError.value" class="model-feedback model-feedback--error" role="alert">
      <div>
        <strong>模型设置加载失败</strong>
        <p>现有配置没有被修改。</p>
      </div>
      <button class="model-button model-button--quiet" type="button" @click="settings.load">
        重试加载
      </button>
    </section>

    <div v-else class="model-settings-stack">
      <section class="model-section" aria-labelledby="connections-title">
        <header class="model-section__heading">
          <div>
            <span class="model-step">01</span>
            <h2 id="connections-title">供应商连接</h2>
            <p>API 密钥仅在保存时提交给主进程；编辑已有连接时留空即可保留原密钥。</p>
          </div>
          <button class="model-button model-button--preset" type="button" @click="settings.applyDeepSeekPreset">
            使用 DeepSeek 预设
          </button>
        </header>

        <div class="model-settings-grid">
          <aside class="model-saved-list" aria-label="已保存连接">
            <div class="model-list-heading">
              <strong>已保存连接</strong>
              <button class="model-text-button" type="button" @click="settings.startNewConnection">
                新建连接
              </button>
            </div>
            <p v-if="settings.connections.value.length === 0" class="model-empty-copy">还没有连接。</p>
            <button
              v-for="item in settings.connections.value"
              :key="item.id"
              class="model-list-card"
              :class="{ 'model-list-card--selected': settings.connection.id === item.id }"
              type="button"
              @click="settings.selectConnection(item.id)"
            >
              <span>
                <strong>{{ item.name }}</strong>
                <small>{{ settings.PROVIDER_LABELS[item.kind] }}</small>
              </span>
              <span class="model-secret-state">{{ item.hasSecret ? item.secretHint ?? '已保存' : '未设置密钥' }}</span>
            </button>
          </aside>

          <form class="model-form" data-testid="connection-form" @submit.prevent="settings.saveConnection">
            <div class="model-form__row model-form__row--split">
              <div class="model-field">
                <label for="connection-name">连接名称</label>
                <input id="connection-name" v-model="settings.connection.name" autocomplete="off" required />
              </div>
              <div class="model-field">
                <label for="connection-kind">供应商协议</label>
                <select id="connection-kind" v-model="settings.connection.kind">
                  <option v-for="(label, kind) in settings.PROVIDER_LABELS" :key="kind" :value="kind">
                    {{ label }}
                  </option>
                </select>
              </div>
            </div>

            <div class="model-field">
              <label for="connection-base-url">Base URL</label>
              <input
                id="connection-base-url"
                v-model="settings.connection.baseUrl"
                type="url"
                spellcheck="false"
                aria-describedby="connection-base-url-help"
                :required="settings.connection.kind === 'openai-compatible'"
              />
              <p id="connection-base-url-help" class="model-field-help">
                仅允许 HTTPS；本机开发可使用回环 HTTP。OpenAI-compatible 必填；Anthropic/Gemini 留空使用官方端点。
              </p>
            </div>

            <div class="model-field">
              <label for="connection-api-key">API 密钥</label>
              <input
                id="connection-api-key"
                v-model="settings.connectionApiKey.value"
                type="password"
                autocomplete="new-password"
                aria-describedby="connection-api-key-help"
              />
              <p id="connection-api-key-help" class="model-field-help">
                {{ settings.selectedConnection.value?.hasSecret
                  ? `留空将保留已保存密钥（${settings.selectedConnection.value.secretHint ?? '已加密'}）。`
                  : '新连接必须填写密钥；保存成功后此输入会立即清空。' }}
              </p>
            </div>

            <label class="model-check" for="connection-enabled">
              <input id="connection-enabled" v-model="settings.connection.enabled" type="checkbox" />
              启用此连接
            </label>

            <div class="model-form__actions">
              <button class="model-button model-button--primary" type="submit" :disabled="settings.connectionBusy.value">
                {{ settings.connectionBusy.value ? '正在保存…' : '保存连接' }}
              </button>
            </div>
            <p v-if="settings.connectionError.value" class="model-form-error" role="alert">
              {{ settings.connectionError.value }}
            </p>
            <p v-if="settings.connectionStatus.value" class="model-form-status" role="status" aria-live="polite">
              {{ settings.connectionStatus.value }}
            </p>

            <fieldset class="model-test-panel" :disabled="settings.connection.id === undefined">
              <legend>连接验证</legend>
              <div class="model-field">
                <label for="connection-test-model">手工模型 ID</label>
                <input
                  id="connection-test-model"
                  v-model="settings.connectionTestModel.value"
                  list="provider-model-options"
                  autocomplete="off"
                  spellcheck="false"
                />
                <datalist id="provider-model-options">
                  <option v-for="item in settings.modelOptions.value" :key="item.id" :value="item.id">
                    {{ item.label }}
                  </option>
                </datalist>
                <p class="model-field-help">模型列表是可选辅助，始终可以直接输入供应商支持的模型 ID。</p>
              </div>
              <div class="model-form__actions">
                <button
                  class="model-button model-button--quiet"
                  type="button"
                  :disabled="settings.modelsBusy.value || settings.activeTestRequestId.value !== undefined"
                  @click="settings.listModels"
                >
                  {{ settings.modelsBusy.value ? '正在获取…' : '获取模型列表' }}
                </button>
                <button
                  v-if="settings.activeTestRequestId.value === undefined"
                  class="model-button model-button--primary"
                  type="button"
                  @click="settings.testConnection"
                >
                  测试连接
                </button>
                <button
                  v-else
                  class="model-button model-button--danger"
                  type="button"
                  :disabled="settings.cancellingTest.value"
                  @click="settings.cancelConnectionTest"
                >
                  {{ settings.cancellingTest.value ? '正在取消…' : '取消测试' }}
                </button>
              </div>
              <div class="model-preset-models" aria-label="DeepSeek 当前预设模型">
                <span>DeepSeek 预设</span>
                <code>deepseek-v4-flash</code>
                <code>deepseek-v4-pro</code>
              </div>
            </fieldset>
          </form>
        </div>
      </section>

      <section class="model-section" aria-labelledby="profiles-title">
        <header class="model-section__heading">
          <div>
            <span class="model-step">02</span>
            <h2 id="profiles-title">模型档案</h2>
            <p>为同一连接保存不同模型、采样参数和已验证能力，供路由复用。</p>
          </div>
          <button class="model-button model-button--quiet" type="button" @click="settings.startNewProfile">
            新建档案
          </button>
        </header>

        <div class="model-settings-grid">
          <aside class="model-saved-list" aria-label="已保存模型档案">
            <p v-if="settings.profiles.value.length === 0" class="model-empty-copy">尚未配置模型档案。</p>
            <article v-for="item in settings.profiles.value" :key="item.id" class="model-profile-card">
              <div>
                <strong>{{ item.label }}</strong>
                <p>{{ item.modelId }} · {{ settings.connectionName(item.connectionId) }}</p>
              </div>
              <div class="model-capabilities" aria-label="模型能力">
                <span v-for="capability in item.capabilities" :key="capability">
                  {{ settings.CAPABILITY_LABELS[capability] }}
                </span>
              </div>
              <button class="model-text-button" type="button" @click="settings.editProfile(item)">编辑档案</button>
            </article>
          </aside>

          <form class="model-form" data-testid="profile-form" @submit.prevent="settings.saveProfile">
            <div class="model-form__row model-form__row--split">
              <div class="model-field">
                <label for="profile-label">档案名称</label>
                <input id="profile-label" v-model="settings.profile.label" autocomplete="off" required />
              </div>
              <div class="model-field">
                <label for="profile-connection">供应商连接</label>
                <select id="profile-connection" v-model="settings.profile.connectionId" required>
                  <option value="" disabled>请选择连接</option>
                  <option v-for="item in settings.connections.value" :key="item.id" :value="item.id">
                    {{ item.name }}
                  </option>
                </select>
              </div>
            </div>

            <div class="model-field">
              <label for="profile-model-id">模型 ID</label>
              <input id="profile-model-id" v-model="settings.profile.modelId" autocomplete="off" spellcheck="false" required />
            </div>

            <div class="model-form__row model-form__row--three">
              <div class="model-field">
                <label for="profile-temperature">温度（0–2）</label>
                <input id="profile-temperature" v-model.number="settings.profile.temperature" type="number" min="0" max="2" step="0.05" required />
              </div>
              <div class="model-field">
                <label for="profile-max-output-tokens">最大输出</label>
                <input id="profile-max-output-tokens" v-model.number="settings.profile.maxOutputTokens" type="number" min="1" step="1" required />
              </div>
              <div class="model-field">
                <label for="profile-context-window">上下文窗口</label>
                <input id="profile-context-window" v-model.number="settings.profile.contextWindow" type="number" min="1" step="1" required />
              </div>
            </div>

            <fieldset class="model-capability-picker">
              <legend>模型能力（按供应商文档确认）</legend>
              <label v-for="capability in settings.MODEL_CAPABILITIES" :key="capability" class="model-check" :for="`capability-${capability}`">
                <input
                  :id="`capability-${capability}`"
                  v-model="settings.profile.capabilities"
                  type="checkbox"
                  :value="capability"
                />
                {{ settings.CAPABILITY_LABELS[capability] }}
              </label>
            </fieldset>

            <div class="model-form__actions">
              <button class="model-button model-button--primary" type="submit" :disabled="settings.profileBusy.value || settings.connections.value.length === 0">
                {{ settings.profileBusy.value ? '正在保存…' : '保存模型档案' }}
              </button>
            </div>
            <p v-if="settings.profileError.value" class="model-form-error" data-testid="profile-error" role="alert">
              {{ settings.profileError.value }}
            </p>
            <p v-if="settings.profileStatus.value" class="model-form-status" role="status" aria-live="polite">
              {{ settings.profileStatus.value }}
            </p>
          </form>
        </div>
      </section>

      <section class="model-section" aria-labelledby="bindings-title">
        <header class="model-section__heading">
          <div>
            <span class="model-step">03</span>
            <h2 id="bindings-title">当前项目的角色绑定</h2>
            <p>模式默认保证每次调用有基础路由；启用角色覆盖后，该角色会使用自己的模式和模型。</p>
          </div>
        </header>

        <div v-if="settings.profiles.value.length === 0" class="model-feedback model-feedback--warning" role="status">
          <strong>尚未配置模型档案</strong>
          <span>请先保存至少一个模型档案；在此之前模型调用会被明确阻止。</span>
        </div>

        <form data-testid="bindings-form" @submit.prevent="settings.saveBindings">
          <fieldset class="model-route-group" :disabled="settings.profiles.value.length === 0">
            <legend>三种生成模式默认</legend>
            <article v-for="route in settings.modeRoutes" :key="route.mode" class="model-route-card">
              <header>
                <strong>{{ settings.MODE_LABELS[route.mode] }}模式</strong>
                <span :data-testid="`mode-${route.mode}-target`">实际目标：{{ routeTarget(route.primaryProfileId) }}</span>
              </header>
              <div class="model-route-fields">
                <div class="model-field">
                  <label :for="`mode-${route.mode}-primary`">主模型档案</label>
                  <select :id="`mode-${route.mode}-primary`" v-model="route.primaryProfileId" required>
                    <option value="" disabled>请选择档案</option>
                    <option
                      v-for="item in settings.profiles.value"
                      :key="item.id"
                      :value="item.id"
                      :disabled="!settings.profileSupportsMode(item)"
                    >
                      {{ item.label }} · {{ settings.connectionName(item.connectionId) }}
                    </option>
                  </select>
                </div>
                <div class="model-field">
                  <label :for="`mode-${route.mode}-fallbacks`">Fallback 顺序（可多选）</label>
                  <select :id="`mode-${route.mode}-fallbacks`" v-model="route.fallbackProfileIds" multiple>
                    <option
                      v-for="item in settings.profiles.value"
                      :key="item.id"
                      :value="item.id"
                      :disabled="item.id === route.primaryProfileId || !settings.profileSupportsMode(item)"
                    >
                      {{ item.label }} · {{ settings.connectionName(item.connectionId) }}
                    </option>
                  </select>
                </div>
              </div>
            </article>
          </fieldset>

          <fieldset class="model-route-group" :disabled="settings.profiles.value.length === 0">
            <legend>六类 Agent 角色覆盖</legend>
            <article v-for="route in settings.roleRoutes" :key="route.role" class="model-route-card model-route-card--role">
              <header>
                <label class="model-check model-check--strong" :for="`role-${route.role}-enabled`">
                  <input :id="`role-${route.role}-enabled`" v-model="route.enabled" type="checkbox" />
                  {{ settings.ROLE_LABELS[route.role] }}角色
                </label>
                <span>{{ roleRequirement(route.role) }}</span>
              </header>
              <div class="model-route-fields" :aria-disabled="!route.enabled">
                <div class="model-field">
                  <label :for="`role-${route.role}-mode`">使用模式</label>
                  <select :id="`role-${route.role}-mode`" v-model="route.mode" :disabled="!route.enabled">
                    <option v-for="mode in settings.GENERATION_MODES" :key="mode" :value="mode">
                      {{ settings.MODE_LABELS[mode] }}
                    </option>
                  </select>
                </div>
                <div class="model-field">
                  <label :for="`role-${route.role}-primary`">主模型档案</label>
                  <select :id="`role-${route.role}-primary`" v-model="route.primaryProfileId" :disabled="!route.enabled" required>
                    <option value="" disabled>请选择档案</option>
                    <option
                      v-for="item in settings.profiles.value"
                      :key="item.id"
                      :value="item.id"
                      :disabled="!settings.profileSupportsRole(item, route.role)"
                    >
                      {{ item.label }} · {{ settings.connectionName(item.connectionId) }}
                    </option>
                  </select>
                </div>
                <div class="model-field">
                  <label :for="`role-${route.role}-fallbacks`">Fallback 顺序（可多选）</label>
                  <select :id="`role-${route.role}-fallbacks`" v-model="route.fallbackProfileIds" :disabled="!route.enabled" multiple>
                    <option
                      v-for="item in settings.profiles.value"
                      :key="item.id"
                      :value="item.id"
                      :disabled="item.id === route.primaryProfileId || !settings.profileSupportsRole(item, route.role)"
                    >
                      {{ item.label }} · {{ settings.connectionName(item.connectionId) }}
                    </option>
                  </select>
                </div>
              </div>
              <p v-if="route.enabled" class="model-route-target">实际目标：{{ routeTarget(route.primaryProfileId) }}</p>
            </article>
          </fieldset>

          <aside v-if="settings.crossProviderTargets.value.length > 0" class="model-cross-provider" data-testid="cross-provider-warning">
            <div>
              <strong>检测到跨供应商 fallback</strong>
              <p>失败转移时，当前项目内容可能发送到以下供应商目标：</p>
              <ul>
                <li v-for="target in settings.crossProviderTargets.value" :key="target">{{ target }}</li>
              </ul>
            </div>
            <label class="model-check model-check--confirm" for="confirm-cross-provider">
              <input id="confirm-cross-provider" v-model="settings.confirmCrossProvider.value" type="checkbox" />
              我确认以上跨供应商数据路由
            </label>
          </aside>

          <div class="model-form__actions model-form__actions--bindings">
            <button class="model-button model-button--primary" type="submit" :disabled="!settings.canSaveBindings.value">
              {{ settings.bindingsBusy.value ? '正在保存…' : '保存角色绑定' }}
            </button>
          </div>
          <p v-if="settings.bindingsError.value" class="model-form-error" data-testid="bindings-error" role="alert">
            {{ settings.bindingsError.value }}
          </p>
          <p v-if="settings.bindingsStatus.value" class="model-form-status" role="status" aria-live="polite">
            {{ settings.bindingsStatus.value }}
          </p>
        </form>
      </section>
    </div>
  </main>
</template>
