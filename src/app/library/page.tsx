import type { Metadata } from "next";

import { LibraryExperience } from "@/features/library/LibraryExperience";

export const metadata: Metadata = { title: "音乐库" };

export default function LibraryPage() {
  return <LibraryExperience />;
}
