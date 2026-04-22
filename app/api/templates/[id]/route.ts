import { NextResponse } from "next/server";
import { getTemplate } from "@/lib/server/templates";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const template = await getTemplate(id);
    if (!template) {
      return NextResponse.json({ error: "템플릿을 찾을 수 없습니다." }, { status: 404 });
    }
    return NextResponse.json(template);
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
