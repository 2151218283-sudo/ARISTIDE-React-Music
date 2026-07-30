import { describe, expect, it } from "vitest";

import {
  parseNeteaseTransportProxyUrl,
} from "../../src/lib/music/netease/config.server";

describe("Netease local transport proxy", () => {
  it("accepts an explicit loopback HTTP proxy", () => {
    expect(parseNeteaseTransportProxyUrl("http://127.0.0.1:7897"))
      .toBe("http://127.0.0.1:7897/");
    expect(parseNeteaseTransportProxyUrl("http://[::1]:7897"))
      .toBe("http://[::1]:7897/");
  });

  it("keeps direct transport when the value is absent", () => {
    expect(parseNeteaseTransportProxyUrl(undefined)).toBeUndefined();
    expect(parseNeteaseTransportProxyUrl("   ")).toBeUndefined();
  });

  it.each([
    "https://127.0.0.1:7897",
    "http://localhost:7897",
    "http://192.168.1.10:7897",
    "http://127.0.0.1",
    "http://user:password@127.0.0.1:7897",
    "http://127.0.0.1:7897/proxy",
    "http://127.0.0.1:7897?mode=global",
  ])("rejects unsafe transport proxy %s", (value) => {
    expect(() => parseNeteaseTransportProxyUrl(value)).toThrow(
      "NETEASE_UPSTREAM_PROXY",
    );
  });
});
