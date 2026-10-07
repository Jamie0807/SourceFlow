import type { AiProvider } from '@sourceflow/domain';

import { ArkTextClient, type ArkTextClientRuntime } from './ark-text.client.js';
import { type HttpClient, type Sleep } from './http-client.js';
import { MockAiProvider } from './mock.provider.js';
import type { AiProviderConfig } from './provider-config.js';
import { VolcengineAsrClient } from './volcengine-asr.client.js';
import { VolcengineProvider } from './volcengine.provider.js';

export type AiProviderFactoryDependencies = Readonly<{
  http?: HttpClient;
  sleep?: Sleep;
  now?: () => number;
  arkRuntime?: ArkTextClientRuntime;
}>;

export function createAiProvider(
  config: AiProviderConfig,
  dependencies: AiProviderFactoryDependencies = {},
): AiProvider {
  if (config.kind === 'mock') return new MockAiProvider();

  return new VolcengineProvider(
    new VolcengineAsrClient(config, dependencies.http, dependencies.sleep, dependencies.now),
    new ArkTextClient(config, dependencies.http, dependencies.arkRuntime),
  );
}
