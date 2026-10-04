import { libraryWriteRouteHandlers } from "@/lib/music/libraryWriteRouteHandlers.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return libraryWriteRouteHandlers.like(request, id, true);
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return libraryWriteRouteHandlers.like(request, id, false);
}
