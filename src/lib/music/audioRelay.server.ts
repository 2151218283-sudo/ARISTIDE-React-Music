import * as http from "node:http";
import * as https from "node:https";
import { Readable } from "node:stream";

import { AppError, isAppError } from "./errors";
import { readNeteaseTransportProxyUrl } from "./netease/config.server";

const allowedMediaHosts = [
  "music.126.net",
  "music.163.com",
] as const;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const maximumRedirects = 3;
const relayTimeoutMs = 15_000;
const forwardedHeaderNames = [
  "accept-ranges",
  "content-length",
  "content-range",
  "content-type",
  "etag",
  "last-modified",
] as const;

export interface AudioRelayUpstreamResponse {
  status: number;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
}

export type OpenAudioUpstream = (
  url: URL,
  range: string | null,
) => Promise<AudioRelayUpstreamResponse>;

function isAllowedMediaHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return allowedMediaHosts.some((host) => (
    normalized === host || normalized.endsWith(`.${host}`)
  ));
}

export function isAllowedAudioRelayUrl(url: URL): boolean {
  return (url.protocol === "http:" || url.protocol === "https:")
    && !url.username
    && !url.password
    && isAllowedMediaHost(url.hostname);
}

export function parseAudioRange(request: Request): string | null {
  const range = request.headers.get("range");
  if (range === null) {
    return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (match[1] === "" && match[2] === "")) {
    throw new AppError("VALIDATION_ERROR", "Invalid audio range.", {
      retryable: false,
    });
  }
  if (match[1] && match[2] && compareDecimalStrings(match[1], match[2]) > 0) {
    throw new AppError("VALIDATION_ERROR", "Invalid audio range.", {
      retryable: false,
    });
  }
  return range;
}

function compareDecimalStrings(left: string, right: string): number {
  const normalizedLeft = left.replace(/^0+(?=\d)/, "");
  const normalizedRight = right.replace(/^0+(?=\d)/, "");
  if (normalizedLeft.length !== normalizedRight.length) {
    return normalizedLeft.length - normalizedRight.length;
  }
  return normalizedLeft.localeCompare(normalizedRight);
}

function proxyEnvironment(): NodeJS.ProcessEnv | undefined {
  const proxy = readNeteaseTransportProxyUrl();
  if (!proxy) {
    return undefined;
  }
  return {
    NODE_ENV: process.env.NODE_ENV ?? "development",
    HTTP_PROXY: proxy,
    HTTPS_PROXY: proxy,
    NO_PROXY: "",
  };
}

function agentFor(protocol: "http:" | "https:"): http.Agent | https.Agent {
  const proxyEnv = proxyEnvironment();
  return protocol === "https:"
    ? new https.Agent({ proxyEnv })
    : new http.Agent({ proxyEnv });
}

function headersFromNodeResponse(headers: http.IncomingHttpHeaders): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => result.append(name, entry));
    } else {
      result.set(name, String(value));
    }
  }
  return result;
}

function relayNetworkError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }
  return new AppError("UPSTREAM_UNAVAILABLE", "Audio relay is unavailable.", {
    retryable: true,
  });
}

export const openAudioUpstream: OpenAudioUpstream = async (url, range) => {
  const client = url.protocol === "https:" ? https : http;
  const agent = agentFor(url.protocol as "http:" | "https:");
  return await new Promise<AudioRelayUpstreamResponse>((resolve, reject) => {
    const request = client.get(url, {
      agent,
      headers: range ? { Range: range } : undefined,
    }, (response) => {
      resolve({
        status: response.statusCode ?? 502,
        headers: headersFromNodeResponse(response.headers),
        body: Readable.toWeb(response) as ReadableStream<Uint8Array>,
      });
    });
    request.setTimeout(relayTimeoutMs, () => {
      request.destroy(new AppError("UPSTREAM_TIMEOUT", "Audio relay timed out.", {
        retryable: true,
      }));
    });
    request.once("error", (error) => reject(relayNetworkError(error)));
  });
};

async function discard(body: ReadableStream<Uint8Array> | null): Promise<void> {
  try {
    await body?.cancel();
  } catch {
    // The upstream stream is already closed or failed; no further action is needed.
  }
}

function unavailableMediaError(status: number): AppError {
  if (status === 401 || status === 403 || status === 404 || status === 410) {
    return new AppError("TRACK_UNAVAILABLE", "Audio source is unavailable.", {
      retryable: false,
    });
  }
  if (status === 408 || status === 504) {
    return new AppError("UPSTREAM_TIMEOUT", "Audio relay timed out.", {
      retryable: true,
    });
  }
  return new AppError("UPSTREAM_UNAVAILABLE", "Audio relay is unavailable.", {
    retryable: true,
  });
}

export async function openRelayedAudio(
  sourceUrl: string,
  range: string | null,
  open: OpenAudioUpstream = openAudioUpstream,
): Promise<AudioRelayUpstreamResponse> {
  let next: URL;
  try {
    next = new URL(sourceUrl);
  } catch {
    throw new AppError("UPSTREAM_UNAVAILABLE", "Audio source is invalid.", {
      retryable: true,
    });
  }

  for (let redirects = 0; redirects <= maximumRedirects; redirects += 1) {
    if (!isAllowedAudioRelayUrl(next)) {
      throw new AppError("UPSTREAM_UNAVAILABLE", "Audio source is unavailable.", {
        retryable: true,
      });
    }

    let response: AudioRelayUpstreamResponse;
    try {
      response = await open(next, range);
    } catch (error) {
      throw relayNetworkError(error);
    }

    if (!redirectStatuses.has(response.status)) {
      if ((response.status !== 200 && response.status !== 206) || !response.body) {
        await discard(response.body);
        throw unavailableMediaError(response.status);
      }
      return response;
    }

    const location = response.headers.get("location");
    await discard(response.body);
    if (!location || redirects === maximumRedirects) {
      throw new AppError("UPSTREAM_UNAVAILABLE", "Audio source is unavailable.", {
        retryable: true,
      });
    }
    try {
      next = new URL(location, next);
    } catch {
      throw new AppError("UPSTREAM_UNAVAILABLE", "Audio source is unavailable.", {
        retryable: true,
      });
    }
  }

  throw new AppError("UPSTREAM_UNAVAILABLE", "Audio source is unavailable.", {
    retryable: true,
  });
}

export function audioRelayHeaders(upstreamHeaders: Headers): Headers {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  forwardedHeaderNames.forEach((name) => {
    const value = upstreamHeaders.get(name);
    if (value) {
      headers.set(name, value);
    }
  });
  return headers;
}
