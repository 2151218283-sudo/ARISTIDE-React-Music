import type { Metadata } from "next";

import { ProfileExperience } from "@/features/profile/ProfileExperience";

export const metadata: Metadata = { title: "用户主页" };

export default async function ProfilePage(
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return <ProfileExperience key={id} userId={id} />;
}
