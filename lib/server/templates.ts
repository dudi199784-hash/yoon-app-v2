import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";

export type TemplateMeaning = {
  meaning: string;
  english: string;
  korean: string;
};

export type TemplateSummary = {
  id: string;
  title: string;
  createdAt: string;
  filledSlots: number;
};

export type TemplateSlot = {
  slotIndex: number;
  word: string;
  meanings: TemplateMeaning[];
};

export type TemplateDetail = {
  id: string;
  title: string;
  createdAt: string;
  slots: TemplateSlot[];
};

export async function createTemplate(title?: string): Promise<{ id: string }> {
  const supabase = getSupabaseAdmin();
  const normalizedTitle = (title ?? "").trim();
  const { data, error } = await supabase
    .from("templates")
    .insert({ title: normalizedTitle || null })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`템플릿 생성 실패: ${error?.message ?? "unknown error"}`);
  }
  return { id: data.id as string };
}

export async function listTemplates(query?: string): Promise<TemplateSummary[]> {
  const supabase = getSupabaseAdmin();
  let q = supabase.from("templates").select("id,title,created_at").order("created_at", {
    ascending: false,
  });
  if (query?.trim()) {
    q = q.ilike("title", `%${query.trim()}%`);
  }

  const { data, error } = await q.limit(50);
  if (error) {
    throw new Error(`템플릿 목록 조회 실패: ${error.message}`);
  }

  const templateIds = (data ?? []).map((row) => row.id as string);
  const fillCount = new Map<string, number>();
  if (templateIds.length > 0) {
    const { data: wordRows, error: wordError } = await supabase
      .from("template_words")
      .select("template_id")
      .in("template_id", templateIds);
    if (wordError) {
      throw new Error(`템플릿 단어 수 조회 실패: ${wordError.message}`);
    }
    for (const row of wordRows ?? []) {
      const tid = row.template_id as string;
      fillCount.set(tid, (fillCount.get(tid) ?? 0) + 1);
    }
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    title: (row.title as string | null) ?? "제목 없음",
    createdAt: row.created_at as string,
    filledSlots: fillCount.get(row.id as string) ?? 0,
  }));
}

export async function getTemplate(templateId: string): Promise<TemplateDetail | null> {
  const supabase = getSupabaseAdmin();
  const { data: templateRow, error: templateError } = await supabase
    .from("templates")
    .select("id,title,created_at")
    .eq("id", templateId)
    .maybeSingle();
  if (templateError) {
    throw new Error(`템플릿 조회 실패: ${templateError.message}`);
  }
  if (!templateRow) return null;

  const { data: words, error: wordsError } = await supabase
    .from("template_words")
    .select("slot_index,word,meanings_json")
    .eq("template_id", templateId)
    .order("slot_index", { ascending: true });
  if (wordsError) {
    throw new Error(`템플릿 단어 조회 실패: ${wordsError.message}`);
  }

  return {
    id: templateRow.id as string,
    title: (templateRow.title as string | null) ?? "제목 없음",
    createdAt: templateRow.created_at as string,
    slots: (words ?? []).map((row) => ({
      slotIndex: row.slot_index as number,
      word: row.word as string,
      meanings: (row.meanings_json as TemplateMeaning[]) ?? [],
    })),
  };
}

export async function addWordToTemplate(
  templateId: string,
  word: string,
  meanings: TemplateMeaning[],
): Promise<{ slotIndex: number }> {
  const supabase = getSupabaseAdmin();
  const normalizedWord = word.trim();
  if (!normalizedWord) throw new Error("단어가 비어 있습니다.");
  if (meanings.length === 0) throw new Error("뜻/예문 데이터가 비어 있습니다.");

  const { data: usedRows, error: usedError } = await supabase
    .from("template_words")
    .select("slot_index")
    .eq("template_id", templateId)
    .order("slot_index", { ascending: true });
  if (usedError) throw new Error(`슬롯 조회 실패: ${usedError.message}`);

  const used = new Set((usedRows ?? []).map((row) => row.slot_index as number));
  const slot = [1, 2, 3, 4].find((value) => !used.has(value));
  if (!slot) throw new Error("이 템플릿은 이미 4개 단어가 모두 채워졌습니다.");

  const { error: insertError } = await supabase.from("template_words").insert({
    template_id: templateId,
    slot_index: slot,
    word: normalizedWord,
    meanings_json: meanings,
  });
  if (insertError) {
    throw new Error(`단어장 추가 실패: ${insertError.message}`);
  }

  return { slotIndex: slot };
}

export async function upsertTemplateSlot(
  templateId: string,
  slotIndex: number,
  word: string,
  meanings: TemplateMeaning[],
): Promise<void> {
  if (slotIndex < 1 || slotIndex > 4) throw new Error("슬롯 번호가 올바르지 않습니다.");
  const supabase = getSupabaseAdmin();
  const normalizedWord = word.trim();
  const normalizedMeanings = meanings
    .map((item) => ({
      meaning: item.meaning.trim(),
      english: item.english.trim(),
      korean: item.korean.trim(),
    }))
    .filter((item) => item.meaning || item.english || item.korean);

  if (!normalizedWord && normalizedMeanings.length === 0) {
    const { error } = await supabase
      .from("template_words")
      .delete()
      .eq("template_id", templateId)
      .eq("slot_index", slotIndex);
    if (error) throw new Error(`슬롯 삭제 실패: ${error.message}`);
    return;
  }

  const { error } = await supabase.from("template_words").upsert(
    {
      template_id: templateId,
      slot_index: slotIndex,
      word: normalizedWord || " ",
      meanings_json: normalizedMeanings,
    },
    { onConflict: "template_id,slot_index" },
  );
  if (error) throw new Error(`슬롯 저장 실패: ${error.message}`);
}
