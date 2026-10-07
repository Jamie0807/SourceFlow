export interface HttpResponse {
  readonly status: number;
  json(): Promise<unknown>;
}

export interface HttpClient {
  postJson(
    url: string,
    options: Readonly<{
      headers: Readonly<Record<string, string>>;
      body: unknown;
      signal?: AbortSignal;
    }>,
  ): Promise<HttpResponse>;
}

export type Sleep = (milliseconds: number, signal?: AbortSignal) => Promise<void>;

export const fetchHttpClient: HttpClient = {
  async postJson(url, options) {
    const response = await fetch(url, {
      method: 'POST',
      headers: options.headers,
      body: JSON.stringify(options.body),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    return {
      status: response.status,
      json: () => response.json(),
    };
  },
};

export const sleep: Sleep = (milliseconds, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      return;
    }

    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
