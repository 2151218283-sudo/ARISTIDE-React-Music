import { commentWrites } from "@/lib/music/commentWriteRoute.server";
import { publicReadRouteHandlers } from "@/lib/music/publicReadRouteHandlers.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: RouteContext<"/api/tracks/[id]/comments">,
): Promise<Response> {
  const { id } = await context.params;
  return publicReadRouteHandlers.comments(request, id);
}

export async function POST(
  request: Request,
  context: RouteContext<"/api/tracks/[id]/comments">,
): Promise<Response> {
  const { id } = await context.params;
  return commentWrites.post(request, id);
}
