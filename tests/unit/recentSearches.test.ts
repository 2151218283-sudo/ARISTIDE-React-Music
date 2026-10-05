import { describe, expect, it } from "vitest";

import {
  clearRecentSearches,
  getRecentSearches,
  recordRecentSearch,
  searchScope,
} from "../../src/features/search/recentSearches";

describe("current-tab recent searches", () => {
  it("deduplicates and isolates account and Demo scopes", () => {
    const first = searchScope("real", "9001");
    const second = searchScope("real", "9002");
    const demo = searchScope("demo", null);
    recordRecentSearch(first, "  jazz  ");
    recordRecentSearch(first, "rock");
    recordRecentSearch(first, "jazz");
    expect(getRecentSearches(first)).toEqual(["jazz", "rock"]);
    expect(getRecentSearches(second)).toEqual([]);
    expect(getRecentSearches(demo)).toEqual([]);
    clearRecentSearches(first);
    expect(getRecentSearches(first)).toEqual([]);
  });
});
