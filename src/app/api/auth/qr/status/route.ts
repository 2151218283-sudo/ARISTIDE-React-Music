import { authRouteHandlers } from "@/lib/session/authRouteHandlers.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return await authRouteHandlers.qrStatus(request);
}
