import { createPublicReadRouteHandlers } from "@/lib/music/bff";
import { createLegacyNeteaseAdapter } from "@/lib/music/netease/index.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createPublicReadRouteHandlers({
  createProvider: createLegacyNeteaseAdapter,
});

export async function GET(
  request: Request,
  context: RouteContext<"/api/tracks/[id]/source">,
): Promise<Response> {
  const { id } = await context.params;
  return handlers.source(request, id);
}
