import { describe, expect, it } from 'vitest';

import { parseAiProviderConfig } from './provider-config.js';

describe('parseAiProviderConfig', () => {
  it('默认选择 mock 而且不要求真实密钥', () => {
    expect(parseAiProviderConfig({})).toEqual({ kind: 'mock' });
  });

  it('验证真实模式所需密钥和合法 provider', () => {
    expect(() => parseAiProviderConfig({ AI_PROVIDER: 'other' })).toThrow(
      'AI Provider configuration error: AI_PROVIDER is invalid',
    );
    expect(() => parseAiProviderConfig({ AI_PROVIDER: 'volcengine', ARK_API_KEY: 'ark' })).toThrow(
      'AI Provider configuration error: LAS_API_KEY is required',
    );
    expect(() => parseAiProviderConfig({ AI_PROVIDER: 'volcengine', LAS_API_KEY: 'las' })).toThrow(
      'AI Provider configuration error: ARK_API_KEY is required',
    );
  });

  it('使用安全的真实模式默认值并验证数值边界', () => {
    const config = parseAiProviderConfig({
      AI_PROVIDER: 'volcengine',
      LAS_API_KEY: 'las',
      ARK_API_KEY: 'ark',
    });

    expect(config).toMatchObject({
      kind: 'volcengine',
      lasResource: 'bigasr',
      lasPollIntervalMs: 2000,
      lasTimeoutMs: 1_800_000,
    });
    expect(() =>
      parseAiProviderConfig({
        AI_PROVIDER: 'volcengine',
        LAS_API_KEY: 'las',
        ARK_API_KEY: 'ark',
        LAS_ASR_POLL_INTERVAL_MS: '99',
      }),
    ).toThrow('AI Provider configuration error: LAS_ASR_POLL_INTERVAL_MS is invalid');
  });

  it('为 Ark deadline 使用受限配置和安全默认值', () => {
    const environment = {
      AI_PROVIDER: 'volcengine',
      LAS_API_KEY: 'las',
      ARK_API_KEY: 'ark',
    };

    expect(parseAiProviderConfig(environment)).toMatchObject({ arkTimeoutMs: 120_000 });
    expect(() => parseAiProviderConfig({ ...environment, ARK_TIMEOUT_MS: '999' })).toThrow(
      'AI Provider configuration error: ARK_TIMEOUT_MS is invalid',
    );
    expect(() => parseAiProviderConfig({ ...environment, ARK_TIMEOUT_MS: '600001' })).toThrow(
      'AI Provider configuration error: ARK_TIMEOUT_MS is invalid',
    );
  });

  it('拒绝带凭证的端点 URL，避免配置把认证信息带入日志边界', () => {
    expect(() =>
      parseAiProviderConfig({
        AI_PROVIDER: 'volcengine',
        LAS_API_KEY: 'las',
        ARK_API_KEY: 'ark',
        LAS_ASR_SUBMIT_URL: 'https://secret@operator.example.test/submit',
      }),
    ).toThrow('AI Provider configuration error: LAS_ASR_SUBMIT_URL is invalid');
  });
});
