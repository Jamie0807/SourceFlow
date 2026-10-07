// cspell:ignore Volcengine volcengine Ark ark json_object
import { describe, expect, it } from 'vitest';

import type { HttpClient, HttpResponse } from './http-client.js';
import { ArkTextClient, type ArkTextClientConfig } from './ark-text.client.js';

type ResponsePlan = HttpResponse | Error;

type ArkTextClientRuntime = Readonly<{
  createDeadlineSignal: (timeoutMs: number) => AbortSignal;
}>;

const jsonResponse = (status: number, body: unknown): HttpResponse => ({
  status,
  json: async () => body,
});

class FakeHttpClient implements HttpClient {
  readonly requests: Array<
    Readonly<{ url: string; headers: Readonly<Record<string, string>>; body: unknown }>
  > = [];

  constructor(private readonly responses: readonly ResponsePlan[]) {}

  async postJson(
    url: string,
    options: Readonly<{
      headers: Readonly<Record<string, string>>;
      body: unknown;
      signal?: AbortSignal;
    }>,
  ): Promise<HttpResponse> {
    this.requests.push({ url, headers: options.headers, body: options.body });
    const response = this.responses[this.requests.length - 1];
    if (response instanceof Error) throw response;
    if (!response) throw new Error('unexpected HTTP request');
    return response;
  }
}

class AbortAwareHttpClient implements HttpClient {
  requestSignal: AbortSignal | undefined;

  postJson(
    _url: string,
    options: Readonly<{
      headers: Readonly<Record<string, string>>;
      body: unknown;
      signal?: AbortSignal;
    }>,
  ): Promise<HttpResponse> {
    this.requestSignal = options.signal;
    return new Promise((_, reject) => {
      options.signal?.addEventListener(
        'abort',
        () => {
          reject(Object.assign(new Error('upstream request aborted'), { name: 'AbortError' }));
        },
        { once: true },
      );
    });
  }
}

const config: ArkTextClientConfig = {
  arkApiKey: 'test-only-key',
  arkBaseUrl: 'https://ark.example.test/api/v3',
  arkModel: 'test-ark-model',
  arkTimeoutMs: 120_000,
};

const validAnalysis = {
  chapters: [{ title: '开场', summary: '介绍主题' }],
  keyPoints: ['要点'],
  quotes: ['金句'],
  candidateClips: [{ startMs: 0, endMs: 800, reason: '信息完整' }],
  riskFlags: [],
};

const validResponse = (content: unknown = validAnalysis): HttpResponse =>
  jsonResponse(200, {
    id: 'ark-request-id',
    choices: [{ message: { content: JSON.stringify(content) } }],
  });

