import type {
  AiProvider,
  TextAnalysisInput,
  TextAnalysisResult,
  TranscriptionInput,
  TranscriptionResult,
} from '@sourceflow/domain';

type AsrClient = Pick<AiProvider, 'transcribe'>;
type TextClient = Pick<AiProvider, 'analyze'>;

export class VolcengineProvider implements AiProvider {
  constructor(
    private readonly asr: AsrClient,
    private readonly ark: TextClient,
  ) {}

  transcribe(input: TranscriptionInput, signal?: AbortSignal): Promise<TranscriptionResult> {
    return this.asr.transcribe(input, signal);
  }

  analyze(input: TextAnalysisInput, signal?: AbortSignal): Promise<TextAnalysisResult> {
    return this.ark.analyze(input, signal);
  }
}
