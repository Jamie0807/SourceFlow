import { describe, expect, it } from 'vitest';

import { MockAiProvider } from './mock.provider.js';

describe('MockAiProvider', () => {
  it('返回确定性结果且不读取媒体 URL', async () => {
    await expect(
      new MockAiProvider().transcribe({
        mediaUrl: 'https://example.test/a.mp4?signature=secret',
        mediaFormat: 'mp4',
      }),
    ).resolves.toMatchObject({ provider: 'mock', transcript: 'Mock transcript' });
    await expect(new MockAiProvider().analyze({ transcript: '任意文本' })).resolves.toMatchObject({
      provider: 'mock',
      riskFlags: [],
    });
  });

  it('对已取消的调用返回安全取消错误', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      new MockAiProvider().analyze({ transcript: '任意文本' }, controller.signal),
    ).rejects.toMatchObject({ kind: 'cancelled', retryable: false });
  });
});
