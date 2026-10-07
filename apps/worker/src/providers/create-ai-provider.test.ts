import { describe, expect, it, vi } from 'vitest';

import type { AiProviderConfig } from './provider-config.js';
import type { HttpClient, HttpResponse, Sleep } from './http-client.js';
import { createAiProvider } from './create-ai-provider.js';
import { MockAiProvider } from './mock.provider.js';
import { VolcengineProvider } from './volcengine.provider.js';

const volcengineConfig: Extract<AiProviderConfig, { kind: 'volcengine' }> = {
  kind: 'volcengine',
  lasApiKey: 'las-test-key',
  arkApiKey: 'ark-test-key',
  lasSubmitUrl: 'https://las.example.test/submit',
  lasPollUrl: 'https://las.example.test/poll',
  lasResource: 'bigasr',
  lasPollIntervalMs: 100,
  lasTimeoutMs: 60_000,
  arkBaseUrl: 'https://ark.example.test/api/v3',
  arkModel: 'test-ark-model',
  arkTimeoutMs: 1_000,
};

const jsonResponse = (status: number, body: unknown): HttpResponse => ({
  status,
  json: async () => body,
});

class FakeHttpClient implements HttpClient {
  readonly requests: Array<Readonly<{ url: string; body: unknown }>> = [];

  constructor(private readonly responses: readonly HttpResponse[]) {}

  async postJson(
    url: string,
    options: Readonly<{
      headers: Readonly<Record<string, string>>;
      body: unknown;
      signal?: AbortSignal;
    }>,
  ): Promise<HttpResponse> {
    this.requests.push({ url, body: options.body });
    const response = this.responses[this.requests.length - 1];
    if (response === undefined) throw new Error('unexpected HTTP request');
    return response;
  }
}

describe('createAiProvider', () => {
  it('为 mock 配置返回 MockAiProvider', () => {
    expect(createAiProvider({ kind: 'mock' })).toBeInstanceOf(MockAiProvider);
  });

  it('为真实配置使用注入 HTTP 构造 LAS 与 Ark', async () => {
    const http = new FakeHttpClient([
      jsonResponse(200, {
        metadata: { task_id: 'las-1', task_status: 'COMPLETED', business_code: '0' },
        result: { text: '转写结果', utterances: [] },
      }),
      jsonResponse(200, {
        id: 'ark-1',
        choices: [
          {
            message: {
              content: JSON.stringify({
                chapters: [],
                keyPoints: [],
                quotes: [],
                candidateClips: [],
                riskFlags: [],
              }),
            },
          },
        ],
      }),
    ]);
    const sleep: Sleep = vi.fn(async () => undefined);
    const provider = createAiProvider(volcengineConfig, { http, sleep });

    expect(provider).toBeInstanceOf(VolcengineProvider);
    await expect(
      provider.transcribe({
        mediaUrl: 'https://media.example.test/episode.mp4',
        mediaFormat: 'mp4',
      }),
    ).resolves.toMatchObject({ provider: 'volcengine', transcript: '转写结果' });
    await expect(provider.analyze({ transcript: '转写结果' })).resolves.toMatchObject({
      provider: 'volcengine',
      model: 'test-ark-model',
    });
    expect(http.requests.map((request) => request.url)).toEqual([
      volcengineConfig.lasSubmitUrl,
      `${volcengineConfig.arkBaseUrl}/chat/completions`,
    ]);
    expect(sleep).not.toHaveBeenCalled();
  });
});
