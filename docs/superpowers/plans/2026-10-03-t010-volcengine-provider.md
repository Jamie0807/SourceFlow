# T010 火山引擎 Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`（推荐）或 `executing-plans` 逐任务执行。本计划用复选框跟踪进度。

**Goal:** 为后续内容处理编排提供可替换、可测试的 Mock 与火山引擎 LAS/Ark AI Provider，不改变 T009 Worker 的生产注册或业务持久化。

**Architecture:** `packages/domain` 定义不暴露 HTTP/密钥的 `AiProvider` 契约和安全错误分类。Worker 的 Mock 与 Volcengine 实现使用注入式 HTTP/Sleep 依赖；LAS 负责 HTTPS 媒体 URL 的异步 Submit/Poll 转写，Ark 负责严格 JSON 的文本分析。Provider factory 仅在显式 `AI_PROVIDER=volcengine` 时校验密钥；T011/T013 才负责私有对象签名 URL、转写持久化和将 Provider 注册进任务编排。

**Tech Stack:** TypeScript strict、Node 原生 `fetch`、Vitest、火山引擎 LAS `las_asr_pro`、火山方舟 OpenAI 兼容 Chat Completions、pnpm。

## Global Constraints

- 本计划属于 Spec Kit feature `content-batch-pipeline` 的 T010，基线为 `main` 的 T009 提交 `8c58bfd`。
- 在 `feat/content-batch-volcengine-provider` 独立 Worktree 实现；不得在 `main` 或 T009 Worktree 直接写生产代码。
- 所有行为先写 Vitest 失败测试，再实现最小代码，再运行回归测试；测试不得访问真实账号。
- 默认 `AI_PROVIDER=mock`；真实模式只通过环境变量读取 `LAS_API_KEY` 与 `ARK_API_KEY`，不得写入源码、测试、日志或 Git。
- 真实 LAS 输入由调用方提供 HTTPS 媒体 URL；T010 不访问 MinIO/OSS、不签名 URL、不读取 `TaskRun`、不持久化转写或洞察。
- 日志、异常和结果不得泄露 API Key、Authorization、URL 查询参数、媒体正文、Ark prompt 或原始上游错误。
- 所有取消仅中止本地 LAS 轮询；不声称已取消远端 LAS 作业。
- 不自动 `git commit`、push、合并或删除 Worktree。用户明确要求提交时，只能通过 `pnpm commit`。

---

## 文件结构与依赖顺序

| 文件                                                      | 职责                                         | 创建任务 |
| --------------------------------------------------------- | -------------------------------------------- | -------- |
| `packages/domain/src/ai-provider.ts`                      | 共享输入、输出、错误分类和 `AiProvider` 契约 | 1        |
| `packages/domain/src/ai-provider.test.ts`                 | 契约构造器与 JSON-safe 边界测试              | 1        |
| `packages/domain/src/index.ts`                            | 导出 Provider 领域契约                       | 1        |
| `apps/worker/src/providers/provider-config.ts`            | 环境变量解析与 Mock/真实模式配置联合类型     | 2        |
| `apps/worker/src/providers/provider-config.test.ts`       | 默认 Mock、缺失密钥与数值边界测试            | 2        |
| `apps/worker/src/providers/mock.provider.ts`              | 确定性 Mock Provider                         | 2        |
| `apps/worker/src/providers/mock.provider.test.ts`         | Mock 成功、取消与不变性测试                  | 2        |
| `apps/worker/src/providers/http-client.ts`                | 可注入 HTTP 与等待端口                       | 3        |
| `apps/worker/src/providers/volcengine-asr.client.ts`      | LAS Submit/Poll、轮询、取消与响应归一化      | 3        |
| `apps/worker/src/providers/volcengine-asr.client.test.ts` | LAS HTTP、状态、超时和安全错误测试           | 3        |
| `apps/worker/src/providers/ark-text.client.ts`            | Ark Chat Completions 与严格结果解析          | 4        |
| `apps/worker/src/providers/ark-text.client.test.ts`       | Ark 成功、结构不合法与错误映射测试           | 4        |
| `apps/worker/src/providers/volcengine.provider.ts`        | 组合 LAS/Ark 客户端的 `AiProvider` 实现      | 4        |
| `apps/worker/src/providers/volcengine.provider.test.ts`   | 委派与跨客户端错误保留测试                   | 4        |
| `apps/worker/src/providers/create-ai-provider.ts`         | 根据配置构造 Mock 或 Volcengine Provider     | 5        |
| `apps/worker/src/providers/create-ai-provider.test.ts`    | factory 选择与依赖注入测试                   | 5        |
| `apps/worker/scripts/volcengine-provider.smoke.ts`        | 显式开启的真实 Provider smoke                | 5        |
| `apps/worker/package.json`                                | 增加仅手动运行的 smoke 脚本                  | 5        |
| `Docker/compose/.env.example`、`Docker/README.md`         | 无秘密的环境变量说明与 smoke 说明            | 5        |
| `specs/content-batch-pipeline/tasks.md`                   | T010 验收项与已知不在范围项追踪              | 6        |

