// cspell:ignore Volcengine volcengine LAS Ark
import { AiProviderError, isHttpsMediaUrl, type AiMediaFormat } from '@sourceflow/domain';

import { createAiProvider } from '../src/providers/create-ai-provider.js';
import { parseAiProviderConfig } from '../src/providers/provider-config.js';
import { isPublicHttpsMediaUrl } from '../src/providers/smoke-media-url.js';

const requiredMediaUrl = async (environment: NodeJS.ProcessEnv): Promise<string> => {
  const mediaUrl = environment.VOLCENGINE_SMOKE_MEDIA_URL?.trim();
  if (mediaUrl === undefined || mediaUrl.length === 0) {
    throw new Error('Volcengine smoke configuration error: VOLCENGINE_SMOKE_MEDIA_URL is required');
  }
  if (!isHttpsMediaUrl(mediaUrl) || !(await isPublicHttpsMediaUrl(mediaUrl))) {
    throw new Error(
      'Volcengine smoke configuration error: VOLCENGINE_SMOKE_MEDIA_URL must be public HTTPS',
    );
  }
  return mediaUrl;
};

const mediaFormat = (environment: NodeJS.ProcessEnv): AiMediaFormat => {
  const value = environment.VOLCENGINE_SMOKE_MEDIA_FORMAT ?? 'mp4';
  if (value === 'mp3' || value === 'wav' || value === 'ogg' || value === 'mp4') return value;
  throw new Error('Volcengine smoke configuration error: VOLCENGINE_SMOKE_MEDIA_FORMAT is invalid');
};

const failureKind = (error: unknown): string =>
  error instanceof AiProviderError ? error.kind : 'unknown';

async function main(environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (environment.RUN_VOLCENGINE_SMOKE !== 'true') {
    throw new Error('Volcengine smoke is disabled; set RUN_VOLCENGINE_SMOKE=true');
  }

  const config = parseAiProviderConfig(environment);
  if (config.kind !== 'volcengine') {
    throw new Error('Volcengine smoke configuration error: AI_PROVIDER must be volcengine');
  }

  const provider = createAiProvider(config);
  const transcription = await provider.transcribe({
    mediaUrl: await requiredMediaUrl(environment),
    mediaFormat: mediaFormat(environment),
  });
  const analysis = await provider.analyze({
    transcript: transcription.transcript.slice(0, 2_000),
  });

  console.info(
    JSON.stringify({
      transcription: {
        provider: transcription.provider,
        model: transcription.model,
        requestIdPresent: transcription.requestId !== undefined,
        transcriptLength: transcription.transcript.length,
        utteranceCount: transcription.utterances.length,
      },
      analysis: {
        provider: analysis.provider,
        model: analysis.model,
        requestIdPresent: analysis.requestId !== undefined,
        chapterCount: analysis.chapters.length,
        keyPointCount: analysis.keyPoints.length,
        quoteCount: analysis.quotes.length,
        candidateClipCount: analysis.candidateClips.length,
        riskFlagCount: analysis.riskFlags.length,
      },
    }),
  );
}

void main().catch((error: unknown) => {
  console.error(JSON.stringify({ kind: failureKind(error) }));
  process.exitCode = 1;
});