describe('ArkTextClient', () => {
  it('使用请求边界 Bearer、JSON object 模式并返回严格校验的分析结果', async () => {
    const http = new FakeHttpClient([validResponse()]);

    await expect(
      new ArkTextClient(config, http).analyze({ transcript: '待分析文本' }),
    ).resolves.toEqual({
      provider: 'volcengine',
      model: 'test-ark-model',
      ...validAnalysis,
      requestId: 'ark-request-id',
    });
    expect(http.requests).toEqual([
      {
        url: 'https://ark.example.test/api/v3/chat/completions',
        headers: {
          Authorization: 'Bearer test-only-key',
          'Content-Type': 'application/json',
        },
        body: expect.objectContaining({
          model: 'test-ark-model',
          response_format: { type: 'json_object' },
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'system' }),
            { role: 'user', content: '待分析文本' },
          ]),
        }),
      },
    ]);
  });

  it.each([
    [400, 'invalid_input', false],
    [401, 'authentication', false],
    [403, 'authentication', false],
    [408, 'timeout', true],
    [504, 'timeout', true],
    [429, 'rate_limited', true],
    [500, 'remote_failure', true],
  ] as const)('将 Ark HTTP %s 安全映射为 %s', async (status, kind, retryable) => {
    const upstreamContent = 'upstream?signature=must-not-leak';

    await expect(
      new ArkTextClient(
        config,
        new FakeHttpClient([jsonResponse(status, { detail: upstreamContent })]),
      ).analyze({ transcript: '待分析文本' }),
    ).rejects.toMatchObject({
      kind,
      retryable,
      message: expect.not.stringContaining(upstreamContent),
    });
  });

  it('将网络失败、取消和非法输入安全映射且不额外发送请求', async () => {
    const networkDetail = 'network?signature=must-not-leak';
    await expect(
      new ArkTextClient(config, new FakeHttpClient([new Error(networkDetail)])).analyze({
        transcript: '待分析文本',
      }),
    ).rejects.toMatchObject({
      kind: 'remote_failure',
      retryable: true,
      message: expect.not.stringContaining(networkDetail),
    });

    const abortError = Object.assign(new Error('cancelled upstream request'), {
      name: 'AbortError',
    });
    await expect(
      new ArkTextClient(config, new FakeHttpClient([abortError])).analyze({
        transcript: '待分析文本',
      }),
    ).rejects.toMatchObject({ kind: 'cancelled', retryable: false });

    const cancelledHttp = new FakeHttpClient([]);
    const controller = new AbortController();
    controller.abort();
    await expect(
      new ArkTextClient(config, cancelledHttp).analyze(
        { transcript: '待分析文本' },
        controller.signal,
      ),
    ).rejects.toMatchObject({ kind: 'cancelled', retryable: false });
    expect(cancelledHttp.requests).toHaveLength(0);

    const invalidHttp = new FakeHttpClient([]);
    await expect(
      new ArkTextClient(config, invalidHttp).analyze({ transcript: ' ' }),
    ).rejects.toMatchObject({
      kind: 'invalid_input',
      retryable: false,
    });
    expect(invalidHttp.requests).toHaveLength(0);
  });

  it('将注入的 Ark deadline 映射为可重试 timeout，且不泄露请求内容', async () => {
    const deadline = new AbortController();
    deadline.abort();
    const http = new FakeHttpClient([validResponse()]);
    const runtime: ArkTextClientRuntime = {
      createDeadlineSignal: (timeoutMs) => {
        expect(timeoutMs).toBe(120_000);
        return deadline.signal;
      },
    };

    const error = await new ArkTextClient(config, http, runtime)
      .analyze({ transcript: 'prompt?signature=must-not-leak' })
      .catch((reason: unknown) => reason);

    expect(error).toMatchObject({
      kind: 'timeout',
      retryable: true,
      message: expect.not.stringContaining('prompt?signature=must-not-leak'),
    });
    expect(http.requests).toHaveLength(0);
  });

  it('将调用方 signal 的取消优先映射为不可重试 cancelled', async () => {
    const caller = new AbortController();
    const deadline = new AbortController();
    caller.abort();
    deadline.abort();
    const runtime: ArkTextClientRuntime = {
      createDeadlineSignal: () => deadline.signal,
    };

    await expect(
      new ArkTextClient(config, new FakeHttpClient([validResponse()]), runtime).analyze(
        { transcript: '待分析文本' },
        caller.signal,
      ),
    ).rejects.toMatchObject({ kind: 'cancelled', retryable: false });
  });

  it('将组合 deadline signal 传入在途 Ark HTTP 请求并映射为 timeout', async () => {
    const caller = new AbortController();
    const deadline = new AbortController();
    const http = new AbortAwareHttpClient();
    const runtime: ArkTextClientRuntime = {
      createDeadlineSignal: () => deadline.signal,
    };
    const analysis = new ArkTextClient(config, http, runtime).analyze(
      { transcript: 'prompt?signature=must-not-leak' },
      caller.signal,
    );

    expect(http.requestSignal).toBeDefined();
    expect(http.requestSignal).not.toBe(caller.signal);
    expect(http.requestSignal).not.toBe(deadline.signal);
    expect(http.requestSignal?.aborted).toBe(false);

    deadline.abort();

    await expect(analysis).rejects.toMatchObject({
      kind: 'timeout',
      retryable: true,
      message: expect.not.stringContaining('prompt?signature=must-not-leak'),
    });
  });

  it('在途 HTTP AbortError 的 catch 路径优先映射调用方取消', async () => {
    const caller = new AbortController();
    const deadline = new AbortController();
    const http = new AbortAwareHttpClient();
    const runtime: ArkTextClientRuntime = {
      createDeadlineSignal: () => deadline.signal,
    };
    const analysis = new ArkTextClient(config, http, runtime).analyze(
      { transcript: '待分析文本' },
      caller.signal,
    );

    expect(http.requestSignal?.aborted).toBe(false);
    caller.abort();
    deadline.abort();

    await expect(analysis).rejects.toMatchObject({ kind: 'cancelled', retryable: false });
  });

  it.each([
    ['非 JSON 文本', jsonResponse(200, { choices: [{ message: { content: '{' } }] })],
    ['缺失 choices', jsonResponse(200, {})],
    ['空 choices', jsonResponse(200, { choices: [] })],
    ['空 content', jsonResponse(200, { choices: [{ message: { content: '' } }] })],
    ['缺失必填数组', validResponse({ ...validAnalysis, keyPoints: undefined })],
    [
      '无效候选片段',
      validResponse({
        ...validAnalysis,
        candidateClips: [{ startMs: 0, endMs: 0, reason: '无效' }],
      }),
    ],
    ['额外 JSON 字段', validResponse({ ...validAnalysis, ignored: 'must be rejected' })],
    [
      '章节额外字段',
      validResponse({
        ...validAnalysis,
        chapters: [{ ...validAnalysis.chapters[0], debug: 'must be rejected' }],
      }),
    ],
    [
      '候选片段额外字段',
      validResponse({
        ...validAnalysis,
        candidateClips: [{ ...validAnalysis.candidateClips[0], debug: 'must be rejected' }],
      }),
    ],
    [
      '无效 request id',
      jsonResponse(200, {
        id: '',
        choices: [{ message: { content: JSON.stringify(validAnalysis) } }],
      }),
    ],
  ] as const)('将%s严格校验并安全映射为 schema 错误', async (_label, response) => {
    await expect(
      new ArkTextClient(config, new FakeHttpClient([response])).analyze({
        transcript: '待分析文本',
      }),
    ).rejects.toMatchObject({
      kind: 'remote_failure',
      retryable: true,
    });
  });

  it('不在 schema 错误中泄露 API key、prompt、URL 查询或原始上游内容', async () => {
    const prompt = 'prompt?signature=must-not-leak';
    const upstreamContent = 'raw-upstream?signature=must-not-leak';
    const body = {
      choices: [
        {
          message: Object.defineProperty({}, 'content', {
            get() {
              throw new Error(upstreamContent);
            },
          }),
        },
      ],
    };

    const error = await new ArkTextClient(
      {
        ...config,
        arkApiKey: 'never-expose-this-key',
        arkBaseUrl: 'https://ark.example.test/api/v3?private=query',
      },
      new FakeHttpClient([jsonResponse(200, body)]),
    )
      .analyze({ transcript: prompt })
      .catch((reason: unknown) => reason);

    expect(error).toMatchObject({
      kind: 'remote_failure',
      retryable: true,
      message: expect.not.stringContaining('never-expose-this-key'),
    });
    expect(error).not.toMatchObject({ message: expect.stringContaining(prompt) });
    expect(error).not.toMatchObject({ message: expect.stringContaining('private=query') });
  });

  it('在发送 Bearer 前拒绝非 HTTPS 或带凭证的 Ark endpoint', async () => {
    const http = new FakeHttpClient([validResponse()]);
    const unsafeBaseUrl = 'http://user:password@ark.example.test/api/v3?signature=must-not-leak';

    await expect(
      new ArkTextClient({ ...config, arkBaseUrl: unsafeBaseUrl }, http).analyze({
        transcript: '待分析文本',
      }),
    ).rejects.toMatchObject({
      kind: 'remote_failure',
      retryable: true,
      message: expect.not.stringContaining('signature=must-not-leak'),
    });
    expect(http.requests).toHaveLength(0);
  });
});
