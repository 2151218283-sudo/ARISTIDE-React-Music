import { createPublicReadRouteHandlers } from "@/lib/music/bff";
import { createLegacyNeteaseAdapter } from "@/lib/music/netease/index.server";
import { DemoMusicProvider } from "@/lib/music/demo";
import { readSessionIdFromRequest, sessionStore } from "@/lib/session/sessionStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const sessionId = readSessionIdFromRequest(request);
  const mode = sessionId && sessionStore.getPublicState(sessionId)?.mode === "demo" ? "demo" : "real";
  return createPublicReadRouteHandlers({
    createProvider: mode === "demo" ? () => new DemoMusicProvider() : createLegacyNeteaseAdapter,
    mode,
  }).search(request);
}
