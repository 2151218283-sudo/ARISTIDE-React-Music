import response from "../fixtures/contract/smoke-response.json";
import { describe, expect, it } from "vitest";

describe("contract test harness", () => {
  it("reads a sanitized deterministic fixture", () => {
    expect(response).toEqual({
      status: 200,
      data: {
        id: "demo-track-001",
        name: "Synthetic Test Track",
        playable: false,
      },
    });
  });
});
