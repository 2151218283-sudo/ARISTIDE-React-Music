import type { Metadata } from "next";

import { CatalogDetailPage } from "@/features/catalog/CatalogDetailPage";

export const metadata: Metadata = { title: "艺术家" };

export default async function ArtistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CatalogDetailPage entityId={id} kind="artist" />;
}
