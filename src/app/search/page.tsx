import type { Metadata } from "next";
import { Suspense } from "react";

import { SearchExperience } from "@/features/search/SearchExperience";

export const metadata: Metadata = { title: "搜索" };

export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchExperience />
    </Suspense>
  );
}
