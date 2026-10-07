import {
  AiProviderError,
  createTextAnalysisInput,
  createTextAnalysisResult,
  createTranscriptionInput,
  createTranscriptionResult,
  type AiProvider,
  type TextAnalysisInput,
  type TextAnalysisResult,
  type TranscriptionInput,
  type TranscriptionResult,
} from '@sourceflow/domain';

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new AiProviderError('cancelled', false);
};

export class MockAiProvider implements AiProvider {
  async transcribe(input: TranscriptionInput, signal?: AbortSignal): Promise<TranscriptionResult> {
    throwIfAborted(signal);
    createTranscriptionInput(input);
    return createTranscriptionResult({
      provider: 'mock',
      model: 'mock-asr-v1',
      transcript: 'Mock transcript',
      utterances: [],
    });
  }

  async analyze(input: TextAnalysisInput, signal?: AbortSignal): Promise<TextAnalysisResult> {
    throwIfAborted(signal);
    createTextAnalysisInput(input);
    return createTextAnalysisResult({
      provider: 'mock',
      model: 'mock-text-v1',
      chapters: [],
      keyPoints: [],
      quotes: [],
      candidateClips: [],
      riskFlags: [],
    });
  }
}
