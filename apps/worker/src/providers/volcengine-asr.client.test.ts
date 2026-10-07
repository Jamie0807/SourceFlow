// cspell:ignore Volcengine volcengine bigasr bigmodel
import { describe, expect, it } from 'vitest';

import type { HttpClient, HttpResponse, Sleep } from './http-client.js';
import { VolcengineAsrClient, type VolcengineAsrClientConfig } from './volcengine-asr.client.js';

type ResponseBody = unknown | (() => unknown);

const jsonResponse = (status: number, body: ResponseBody): HttpResponse => ({
  status,
  json: async () => (typeof body === 'function' ? body() : body),
});

class FakeHttpClient implements HttpClient {
  readonly requests: Array<
    Readonly<{ url: string; headers: Readonly<Record<string, string>>; body: unknown }>
  > = [];

  constructor(private readonly responses: readonly HttpResponse[]) {}

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
    if (!response) throw new Error('unexpected HTTP request');
    return response;
  }
}

const validInput = {
  mediaUrl: 'https://media.example.test/episode.mp4',
  mediaFormat: 'mp4' as const,
};

const config: VolcengineAsrClientConfig = {
  lasApiKey: 'las-test-key',
  lasSubmitUrl: 'https://las.example.test/submit',
  lasPollUrl: 'https://las.example.test/poll',
  lasResource: 'bigasr',
  lasPollIntervalMs: 25,
  lasTimeoutMs: 100,
};

const noWait: Sleep = async () => undefined;

const clientFor = (
  http: HttpClient,
  options: Readonly<{
    sleep?: Sleep;
    now?: () => number;
    config?: VolcengineAsrClientConfig;
  }> = {},
): VolcengineAsrClient =>
  new VolcengineAsrClient(options.config ?? config, http, options.sleep ?? noWait, options.now);

