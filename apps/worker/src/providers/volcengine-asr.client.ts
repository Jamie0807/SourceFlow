// cspell:ignore Volcengine volcengine seedasr bigasr bigmodel
import {
  AiProviderError,
  createTranscriptionInput,
  createTranscriptionResult,
  type TranscriptionInput,
  type TranscriptionResult,
} from '@sourceflow/domain';

import { fetchHttpClient, sleep, type HttpClient, type Sleep } from './http-client.js';

type LasTaskStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'TIMEOUT';
type UnknownRecord = Record<string, unknown>;

export type VolcengineAsrClientConfig = Readonly<{
  lasApiKey: string;
  lasSubmitUrl: string;
  lasPollUrl: string;
  lasResource: 'seedasr' | 'bigasr';
  lasPollIntervalMs: number;
  lasTimeoutMs: number;
}>;

type LasTask = Readonly<{
  id: string;
  status: LasTaskStatus;
  requestId?: string;
  body: UnknownRecord;
}>;

const isRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isAbortError = (error: unknown): boolean => isRecord(error) && error.name === 'AbortError';

const remoteFailure = (): AiProviderError => new AiProviderError('remote_failure', true);

export class VolcengineAsrClient {
  constructor(
    private readonly config: VolcengineAsrClientConfig,
    private readonly http: HttpClient = fetchHttpClient,
    private readonly wait: Sleep = sleep,
    private readonly now: () => number = () => performance.now(),
  ) {}

  async transcribe(input: TranscriptionInput, signal?: AbortSignal): Promise<TranscriptionResult> {
    this.throwIfAborted(signal);
    try {
      createTranscriptionInput(input);
    } catch {
      throw new AiProviderError('invalid_input', false);
    }

    const startedAt = this.now();
    let task = this.parseTask(
      await this.post(this.config.lasSubmitUrl, this.submitBody(input), signal),
    );

    while (task.status === 'PENDING' || task.status === 'RUNNING') {
      this.throwIfTimedOut(startedAt);
      await this.waitForPoll(signal);
      this.throwIfTimedOut(startedAt);
      task = this.parseTask(await this.post(this.config.lasPollUrl, { task_id: task.id }, signal));
    }

    if (task.status === 'COMPLETED') return this.toResult(task);
    if (task.status === 'TIMEOUT') throw new AiProviderError('timeout', true);
    throw remoteFailure();
  }

  private submitBody(input: TranscriptionInput): unknown {
    return {
      operator_id: 'las_asr_pro',
      operator_version: 'v2',
      data: {
        resource: this.config.lasResource,
        audio: { url: input.mediaUrl, format: input.mediaFormat },
        request: { model_name: 'bigmodel', show_utterances: true },
      },
    };
  }

  private async post(url: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    this.throwIfAborted(signal);

    try {
      const response = await this.http.postJson(url, {
        headers: {
          Authorization: `Bearer ${this.config.lasApiKey}`,
          'Content-Type': 'application/json',
        },
        body,
        ...(signal === undefined ? {} : { signal }),
      });
      this.throwIfAborted(signal);
      const status = response.status;
      const responseBody = await response.json();
      this.throwIfAborted(signal);

      if (status >= 200 && status < 300) return responseBody;
      if (status === 401 || status === 403) throw new AiProviderError('authentication', false);
      if (status === 429) throw new AiProviderError('rate_limited', true);
      throw remoteFailure();
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      if (signal?.aborted || isAbortError(error)) throw new AiProviderError('cancelled', false);
      throw remoteFailure();
    }
  }

  private parseTask(value: unknown): LasTask {
    try {
      if (!isRecord(value) || !isRecord(value.metadata)) throw new TypeError('invalid metadata');
      const metadata = value.metadata;
      const taskId = metadata.task_id;
      const taskStatus = metadata.task_status;
      const businessCode = metadata.business_code;
      if (!nonEmptyString(taskId) || businessCode !== '0') throw new TypeError('invalid task');
      if (
        taskStatus !== 'PENDING' &&
        taskStatus !== 'RUNNING' &&
        taskStatus !== 'COMPLETED' &&
        taskStatus !== 'FAILED' &&
        taskStatus !== 'TIMEOUT'
      ) {
        throw new TypeError('unknown task status');
      }
      const requestId = metadata.request_id;
      if (requestId !== undefined && !nonEmptyString(requestId))
        throw new TypeError('invalid request id');
      return {
        id: taskId,
        status: taskStatus,
        body: value,
        ...(requestId === undefined ? {} : { requestId }),
      };
    } catch {
      throw remoteFailure();
    }
  }

  private toResult(task: LasTask): TranscriptionResult {
    try {
      const result = task.body.result;
      if (!isRecord(result) || !nonEmptyString(result.text))
        throw new TypeError('invalid transcription');
      const utterances = result.utterances;
      if (utterances !== undefined && !Array.isArray(utterances))
        throw new TypeError('invalid utterances');

      return createTranscriptionResult({
        provider: 'volcengine',
        model: 'las_asr_pro',
        transcript: result.text,
        utterances: (utterances ?? []).map((utterance) => this.toUtterance(utterance)),
        ...(task.requestId === undefined ? {} : { requestId: task.requestId }),
      });
    } catch {
      throw remoteFailure();
    }
  }

  private toUtterance(value: unknown): unknown {
    if (!isRecord(value) || !nonEmptyString(value.text)) throw new TypeError('invalid utterance');
    const { start_time: startMs, end_time: endMs, text, speaker } = value;
    if (speaker !== undefined && !nonEmptyString(speaker)) throw new TypeError('invalid speaker');
    return speaker === undefined ? { startMs, endMs, text } : { startMs, endMs, text, speaker };
  }

  private async waitForPoll(signal?: AbortSignal): Promise<void> {
    try {
      await this.wait(this.config.lasPollIntervalMs, signal);
      this.throwIfAborted(signal);
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw new AiProviderError('cancelled', false);
      throw remoteFailure();
    }
  }

  private throwIfTimedOut(startedAt: number): void {
    if (this.now() - startedAt >= this.config.lasTimeoutMs) {
      throw new AiProviderError('timeout', true);
    }
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new AiProviderError('cancelled', false);
  }
}
