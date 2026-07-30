import { dailyRecommendationRouteHandlers } from "@/lib/music/recommendationsRouteHandlers.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request): Promise<Response> {
  return await dailyRecommendationRouteHandlers.setMode(request);
}