任务 1 → 2 → 3 → 4 → 5 → 6 为串行链：后续任务依赖先前稳定的领域类型和错误命名。Task 3 与 Task 4 修改不同客户端文件，但 Task 4 消费 Task 3 的共享 HTTP 类型；为避免重复定义，保持串行。

## 统一接口

任务 1 必须定义以下公共 API，后续任务只能使用这些名称：

```ts
export type ProviderFailureKind =
  | 'authentication'
  | 'rate_limited'
  | 'timeout'
  | 'invalid_input'
  | 'remote_failure'
  | 'cancelled'
  | 'unknown';

export class AiProviderError extends Error {
  readonly kind: ProviderFailureKind;
  readonly retryable: boolean;
}

export type TranscriptionInput = Readonly<{
  mediaUrl: string;
  mediaFormat: 'mp3' | 'wav' | 'ogg' | 'mp4';
}>;

export type TranscriptionResult = Readonly<{
  provider: 'mock' | 'volcengine';
  model: string;
  transcript: string;
  utterances: readonly Readonly<{
    startMs: number;
    endMs: number;
    text: string;
    speaker?: string;
  }>[];
  requestId?: string;
}>;

export type TextAnalysisInput = Readonly<{ transcript: string }>;
export type TextAnalysisResult = Readonly<{
  provider: 'mock' | 'volcengine';
  model: string;
  chapters: readonly Readonly<{ title: string; summary: string }>[];
  keyPoints: readonly string[];
  quotes: readonly string[];
  candidateClips: readonly Readonly<{ startMs: number; endMs: number; reason: string }>[];
  riskFlags: readonly string[];
  requestId?: string;
}>;

export interface AiProvider {
  transcribe(input: TranscriptionInput, signal?: AbortSignal): Promise<TranscriptionResult>;
  analyze(input: TextAnalysisInput, signal?: AbortSignal): Promise<TextAnalysisResult>;
}
```

`AiProviderError` 的公开 `message` 必须是固定安全文案。调用者通过 `kind` 和 `retryable` 决策，不得解析 message。

### Task 1: 建立领域 Provider 契约

**Files:**

- Create: `packages/domain/src/ai-provider.ts`
- Create: `packages/domain/src/ai-provider.test.ts`
- Modify: `packages/domain/src/index.ts`

**Consumes:** T009 的 `JsonValue`/TypeScript strict 工程边界；不消费 Worker 实现。

**Produces:** 上述 `AiProvider`、`AiProviderError`、输入/输出类型和 `isHttpsMediaUrl`，供 Tasks 2–5 使用。

- [ ] **Step 1: 写失败的领域契约测试。**

