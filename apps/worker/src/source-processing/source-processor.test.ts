import { describe, expect, it } from 'vitest';

import type { TaskFailure } from '@sourceflow/domain';

import { mapProcessorError } from './source-processor.js';

describe('mapProcessorError', () => {
  it('maps arbitrary JavaScript values without throwing', () => {
    const sentinel = 'r5-sensitive-sentinel';
    const throwingProxy = new Proxy(
      {},
      {
        get: () => {
          throw new Error(sentinel);
        },
      },
    );
    const revocable = Proxy.revocable({}, {});
    revocable.revoke();
    const values: unknown[] = [
      undefined,
      null,
      false,
      42,
      42n,
      'failure',
      Symbol('failure'),
      () => undefined,
      throwingProxy,
      revocable.proxy,
    ];

    for (const value of values) {
      expect(() => mapProcessorError(value)).not.toThrow();
      expect(mapProcessorError(value)).toEqual({
        code: 'PROCESSOR_UNKNOWN_FAILURE',
        message: '处理失败',
        retryable: true,
      });
    }
  });

  it('returns a new plain TaskFailure snapshot for a valid failure', () => {
    const failure: TaskFailure = {
      code: 'PROCESSOR_INVALID_INPUT',
      message: 'invalid input',
      retryable: false,
    };

    const mapped = mapProcessorError(failure);

    expect(mapped).toEqual(failure);
    expect(mapped).not.toBe(failure);
    expect(Object.getPrototypeOf(mapped)).toBe(Object.prototype);
  });
});
