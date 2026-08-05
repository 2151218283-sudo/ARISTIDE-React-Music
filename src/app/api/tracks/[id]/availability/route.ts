import { publicReadRouteHandlers } from "@/lib/music/publicReadRouteHandlers.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: RouteContext<"/api/tracks/[id]/availability">,
): Promise<Response> {
  const { id } = await context.params;
  return publicReadRouteHandlers.availability(request, id);
}
