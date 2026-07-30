const allowedHosts = new Set(["127.0.0.1", "[::1]"]);

function invalidTransportProxy(): Error {
  return new Error(
    "NETEASE_UPSTREAM_PROXY 必须是无凭据的 loopback HTTP 地址，并包含端口。",
  );
}

export function parseNeteaseTransportProxyUrl(
  rawValue: string | undefined,
): string | undefined {
  const value = rawValue?.trim();
  if (!value) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidTransportProxy();
  }

  const port = Number(url.port);
  if (
    url.protocol !== "http:"
    || !allowedHosts.has(url.hostname)
    || !url.port
    || !Number.isInteger(port)
    || port < 1
    || port > 65_535
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) {
    throw invalidTransportProxy();
  }

  return url.toString();
}

export function readNeteaseTransportProxyUrl(): string | undefined {
  return parseNeteaseTransportProxyUrl(process.env.NETEASE_UPSTREAM_PROXY);
}
