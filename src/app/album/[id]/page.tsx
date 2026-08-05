import type { Metadata } from "next";

import { CatalogDetailPage } from "@/features/catalog/CatalogDetailPage";

export const metadata: Metadata = { title: "专辑" };

export default async function AlbumPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CatalogDetailPage entityId={id} kind="album" />;
}
