import { createHotSearchHandler } from "@/lib/music/hotSearchBff";
import { createLegacyNeteaseAdapter } from "@/lib/music/netease/index.server";
import { sessionStore } from "@/lib/session/sessionStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const getHotSearches = createHotSearchHandler({
  createProvider: createLegacyNeteaseAdapter,
  store: sessionStore,
});

export async function GET(request: Request): Promise<Response> {
  return getHotSearches(request);
}
