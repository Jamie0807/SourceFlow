export type AiProviderConfig =
  | Readonly<{ kind: 'mock' }>
  | Readonly<{
      kind: 'volcengine';
      lasApiKey: string;
      arkApiKey: string;
      lasSubmitUrl: string;
      lasPollUrl: string;
      lasResource: 'seedasr' | 'bigasr';
      lasPollIntervalMs: number;
      lasTimeoutMs: number;
      arkBaseUrl: string;
      arkModel: string;
      arkTimeoutMs: number;
    }>;

const defaults = {
  lasSubmitUrl: 'https://operator.las.cn-beijing.volces.com/api/v1/submit',
  lasPollUrl: 'https://operator.las.cn-beijing.volces.com/api/v1/poll',
  lasResource: 'bigasr' as const,
  lasPollIntervalMs: 2_000,
  lasTimeoutMs: 1_800_000,
  arkBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  arkModel: 'doubao-seed-1-6-250615',
  arkTimeoutMs: 120_000,
};

type Environment = Readonly<Record<string, string | undefined>>;

const configError = (name: string): never => {
  throw new Error(`AI Provider configuration error: ${name}`);
};

const required = (environment: Environment, name: 'LAS_API_KEY' | 'ARK_API_KEY'): string => {
  const value = environment[name];
  return value && value.trim() ? value : configError(`${name} is required`);
};

const httpsUrl = (value: string, name: string): string => {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.username.length === 0 && url.password.length === 0) {
      return value;
    }
  } catch {
    // Produce the stable configuration error below.
  }
  return configError(`${name} is invalid`);
};

const boundedInteger = (
  value: string | undefined,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : configError(`${name} is invalid`);
};

export function parseAiProviderConfig(environment: Environment): AiProviderConfig {
  if (environment.AI_PROVIDER === undefined || environment.AI_PROVIDER === 'mock')
    return { kind: 'mock' };
  if (environment.AI_PROVIDER !== 'volcengine') configError('AI_PROVIDER is invalid');

  const resource = environment.LAS_ASR_RESOURCE ?? defaults.lasResource;
  const lasResource =
    resource === 'seedasr' || resource === 'bigasr'
      ? resource
      : configError('LAS_ASR_RESOURCE is invalid');

  return {
    kind: 'volcengine',
    lasApiKey: required(environment, 'LAS_API_KEY'),
    arkApiKey: required(environment, 'ARK_API_KEY'),
    lasSubmitUrl: httpsUrl(
      environment.LAS_ASR_SUBMIT_URL ?? defaults.lasSubmitUrl,
      'LAS_ASR_SUBMIT_URL',
    ),
    lasPollUrl: httpsUrl(environment.LAS_ASR_POLL_URL ?? defaults.lasPollUrl, 'LAS_ASR_POLL_URL'),
    lasResource,
    lasPollIntervalMs: boundedInteger(
      environment.LAS_ASR_POLL_INTERVAL_MS,
      'LAS_ASR_POLL_INTERVAL_MS',
      defaults.lasPollIntervalMs,
      100,
      60_000,
    ),
    lasTimeoutMs: boundedInteger(
      environment.LAS_ASR_TIMEOUT_MS,
      'LAS_ASR_TIMEOUT_MS',
      defaults.lasTimeoutMs,
      60_000,
      3_600_000,
    ),
    arkBaseUrl: httpsUrl(environment.ARK_BASE_URL ?? defaults.arkBaseUrl, 'ARK_BASE_URL'),
    arkModel: environment.ARK_MODEL?.trim() || defaults.arkModel,
    arkTimeoutMs: boundedInteger(
      environment.ARK_TIMEOUT_MS,
      'ARK_TIMEOUT_MS',
      defaults.arkTimeoutMs,
      1_000,
      600_000,
    ),
  };
}
