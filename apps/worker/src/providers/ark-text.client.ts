// cspell:ignore Volcengine volcengine Ark ark json_object
import {
  AiProviderError,
  createTextAnalysisInput,
  createTextAnalysisResult,
  type TextAnalysisInput,
  type TextAnalysisResult,
} from '@sourceflow/domain';

import { fetchHttpClient, type HttpClient } from './http-client.js';

type UnknownRecord = Record<string, unknown>;

export type ArkTextClientConfig = Readonly<{
  arkApiKey: string;
  arkBaseUrl: string;
  arkModel: string;
  arkTimeoutMs: number;
}>;

export type ArkTextClientRuntime = Readonly<{
  createDeadlineSignal: (timeoutMs: number) => AbortSignal;
}>;

const analysisKeys = ['candidateClips', 'chapters', 'keyPoints', 'quotes', 'riskFlags'] as const;
const chapterKeys = ['summary', 'title'] as const;
const candidateClipKeys = ['endMs', 'reason', 'startMs'] as const;

const isRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isAbortError = (error: unknown): boolean => isRecord(error) && error.name === 'AbortError';

const remoteFailure = (): AiProviderError => new AiProviderError('remote_failure', true);

const defaultRuntime: ArkTextClientRuntime = {
  createDeadlineSignal: (timeoutMs) => AbortSignal.timeout(timeoutMs),
};

export class ArkTextClient {
  constructor(
    private readonly config: ArkTextClientConfig,
    private readonly http: HttpClient = fetchHttpClient,
    private readonly runtime: ArkTextClientRuntime = defaultRuntime,
  ) {}

  async analyze(input: TextAnalysisInput, signal?: AbortSignal): Promise<TextAnalysisResult> {
    this.throwIfAborted(signal);
    try {
      createTextAnalysisInput(input);
    } catch {
      throw new AiProviderError('invalid_input', false);
    }

    const deadline = this.runtime.createDeadlineSignal(this.config.arkTimeoutMs);
    const requestSignal = signal === undefined ? deadline : AbortSignal.any([signal, deadline]);
    try {
      this.throwIfTimedOut(deadline);
      const response = await this.http.postJson(this.endpoint(), {
        headers: {
          Authorization: `Bearer ${this.config.arkApiKey}`,
          'Content-Type': 'application/json',
        },
        body: {
          model: this.config.arkModel,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                'Return exactly one JSON object with chapters, keyPoints, quotes, candidateClips, and riskFlags.',
            },
            { role: 'user', content: input.transcript },
          ],
        },
        signal: requestSignal,
      });
      this.throwIfAborted(signal);
      this.throwIfTimedOut(deadline);
      const status = response.status;
      const body = await response.json();
      this.throwIfAborted(signal);
      this.throwIfTimedOut(deadline);

      if (status >= 200 && status < 300) return this.toResult(body);
      if (status === 401 || status === 403) throw new AiProviderError('authentication', false);
      if (status === 408 || status === 504) throw new AiProviderError('timeout', true);
      if (status === 429) throw new AiProviderError('rate_limited', true);
      if (status >= 400 && status < 500) throw new AiProviderError('invalid_input', false);
      throw remoteFailure();
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      if (signal?.aborted) throw new AiProviderError('cancelled', false);
      if (deadline.aborted) throw new AiProviderError('timeout', true);
      if (isAbortError(error)) throw new AiProviderError('cancelled', false);
      throw remoteFailure();
    }
  }

  private endpoint(): string {
    const url = new URL(this.config.arkBaseUrl);
    if (url.protocol !== 'https:' || url.username.length > 0 || url.password.length > 0) {
      throw new TypeError('unsafe Ark endpoint');
    }
    url.search = '';
    url.hash = '';
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/chat/completions`;
    return url.toString();
  }

  private toResult(value: unknown): TextAnalysisResult {
    try {
      if (!isRecord(value) || !Array.isArray(value.choices) || value.choices.length !== 1) {
        throw new TypeError('invalid Ark response');
      }
      const choice = value.choices[0];
      if (
        !isRecord(choice) ||
        !isRecord(choice.message) ||
        !nonEmptyString(choice.message.content)
      ) {
        throw new TypeError('invalid Ark message');
      }

      const analysis = JSON.parse(choice.message.content) as unknown;
      if (
        !isRecord(analysis) ||
        !this.hasExactAnalysisKeys(analysis) ||
        !this.hasExactObjectKeys(analysis.chapters, chapterKeys) ||
        !this.hasExactObjectKeys(analysis.candidateClips, candidateClipKeys)
      ) {
        throw new TypeError('invalid Ark JSON schema');
      }

      const requestId = value.id;
      if (requestId !== undefined && !nonEmptyString(requestId)) {
        throw new TypeError('invalid Ark request id');
      }
      return createTextAnalysisResult({
        provider: 'volcengine',
        model: this.config.arkModel,
        chapters: analysis.chapters,
        keyPoints: analysis.keyPoints,
        quotes: analysis.quotes,
        candidateClips: analysis.candidateClips,
        riskFlags: analysis.riskFlags,
        ...(requestId === undefined ? {} : { requestId }),
      });
    } catch {
      throw remoteFailure();
    }
  }

  private hasExactAnalysisKeys(value: UnknownRecord): boolean {
    return this.hasExactKeys(value, analysisKeys);
  }

  private hasExactObjectKeys(value: unknown, expectedKeys: readonly string[]): boolean {
    return (
      Array.isArray(value) &&
      value.every((item) => isRecord(item) && this.hasExactKeys(item, expectedKeys))
    );
  }

  private hasExactKeys(value: UnknownRecord, expectedKeys: readonly string[]): boolean {
    const keys = Object.keys(value).sort();
    return (
      keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index])
    );
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new AiProviderError('cancelled', false);
  }

  private throwIfTimedOut(deadline: AbortSignal): void {
    if (deadline.aborted) throw new AiProviderError('timeout', true);
  }
}
