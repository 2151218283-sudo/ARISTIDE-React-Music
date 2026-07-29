// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("component test harness", () => {
  it("renders semantic content in JSDOM", () => {
    render(<button type="button">Open local test state</button>);

    expect(
      screen.getByRole("button", { name: "Open local test state" }),
    ).toBeVisible();
  });
});
