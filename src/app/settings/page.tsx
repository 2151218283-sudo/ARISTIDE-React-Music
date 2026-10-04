import type { Metadata } from "next";

import { SettingsExperience } from "@/features/settings/SettingsExperience";

export const metadata: Metadata = { title: "设置" };

export default function SettingsPage() {
  return <SettingsExperience />;
}
