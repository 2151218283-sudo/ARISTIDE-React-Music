import { createPublicReadRouteHandlers } from "@/lib/music/bff";
import { createLegacyNeteaseAdapter } from "@/lib/music/netease/index.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createPublicReadRouteHandlers({
  createProvider: createLegacyNeteaseAdapter,
});

export async function GET(request: Request): Promise<Response> {
  return handlers.search(request);
}
