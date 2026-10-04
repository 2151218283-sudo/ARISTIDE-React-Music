import { playlistRouteHandlers } from "@/lib/music/playlistRouteHandlers.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return playlistRouteHandlers.tracks(request, id);
}
