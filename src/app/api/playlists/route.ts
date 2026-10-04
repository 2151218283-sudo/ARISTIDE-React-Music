import { playlistRouteHandlers } from "@/lib/music/playlistRouteHandlers.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return playlistRouteHandlers.create(request);
}