```ts
import { AiProviderError, isHttpsMediaUrl } from './ai-provider.js';

it('只接受无凭证的 HTTPS 媒体 URL', () => {
  expect(isHttpsMediaUrl('https://cdn.example.test/a.mp4')).toBe(true);
  expect(isHttpsMediaUrl('http://cdn.example.test/a.mp4')).toBe(false);
  expect(isHttpsMediaUrl('https://key@example.test/a.mp4')).toBe(false);
});

it('公开错误文案不包含上游原因', () => {
  const error = new AiProviderError('authentication', false, 'secret upstream response');
  expect(error.message).toBe('AI Provider authentication failed');
  expect(error.message).not.toContain('secret');
});
```

- [ ] **Step 2: 运行失败测试。**

Run: `corepack pnpm test:unit -- --run packages/domain/src/ai-provider.test.ts`

Expected: FAIL，模块或导出尚不存在。

- [ ] **Step 3: 实现最小的不可变契约与安全构造器。**

```ts
const safeMessages: Record<ProviderFailureKind, string> = {
  authentication: 'AI Provider authentication failed',
  rate_limited: 'AI Provider rate limited',
  timeout: 'AI Provider timed out',
  invalid_input: 'AI Provider rejected the input',
  remote_failure: 'AI Provider is temporarily unavailable',
  cancelled: 'AI Provider request cancelled',
  unknown: 'AI Provider failed',
};

export const isHttpsMediaUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username.length === 0 && url.password.length === 0;
  } catch {
    return false;
  }
};
```

构造器只保存 `kind`、`retryable` 和固定文案；不得存储第三个参数或将其附到 `cause`。验证 `mediaFormat`、非空 transcript、非负且递增的 utterance/clip 时间范围，并拒绝非 JSON-safe 返回值。

- [ ] **Step 4: 导出并验证。**

Run: `corepack pnpm test:unit -- --run packages/domain/src/ai-provider.test.ts && corepack pnpm --filter @sourceflow/domain build`

Expected: 测试通过，领域包构建退出码为 0。

- [ ] **Step 5: 任务审查与提交边界。**

审查契约不包含 HTTP、环境变量、密钥或存储实现。不要自动提交；若用户明确要求，暂存本任务文件并使用 `pnpm commit`。

### Task 2: 实现 Mock 与真实模式配置解析

**Files:**

- Create: `apps/worker/src/providers/provider-config.ts`
- Create: `apps/worker/src/providers/provider-config.test.ts`
- Create: `apps/worker/src/providers/mock.provider.ts`
- Create: `apps/worker/src/providers/mock.provider.test.ts`

**Consumes:** Task 1 的 `AiProvider`、结果类型、`AiProviderError`。

**Produces:** `parseAiProviderConfig(environment)`、`MockAiProvider` 与判别联合 `AiProviderConfig`，供 Tasks 3–5 使用。

- [ ] **Step 1: 写失败配置和 Mock 测试。**

```ts
it('默认选择 mock 而且不要求真实密钥', () => {
  expect(parseAiProviderConfig({})).toEqual({ kind: 'mock' });
});

it('真实模式缺少 LAS_API_KEY 时返回固定配置错误', () => {
  expect(() => parseAiProviderConfig({ AI_PROVIDER: 'volcengine', ARK_API_KEY: 'ark' })).toThrow(
    'AI Provider configuration error: LAS_API_KEY is required',
  );
});

it('Mock 返回确定性结果且不读取媒体 URL', async () => {
  await expect(
    new MockAiProvider().transcribe({ mediaUrl: 'https://example.test/a.mp4', mediaFormat: 'mp4' }),
  ).resolves.toMatchObject({ provider: 'mock', transcript: 'Mock transcript' });
});
```

- [ ] **Step 2: 运行失败测试。**

Run: `corepack pnpm test:unit -- --run apps/worker/src/providers/provider-config.test.ts apps/worker/src/providers/mock.provider.test.ts`

Expected: FAIL，文件和类尚不存在。

