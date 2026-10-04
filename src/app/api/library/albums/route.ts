import { libraryWriteRouteHandlers } from "@/lib/music/libraryWriteRouteHandlers.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return libraryWriteRouteHandlers.albums(request);
}
