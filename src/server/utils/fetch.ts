import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppError } from './errors';

type FetchPolicyOptions = {
  timeoutMs?: number;
  contextLabel: string;
  errorStatusCode?: number;
  redirect?: RequestRedirect;
};

type BufferReadOptions = {
  maxBytes: number;
  contextLabel: string;
  errorStatusCode?: number;
};

type DownloadOptions = FetchPolicyOptions & {
  maxBytes: number;
};

const DEFAULT_TIMEOUT_MS = 30_000;

export async function fetchWithPolicy(
  url: string | URL,
  init: RequestInit,
  options: FetchPolicyOptions,
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const signal = init.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal,
      redirect: options.redirect ?? 'error',
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AppError(
        'REMOTE_TIMEOUT',
        `${options.contextLabel} timed out`,
        options.errorStatusCode ?? 504,
      );
    }
    throw new AppError(
      'REMOTE_REQUEST_FAILED',
      `${options.contextLabel} could not be reached`,
      options.errorStatusCode ?? 400,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJsonWithLimit<T>(
  url: string | URL,
  options: FetchPolicyOptions & {
    maxBytes?: number;
    headers?: HeadersInit;
  },
): Promise<T> {
  const response = await fetchWithPolicy(url, {
    headers: options.headers,
  }, options);

  if (!response.ok) {
    throw new AppError(
      'REMOTE_HTTP_ERROR',
      `${options.contextLabel} responded with HTTP ${response.status}`,
      options.errorStatusCode ?? 400,
    );
  }

  const buffer = await readResponseBuffer(response, {
    maxBytes: options.maxBytes ?? 2 * 1024 * 1024,
    contextLabel: options.contextLabel,
    errorStatusCode: options.errorStatusCode,
  });

  try {
    return JSON.parse(buffer.toString('utf8')) as T;
  } catch {
    throw new AppError(
      'REMOTE_INVALID_JSON',
      `${options.contextLabel} did not return valid JSON`,
      options.errorStatusCode ?? 400,
    );
  }
}

export async function downloadToFileWithLimit(
  url: string | URL,
  destinationPath: string,
  options: DownloadOptions,
): Promise<void> {
  const response = await fetchWithPolicy(url, {}, options);
  if (!response.ok || !response.body) {
    throw new AppError(
      'REMOTE_DOWNLOAD_FAILED',
      `${options.contextLabel} responded with HTTP ${response.status}`,
      options.errorStatusCode ?? 400,
    );
  }

  assertContentLengthWithinLimit(response, options.maxBytes, options.contextLabel, options.errorStatusCode);

  let totalBytes = 0;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      totalBytes += chunk.length;
      if (totalBytes > options.maxBytes) {
        callback(new AppError(
          'REMOTE_RESPONSE_TOO_LARGE',
          `${options.contextLabel} exceeded the allowed size limit`,
          options.errorStatusCode ?? 413,
        ));
        return;
      }
      callback(null, chunk);
    },
  });

  await pipeline(
    Readable.fromWeb(response.body as never),
    counter,
    createWriteStream(destinationPath),
  );
}

async function readResponseBuffer(response: Response, options: BufferReadOptions): Promise<Buffer> {
  assertContentLengthWithinLimit(response, options.maxBytes, options.contextLabel, options.errorStatusCode);

  if (!response.body) {
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    totalBytes += value.byteLength;
    if (totalBytes > options.maxBytes) {
      await reader.cancel().catch(() => {});
      throw new AppError(
        'REMOTE_RESPONSE_TOO_LARGE',
        `${options.contextLabel} exceeded the allowed size limit`,
        options.errorStatusCode ?? 413,
      );
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks);
}

function assertContentLengthWithinLimit(
  response: Response,
  maxBytes: number,
  contextLabel: string,
  errorStatusCode = 413,
): void {
  const contentLengthHeader = response.headers.get('content-length');
  if (!contentLengthHeader) return;

  const contentLength = Number.parseInt(contentLengthHeader, 10);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new AppError(
      'REMOTE_RESPONSE_TOO_LARGE',
      `${contextLabel} exceeded the allowed size limit`,
      errorStatusCode,
    );
  }
}
