import { NextResponse } from "next/server";
import { addWordToTemplate, type TemplateMeaning } from "@/lib/server/templates";

export const runtime = "nodejs";

type AddWordBody = {
  word?: string;
  meanings?: Array<{
    meaning?: string;
    english?: string;
    korean?: string;
  }>;
};

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await req.json()) as AddWordBody;
    const word = typeof body.word === "string" ? body.word : "";
    const meanings: TemplateMeaning[] = Array.isArray(body.meanings)
      ? body.meanings
          .map((item) => ({
            meaning: (item.meaning ?? "").trim(),
            english: (item.english ?? "").trim(),
            korean: (item.korean ?? "").trim(),
          }))
          .filter((item) => item.meaning && item.english)
      : [];

    const saved = await addWordToTemplate(id, word, meanings);
    return NextResponse.json(saved);
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
