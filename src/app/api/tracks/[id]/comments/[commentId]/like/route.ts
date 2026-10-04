import { commentWrites } from "@/lib/music/commentWriteRoute.server";

interface CommentLikeRouteContext {
  params: Promise<{ id: string; commentId: string }>;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  context: CommentLikeRouteContext,
): Promise<Response> {
  const { id, commentId } = await context.params;
  return commentWrites.like(request, id, commentId, true);
}

export async function DELETE(
  request: Request,
  context: CommentLikeRouteContext,
): Promise<Response> {
  const { id, commentId } = await context.params;
  return commentWrites.like(request, id, commentId, false);
}
