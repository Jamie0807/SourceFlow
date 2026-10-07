import { describe, expect, it, vi } from 'vitest';

import type { AiProvider, TextAnalysisInput, TranscriptionInput } from '@sourceflow/domain';

import { VolcengineProvider } from './volcengine.provider.js';

describe('VolcengineProvider', () => {
  it('只将 transcribe 委派给 ASR 客户端并保留 signal', async () => {
    const transcribe = vi.fn<AiProvider['transcribe']>().mockResolvedValue({
      provider: 'volcengine',
      model: 'las_asr_pro',
      transcript: '转写内容',
      utterances: [],
    });
    const analyze = vi.fn<AiProvider['analyze']>();
    const provider = new VolcengineProvider({ transcribe }, { analyze });
    const controller = new AbortController();
    const input: TranscriptionInput = {
      mediaUrl: 'https://media.example.test/episode.mp4',
      mediaFormat: 'mp4',
    };

    await expect(provider.transcribe(input, controller.signal)).resolves.toMatchObject({
      transcript: '转写内容',
    });
    expect(transcribe).toHaveBeenCalledWith(input, controller.signal);
    expect(analyze).not.toHaveBeenCalled();
  });

  it('只将 analyze 委派给 Ark 客户端并原样透传安全错误', async () => {
    const transcribe = vi.fn<AiProvider['transcribe']>();
    const failure = new Error('safe client failure');
    const analyze = vi.fn<AiProvider['analyze']>().mockRejectedValue(failure);
    const provider = new VolcengineProvider({ transcribe }, { analyze });
    const input: TextAnalysisInput = { transcript: '待分析文本' };

    await expect(provider.analyze(input)).rejects.toBe(failure);
    expect(analyze).toHaveBeenCalledWith(input, undefined);
    expect(transcribe).not.toHaveBeenCalled();
  });
});
