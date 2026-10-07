import { describe, expect, it } from 'vitest';

import {
  AiProviderError,
  createTextAnalysisInput,
  createTextAnalysisResult,
  createTranscriptionInput,
  createTranscriptionResult,
  isHttpsMediaUrl,
} from './ai-provider.js';

describe('AI Provider contract', () => {
  it('只接受无凭证且可包含签名查询参数的 HTTPS 媒体 URL', () => {
    expect(isHttpsMediaUrl('https://cdn.example.test/a.mp4?signature=secret')).toBe(true);
    expect(isHttpsMediaUrl('http://cdn.example.test/a.mp4')).toBe(false);
    expect(isHttpsMediaUrl('https://key@example.test/a.mp4')).toBe(false);
  });

  it('公开错误文案不包含上游原因', () => {
    const error = new AiProviderError('authentication', false, 'secret upstream response');

    expect(error.message).toBe('AI Provider authentication failed');
    expect(error.message).not.toContain('secret');
    expect(error).toMatchObject({ kind: 'authentication', retryable: false });
    expect(Object.hasOwn(error, 'cause')).toBe(false);
    expect(JSON.stringify(error)).not.toContain('secret');
  });

  it('只接受批准的媒体格式和安全 URL，并冻结转写输入', () => {
    const input = createTranscriptionInput({
      mediaUrl: 'https://cdn.example.test/a.mp4?signature=secret',
      mediaFormat: 'mp4',
    });

    expect(Object.isFrozen(input)).toBe(true);
    expect(() =>
      createTranscriptionInput({
        mediaUrl: 'https://cdn.example.test/a.mp4',
        mediaFormat: 'm4a' as never,
      }),
    ).toThrow(/mediaFormat/);
    expect(() =>
      createTranscriptionInput({ mediaUrl: 'http://cdn.example.test/a.mp4', mediaFormat: 'mp4' }),
    ).toThrow(/mediaUrl/);
  });

  it('要求非空文本分析输入', () => {
    expect(Object.isFrozen(createTextAnalysisInput({ transcript: '你好' }))).toBe(true);
    expect(() => createTextAnalysisInput({ transcript: ' ' })).toThrow(/transcript/);
  });

  it('验证并深冻结结构化转写结果', () => {
    const result = createTranscriptionResult({
      provider: 'volcengine',
      model: 'bigasr',
      transcript: '你好，世界',
      utterances: [{ text: '你好', startMs: 0, endMs: 800, speaker: 'spk-1' }],
      requestId: 'request-1',
    });

    expect(result).toEqual({
      provider: 'volcengine',
      model: 'bigasr',
      transcript: '你好，世界',
      utterances: [{ text: '你好', startMs: 0, endMs: 800, speaker: 'spk-1' }],
      requestId: 'request-1',
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.utterances)).toBe(true);
    expect(Object.isFrozen(result.utterances[0])).toBe(true);
  });

  it('拒绝不合法的转写结果边界', () => {
    const validResult = {
      provider: 'mock',
      model: 'mock-v1',
      transcript: '你好，世界',
      utterances: [{ text: '你好', startMs: 0, endMs: 800 }],
    };

    expect(() => createTranscriptionResult({ ...validResult, transcript: ' ' })).toThrow(
      /transcript/,
    );
    expect(() =>
      createTranscriptionResult({
        ...validResult,
        utterances: [{ text: '你好', startMs: -1, endMs: 800 }],
      }),
    ).toThrow(/utterances/);
    expect(() =>
      createTranscriptionResult({
        ...validResult,
        utterances: [
          { text: 'a', startMs: 0, endMs: 800 },
          { text: 'b', startMs: 700, endMs: 900 },
        ],
      }),
    ).toThrow(/utterances/);
    expect(() => createTranscriptionResult({ ...validResult, provider: 'other' })).toThrow(
      /provider/,
    );
  });

  it('验证并深冻结结构化文本分析结果', () => {
    const result = createTextAnalysisResult({
      provider: 'mock',
      model: 'mock-v1',
      chapters: [{ title: '开场', summary: '介绍主题' }],
      keyPoints: ['要点'],
      quotes: ['金句'],
      candidateClips: [{ startMs: 0, endMs: 800, reason: '信息完整' }],
      riskFlags: [],
    });

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.chapters)).toBe(true);
    expect(Object.isFrozen(result.chapters[0])).toBe(true);
    expect(Object.isFrozen(result.candidateClips[0])).toBe(true);
  });

  it('拒绝非 JSON-safe 的文本分析结果', () => {
    const validResult = {
      provider: 'mock',
      model: 'mock-v1',
      chapters: [],
      keyPoints: [],
      quotes: [],
      candidateClips: [],
      riskFlags: [],
    };

    expect(() => createTextAnalysisResult({ ...validResult, keyPoints: [undefined] })).toThrow(
      /keyPoints/,
    );
    expect(() =>
      createTextAnalysisResult({
        ...validResult,
        candidateClips: [{ startMs: 0, endMs: 1, reason: '' }],
      }),
    ).toThrow(/candidateClips/);
  });

  it('拒绝跨边界的非对象、非字符串和无效可选字段', () => {
    const transcription = {
      provider: 'mock',
      model: 'mock-v1',
      transcript: '你好',
      utterances: [],
    };
    const analysis = {
      provider: 'mock',
      model: 'mock-v1',
      chapters: [],
      keyPoints: [],
      quotes: [],
      candidateClips: [],
      riskFlags: [],
    };

    expect(() => createTranscriptionResult(null)).toThrow(/object/);
    expect(() => createTranscriptionResult({ ...transcription, utterances: null })).toThrow(
      /utterances/,
    );
    expect(() =>
      createTranscriptionResult({
        ...transcription,
        utterances: [{ text: 3, startMs: 0, endMs: 1 }],
      }),
    ).toThrow(/utterances text/);
    expect(() =>
      createTranscriptionResult({
        ...transcription,
        utterances: [{ text: '你好', startMs: 0, endMs: 1, speaker: 3 }],
      }),
    ).toThrow(/speaker/);
    expect(() => createTranscriptionResult({ ...transcription, requestId: '' })).toThrow(
      /requestId/,
    );
    expect(() => createTextAnalysisResult(null)).toThrow(/object/);
    expect(() => createTextAnalysisResult({ ...analysis, chapters: null })).toThrow(/chapters/);
    expect(() =>
      createTextAnalysisResult({ ...analysis, chapters: [{ title: 'a', summary: 3 }] }),
    ).toThrow(/chapters summary/);
    expect(() => createTextAnalysisResult({ ...analysis, candidateClips: null })).toThrow(
      /candidateClips/,
    );
    expect(() => createTextAnalysisResult({ ...analysis, riskFlags: [''] })).toThrow(/riskFlags/);
  });

  it('保留可选 requestId 并拒绝无效的分析片段范围', () => {
    const analysis = createTextAnalysisResult({
      provider: 'volcengine',
      model: 'ark-model',
      chapters: [],
      keyPoints: [],
      quotes: [],
      candidateClips: [],
      riskFlags: [],
      requestId: 'request-2',
    });

    expect(analysis.requestId).toBe('request-2');
    expect(() =>
      createTextAnalysisResult({
        ...analysis,
        candidateClips: [
          { startMs: 0, endMs: 10, reason: 'a' },
          { startMs: 9, endMs: 11, reason: 'b' },
        ],
      }),
    ).toThrow(/candidateClips/);
  });
});