- [ ] **Step 3: 实现配置联合与 Mock。**

```ts
export type AiProviderConfig =
  | Readonly<{ kind: 'mock' }>
  | Readonly<{
      kind: 'volcengine';
      lasApiKey: string;
      arkApiKey: string;
      lasSubmitUrl: string;
      lasPollUrl: string;
      lasResource: 'seedasr' | 'bigasr';
      lasPollIntervalMs: number;
      lasTimeoutMs: number;
      arkBaseUrl: string;
      arkModel: string;
    }>;

export function parseAiProviderConfig(
  environment: Readonly<Record<string, string | undefined>>,
): AiProviderConfig {
  if (environment.AI_PROVIDER === undefined || environment.AI_PROVIDER === 'mock')
    return { kind: 'mock' };
  if (environment.AI_PROVIDER !== 'volcengine')
    throw new Error('AI Provider configuration error: AI_PROVIDER is invalid');
  // 按 LAS、Ark、URL、resource、轮询数值顺序进行固定文案校验。
}
```

默认 LAS Submit/Poll URL 使用设计稿中的官方地址，默认 `resource=bigasr`、轮询 2 秒、总超时 30 分钟；只接受 100–60,000ms 轮询间隔和 60,000–3,600,000ms 总超时。Mock 的 `analyze` 返回固定、合法的空风险结果；当 signal 已 aborted 时抛 `AiProviderError('cancelled', false)`。

- [ ] **Step 4: 验证通过和回归。**

Run: `corepack pnpm test:unit -- --run apps/worker/src/providers/provider-config.test.ts apps/worker/src/providers/mock.provider.test.ts packages/domain/src/ai-provider.test.ts`

Expected: 所有指定测试通过。

- [ ] **Step 5: 任务审查与提交边界。**

确认没有把真实 key 默认值、环境原文或原始配置写入错误；不要自动提交。

### Task 3: 实现 LAS 异步转写客户端

**Files:**

- Create: `apps/worker/src/providers/http-client.ts`
- Create: `apps/worker/src/providers/volcengine-asr.client.ts`
- Create: `apps/worker/src/providers/volcengine-asr.client.test.ts`

**Consumes:** Task 1 的 `TranscriptionInput`/`TranscriptionResult`/`AiProviderError` 与 Task 2 的 Volcengine LAS 配置字段。

**Produces:** `VolcengineAsrClient.transcribe(input, signal?)`，供 Task 4 的组合 Provider 使用。

- [ ] **Step 1: 写 LAS 请求、轮询和错误映射的失败测试。**

```ts
it('以 Bearer LAS key 提交 HTTPS 媒体并轮询至完成', async () => {
  const http = new FakeHttpClient([
    jsonResponse(200, {
      metadata: { task_id: 'las-1', task_status: 'PENDING', business_code: '0' },
    }),
    jsonResponse(200, {
      metadata: { task_id: 'las-1', task_status: 'COMPLETED', business_code: '0' },
      result: { text: '转写', utterances: [] },
    }),
  ]);
  await expect(
    clientFor(http).transcribe({
      mediaUrl: 'https://media.example.test/a.mp4',
      mediaFormat: 'mp4',
    }),
  ).resolves.toMatchObject({ provider: 'volcengine', transcript: '转写' });
  expect(http.requests[0]?.headers.Authorization).toBe('Bearer las-test-key');
});

it.each([
  [401, 'authentication', false],
  [429, 'rate_limited', true],
  [500, 'remote_failure', true],
])('maps LAS HTTP %s safely', async (status, kind, retryable) => {
  await expect(
    clientFor(new FakeHttpClient([jsonResponse(status, { detail: 'secret' })])).transcribe(
      validInput,
    ),
  ).rejects.toMatchObject({ kind, retryable, message: expect.not.stringContaining('secret') });
});
```

- [ ] **Step 2: 运行失败测试。**

Run: `corepack pnpm test:unit -- --run apps/worker/src/providers/volcengine-asr.client.test.ts`

