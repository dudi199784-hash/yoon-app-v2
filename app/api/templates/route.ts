import { NextResponse } from "next/server";
import { createTemplate, listTemplates } from "@/lib/server/templates";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") ?? "";
    const templates = await listTemplates(q);
    return NextResponse.json({ templates });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const title = typeof body.title === "string" ? body.title : "";
    const created = await createTemplate(title);
    return NextResponse.json(created);
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