describe('VolcengineAsrClient', () => {
  it('以 Bearer LAS key 提交 HTTPS 媒体并轮询至完成', async () => {
    const http = new FakeHttpClient([
      jsonResponse(200, {
        metadata: { task_id: 'las-1', task_status: 'PENDING', business_code: '0' },
      }),
      jsonResponse(200, {
        metadata: {
          task_id: 'las-1',
          task_status: 'COMPLETED',
          business_code: '0',
          request_id: 'poll-request-id',
        },
        result: {
          text: '转写结果',
          utterances: [
            { start_time: 0, end_time: 900, text: '转写', speaker: 'speaker-1' },
            { start_time: 900, end_time: 1500, text: '结果' },
          ],
        },
      }),
    ]);
    const sleeps: number[] = [];

    await expect(
      clientFor(http, { sleep: async (milliseconds) => void sleeps.push(milliseconds) }).transcribe(
        validInput,
      ),
    ).resolves.toEqual({
      provider: 'volcengine',
      model: 'las_asr_pro',
      transcript: '转写结果',
      utterances: [
        { startMs: 0, endMs: 900, text: '转写', speaker: 'speaker-1' },
        { startMs: 900, endMs: 1500, text: '结果' },
      ],
      requestId: 'poll-request-id',
    });
    expect(http.requests).toEqual([
      {
        url: config.lasSubmitUrl,
        headers: { Authorization: 'Bearer las-test-key', 'Content-Type': 'application/json' },
        body: {
          operator_id: 'las_asr_pro',
          operator_version: 'v2',
          data: {
            resource: 'bigasr',
            audio: { url: validInput.mediaUrl, format: 'mp4' },
            request: { model_name: 'bigmodel', show_utterances: true },
          },
        },
      },
      {
        url: config.lasPollUrl,
        headers: { Authorization: 'Bearer las-test-key', 'Content-Type': 'application/json' },
        body: { task_id: 'las-1' },
      },
    ]);
    expect(sleeps).toEqual([25]);
  });

  it.each([
    [401, 'authentication', false],
    [429, 'rate_limited', true],
    [500, 'remote_failure', true],
  ] as const)('安全映射 LAS HTTP %s', async (status, kind, retryable) => {
    const secret = 'upstream-content?signature=hidden';

    await expect(
      clientFor(new FakeHttpClient([jsonResponse(status, { detail: secret })])).transcribe(
        validInput,
      ),
    ).rejects.toMatchObject({
      kind,
      retryable,
      message: expect.not.stringContaining(secret),
    });
  });

  it.each([
    ['空响应体', undefined],
    ['畸形 metadata', { metadata: 'not-an-object' }],
    ['缺失 task id', { metadata: { task_status: 'PENDING', business_code: '0' } }],
    ['未知状态', { metadata: { task_id: 'las-1', task_status: 'MYSTERY', business_code: '0' } }],
  ] as const)('将%s安全映射为 remote_failure', async (_label, body) => {
    await expect(
      clientFor(new FakeHttpClient([jsonResponse(200, body)])).transcribe(validInput),
    ).rejects.toMatchObject({
      kind: 'remote_failure',
      retryable: true,
    });
  });

  it('将 LAS FAILED 和 TIMEOUT 状态映射为安全错误', async () => {
    for (const taskStatus of ['FAILED', 'TIMEOUT'] as const) {
      await expect(
        clientFor(
          new FakeHttpClient([
            jsonResponse(200, {
              metadata: {
                task_id: 'las-1',
                task_status: taskStatus,
                business_code: '0',
                error_msg: 'private upstream detail',
              },
            }),
          ]),
        ).transcribe(validInput),
      ).rejects.toMatchObject({ kind: taskStatus === 'TIMEOUT' ? 'timeout' : 'remote_failure' });
    }
  });

  it('超出单调总时限后不再发送下一次 Poll', async () => {
    const http = new FakeHttpClient([
      jsonResponse(200, {
        metadata: { task_id: 'las-1', task_status: 'PENDING', business_code: '0' },
      }),
    ]);
    const clock = [0, 0, 101];

    await expect(
      clientFor(http, { now: () => clock.shift() ?? 101 }).transcribe(validInput),
    ).rejects.toMatchObject({
      kind: 'timeout',
      retryable: true,
    });
    expect(http.requests).toHaveLength(1);
  });

  it('取消只停止本地轮询且不发送下一次 LAS 请求', async () => {
    const controller = new AbortController();
    const http = new FakeHttpClient([
      jsonResponse(200, {
        metadata: { task_id: 'las-1', task_status: 'RUNNING', business_code: '0' },
      }),
    ]);
    const sleep: Sleep = async (_milliseconds, signal) => {
      controller.abort();
      if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    };

    await expect(
      clientFor(http, { sleep }).transcribe(validInput, controller.signal),
    ).rejects.toMatchObject({
      kind: 'cancelled',
      retryable: false,
    });
    expect(http.requests).toHaveLength(1);
  });

  it('在提交前拒绝 URL 凭证且不泄露 URL query 或 LAS key', async () => {
    const http = new FakeHttpClient([]);
    const unsafeInput = {
      mediaUrl: 'https://user:password@media.example.test/episode.mp4?signature=hidden',
      mediaFormat: 'mp4' as const,
    };

    await expect(clientFor(http).transcribe(unsafeInput)).rejects.toMatchObject({
      kind: 'invalid_input',
      retryable: false,
      message: expect.not.stringContaining('signature=hidden'),
    });
    expect(http.requests).toHaveLength(0);
  });

  it('将响应 getter 抛出的异常安全映射而不暴露上游内容', async () => {
    const secret = 'getter-leaked-content';
    const body = Object.create(null) as { readonly metadata: unknown };
    Object.defineProperty(body, 'metadata', {
      get() {
        throw new Error(secret);
      },
    });

    await expect(
      clientFor(new FakeHttpClient([jsonResponse(200, body)])).transcribe(validInput),
    ).rejects.toMatchObject({
      kind: 'remote_failure',
      retryable: true,
      message: expect.not.stringContaining(secret),
    });
  });
});
