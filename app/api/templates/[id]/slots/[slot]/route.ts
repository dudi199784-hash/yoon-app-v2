import { NextResponse } from "next/server";
import { upsertTemplateSlot, type TemplateMeaning } from "@/lib/server/templates";

export const runtime = "nodejs";

type Body = {
  word?: string;
  meanings?: Array<{
    meaning?: string;
    english?: string;
    korean?: string;
  }>;
};

export async function PUT(
  req: Request,
  context: { params: Promise<{ id: string; slot: string }> },
) {
  try {
    const { id, slot } = await context.params;
    const slotIndex = Number(slot);
    const body = (await req.json()) as Body;
    const word = typeof body.word === "string" ? body.word : "";
    const meanings: TemplateMeaning[] = Array.isArray(body.meanings)
      ? body.meanings.map((item) => ({
          meaning: item.meaning ?? "",
          english: item.english ?? "",
          korean: item.korean ?? "",
        }))
      : [];

    await upsertTemplateSlot(id, slotIndex, word, meanings);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
