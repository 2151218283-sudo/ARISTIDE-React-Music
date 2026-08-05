import { createCatalogReadRouteHandlers } from "@/lib/music/bff";
import { createLegacyNeteaseAdapter } from "@/lib/music/netease/index.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createCatalogReadRouteHandlers({
  createProvider: createLegacyNeteaseAdapter,
});

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return handlers.artist(request, id);
}
