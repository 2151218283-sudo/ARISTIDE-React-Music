import { dailyRecommendationRouteHandlers } from "@/lib/music/recommendationsRouteHandlers.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return await dailyRecommendationRouteHandlers.daily(request);
}