Expected: FAIL，LAS 客户端尚不存在。

- [ ] **Step 3: 实现可注入 HTTP/Sleep 端口和 LAS 客户端。**

```ts
export interface HttpClient {
  postJson(
    url: string,
    options: Readonly<{
      headers: Readonly<Record<string, string>>;
      body: unknown;
      signal?: AbortSignal;
    }>,
  ): Promise<HttpResponse>;
}
export type Sleep = (milliseconds: number, signal?: AbortSignal) => Promise<void>;

await http.postJson(config.lasSubmitUrl, {
  headers: { Authorization: `Bearer ${config.lasApiKey}`, 'Content-Type': 'application/json' },
  body: {
    operator_id: 'las_asr_pro',
    operator_version: 'v2',
    data: {
      resource: config.lasResource,
      audio: { url: input.mediaUrl, format: input.mediaFormat },
      request: { model_name: 'bigmodel', show_utterances: true },
    },
  },
  signal,
});
```

提交前用 `isHttpsMediaUrl` 验证输入。只接受 `metadata.business_code === '0'` 且非空 task id；对 PENDING/RUNNING 执行注入的 sleep 后 Poll，对 COMPLETED 解析 text 与可选 utterances，对 FAILED/TIMEOUT 映射安全错误。总超时用单调 elapsed 值判断；signal aborted 前后都映射 `cancelled`，不再发送下一次 Poll。HTTP response body 必须一次性解析为未知值并逐字段收窄；绝不把响应中的 `error_msg` 拼进错误 message。

- [ ] **Step 4: 覆盖所有终止路径。**

增加空 body、畸形 metadata、缺失 task id、未知状态、Poll request ID、超时、sleep 被中止、getter 抛错和 URL 凭证字段的测试。

Run: `corepack pnpm test:unit -- --run apps/worker/src/providers/volcengine-asr.client.test.ts`

Expected: 所有 LAS 测试通过，且不发生真实网络请求。

- [ ] **Step 5: 任务审查与提交边界。**

审查所有 `Authorization` 仅传给 HTTP 层，测试断言异常和返回值均没有 key 或 URL 查询参数；不要自动提交。

### Task 4: 实现 Ark 文本分析客户端与组合 Provider

**Files:**

- Create: `apps/worker/src/providers/ark-text.client.ts`
- Create: `apps/worker/src/providers/ark-text.client.test.ts`
- Create: `apps/worker/src/providers/volcengine.provider.ts`
- Create: `apps/worker/src/providers/volcengine.provider.test.ts`

**Consumes:** Tasks 1–3 的 Provider 类型、HTTP 端口、Volcengine 配置和 LAS 客户端。

**Produces:** `ArkTextClient.analyze(input, signal?)` 与完整 `VolcengineProvider implements AiProvider`，供 Task 5 factory 使用。

- [ ] **Step 1: 写 Ark 契约及组合委派的失败测试。**

