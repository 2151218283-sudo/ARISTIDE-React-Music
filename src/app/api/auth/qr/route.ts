import { authRouteHandlers } from "@/lib/session/authRouteHandlers.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return await authRouteHandlers.startQr(request);
}
