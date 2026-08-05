import { audioRelayRouteHandlers } from "@/lib/music/publicReadRouteHandlers.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return audioRelayRouteHandlers.audio(request, id);
}