```ts
it('发送 Ark Bearer 请求并验证结构化 JSON 内容', async () => {
  const client = arkClientFor(
    new FakeHttpClient([
      jsonResponse(200, {
        id: 'ark-request-1',
        choices: [{ message: { content: JSON.stringify(validAnalysis) } }],
      }),
    ]),
  );
  await expect(client.analyze({ transcript: '原始转写' })).resolves.toMatchObject({
    provider: 'volcengine',
    model: 'doubao-test',
  });
});

it('拒绝缺少 candidateClips 的模型输出', async () => {
  await expect(
    arkClientFor(responseWithContent('{"chapters":[]}')).analyze({ transcript: 'x' }),
  ).rejects.toMatchObject({ kind: 'invalid_input', retryable: false });
});

it('组合 Provider 分别委派转写与分析', async () => {
  const provider = new VolcengineProvider(asr, ark);
  await provider.transcribe(validInput);
  await provider.analyze({ transcript: 'x' });
  expect(asr.transcribe).toHaveBeenCalledOnce();
  expect(ark.analyze).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: 运行失败测试。**

Run: `corepack pnpm test:unit -- --run apps/worker/src/providers/ark-text.client.test.ts apps/worker/src/providers/volcengine.provider.test.ts`

Expected: FAIL，Ark client 与组合 Provider 尚不存在。

- [ ] **Step 3: 实现 Ark 请求与严格 JSON 校验。**

```ts
const response = await http.postJson(`${config.arkBaseUrl}/chat/completions`, {
  headers: { Authorization: `Bearer ${config.arkApiKey}`, 'Content-Type': 'application/json' },
  body: {
    model: config.arkModel,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'Return only JSON with chapters, keyPoints, quotes, candidateClips, and riskFlags.',
      },
      { role: 'user', content: input.transcript },
    ],
  },
  signal,
});
```

严格收窄 `choices[0].message.content`，解析后验证每个必填数组、chapter `{title, summary}` 和 clip 的非负递增毫秒范围。401/403 → `authentication,false`；429 → `rate_limited,true`；请求中止 → `cancelled,false`；5xx/网络 → `remote_failure,true`；JSON 或 schema 异常 → `invalid_input,false`；未分类异常 → `unknown,true`。不把 prompt 或原始 content 放进错误对象。

- [ ] **Step 4: 实现组合层并运行回归。**

```ts
export class VolcengineProvider implements AiProvider {
  constructor(
    private readonly asr: Pick<AiProvider, 'transcribe'>,
    private readonly ark: Pick<AiProvider, 'analyze'>,
  ) {}
  transcribe(input: TranscriptionInput, signal?: AbortSignal) {
    return this.asr.transcribe(input, signal);
  }
  analyze(input: TextAnalysisInput, signal?: AbortSignal) {
    return this.ark.analyze(input, signal);
  }
}
```

Run: `corepack pnpm test:unit -- --run apps/worker/src/providers/volcengine-asr.client.test.ts apps/worker/src/providers/ark-text.client.test.ts apps/worker/src/providers/volcengine.provider.test.ts`

Expected: 所有 Provider HTTP 模拟与组合测试通过。

- [ ] **Step 5: 任务审查与提交边界。**

确认 Ark 分析不从 T009 `TaskRun` 读取文本、不写 Prisma、不修改 `main.ts` 的 Processor 注册；不要自动提交。

### Task 5: Provider factory、手动 smoke 与环境文档

**Files:**

- Create: `apps/worker/src/providers/create-ai-provider.ts`
- Create: `apps/worker/src/providers/create-ai-provider.test.ts`
- Create: `apps/worker/scripts/volcengine-provider.smoke.ts`
- Modify: `apps/worker/package.json`
- Modify: `Docker/compose/.env.example`
- Modify: `Docker/README.md`

**Consumes:** Task 2 的 `AiProviderConfig`/Mock，Tasks 3–4 的 LAS/Ark/组合 Provider。

**Produces:** `createAiProvider(config, dependencies?)`、仅显式执行的 smoke 命令和无秘密的配置说明。

- [ ] **Step 1: 写 factory 失败测试。**

```ts
it('为 mock 配置返回 MockAiProvider', () => {
  expect(createAiProvider({ kind: 'mock' })).toBeInstanceOf(MockAiProvider);
});

it('为真实配置使用注入 HTTP 构造 LAS 与 Ark', () => {
  const provider = createAiProvider(volcengineConfig, { http, sleep: vi.fn() });
  expect(provider).toBeInstanceOf(VolcengineProvider);
});
```

- [ ] **Step 2: 运行失败测试。**

Run: `corepack pnpm test:unit -- --run apps/worker/src/providers/create-ai-provider.test.ts`

Expected: FAIL，factory 尚不存在。

- [ ] **Step 3: 实现 factory 和显式 smoke 保护。**

```ts
if (process.env.RUN_VOLCENGINE_SMOKE !== 'true') {
  throw new Error('Volcengine smoke is disabled; set RUN_VOLCENGINE_SMOKE=true');
}
const mediaUrl = process.env.VOLCENGINE_SMOKE_MEDIA_URL;
if (!mediaUrl)
  throw new Error('Volcengine smoke configuration error: VOLCENGINE_SMOKE_MEDIA_URL is required');
```

factory 的默认 HTTP 实现使用 Node `fetch`，但测试必须注入 Fake HTTP。smoke 使用 `parseAiProviderConfig(process.env)`，依次执行一次转写和一次简短文本分析，只打印 provider、model、请求 ID 是否存在、转写/分析长度和安全错误 kind；不得输出媒体 URL、key、完整转写或 Ark prompt。`apps/worker/package.json` 增加 `test:volcengine:smoke`，不把它加入任何默认 test、verify 或 Husky 脚本。

`.env.example` 只列出变量名、官方 URL、非秘密默认值和注释；真实 key 值保持为空。README 必须说明 local MinIO 的 localhost URL 不可用于真实 LAS smoke，smoke 需要单独公网测试媒体。

- [ ] **Step 4: 验证工厂、文档和无网络默认测试。**

Run: `corepack pnpm test:unit -- --run apps/worker/src/providers && corepack pnpm format:check && corepack pnpm spellcheck && corepack pnpm --filter @sourceflow/worker build`

Expected: Provider 测试通过、格式/拼写/Worker 构建退出码为 0；不执行 `test:volcengine:smoke`。

- [ ] **Step 5: 任务审查与提交边界。**

审查 smoke 默认拒绝运行、文档没有秘密、`AI_PROVIDER=mock` 不需要任何火山凭证；不要自动提交。

### Task 6: 需求追踪、最终审查与验证

**Files:**

- Modify: `specs/content-batch-pipeline/tasks.md`
- Modify: `.superpowers/sdd/progress.md`
- Create: `.superpowers/sdd/t010-final-review.md`

**Consumes:** Tasks 1–5 的已审查实现及本计划。

**Produces:** T010 追踪记录、任务/最终审查结论与可复现验证证据。

- [ ] **Step 1: 更新任务追踪。**

仅在 Tasks 1–5 的代码、测试和文档均通过后，将 `tasks.md` 中 T010 已完成项标记为 `[x]`。保留并显式写明以下未完成边界：真实对象签名 URL、T009 生产 Processor 接线、转写/洞察持久化、真实 smoke（除非用户明确提供沙箱凭证并要求执行）。

- [ ] **Step 2: 执行完整无凭证质量门禁。**

Run:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm lint
corepack pnpm format:check
corepack pnpm spellcheck
corepack pnpm typecheck
corepack pnpm test:unit -- --run --coverage
corepack pnpm test:component -- --run
corepack pnpm test:integration -- --grep @smoke
corepack pnpm build:web
corepack pnpm build:api
corepack pnpm build:worker
docker compose --env-file Docker/compose/.env.example -f Docker/compose/docker-compose.yml config
git diff --check
```

Expected: 每条命令退出码为 0。若全仓或 Provider 覆盖率低于项目门槛，记录准确数值、原因、责任与补救任务；不得宣称完整 DoD 已收敛。

- [ ] **Step 3: 完成两阶段代码审查。**

任务审查逐项核验：领域边界、Mock 默认、LAS Poll 取消、Ark schema、错误分类、秘密与 URL 脱敏、T009 未接线。最终审查对比本设计稿、本计划和 T010 任务清单；所有 P0/P1 问题修复后才记录 clean 结论。

- [ ] **Step 4: 提供完成报告并等待用户整合决定。**

报告已完成项、完整命令和结果、未执行的真实 smoke、覆盖率、风险、下一依赖 T011。不要自动提交、push、合并或删除 Worktree；用户要求提交时使用 `pnpm commit`。
