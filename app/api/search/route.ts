import { NextResponse } from "next/server";
import { findCorpusCandidates, loadCorpus } from "@/lib/server/corpus";
import { extractResponseText, parseJsonFromText } from "@/lib/server/openai";

export const runtime = "nodejs";

type SearchBody = {
  apiKey?: string;
  word?: string;
  meaning?: string;
};

type SearchMeaning = {
  meaning: string;
  example?: {
    english?: string;
    korean?: string;
  };
};

type ParsedSearchResult = {
  word?: string;
  meanings?: SearchMeaning[];
};

function ensureMeaningTag(meaning: string): string {
  const trimmed = meaning.trim();
  if (!trimmed) return "[기타] 의미 미상";
  if (/^\[(동|명|형|부|전|접|대|감|조|기타)\]/.test(trimmed)) return trimmed;
  return `[기타] ${trimmed}`;
}

function normalizeMeaningKey(meaning: string): string {
  return meaning
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^\[(동|명|형|부|전|접|대|감|조|기타)\]\s*/g, "")
    .trim();
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as SearchBody;
    const apiKey = (body.apiKey ?? "").trim();
    const word = (body.word ?? "").trim();
    const meaning = (body.meaning ?? "").trim();

    if (!apiKey || !word) {
      return NextResponse.json({ error: "apiKey와 word는 필수입니다." }, { status: 400 });
    }

    const corpus = await loadCorpus();
    if (!corpus) {
      return NextResponse.json(
        { error: "저장된 코퍼스가 없습니다. 먼저 ZIP으로 코퍼스를 적재해 주세요." },
        { status: 400 },
      );
    }

    const candidates = await findCorpusCandidates(word, 1200);

    if (candidates.length === 0) {
      return NextResponse.json({
        word,
        meanings: [],
        candidateCount: 0,
      });
    }

    const prompt = `다음은 특정 단어가 포함된 실제 문장 목록이다.
단어: "${word}"
${meaning ? `사용자가 지정한 뜻: "${meaning}"` : "사용자 지정 뜻 없음. 단어의 등장 의미를 자동 분류하라."}

반드시 JSON만 반환:
{
  "word": "string",
  "meanings": [
    {
      "meaning": "string",
      "example": {
        "english": "실제 목록에 있는 영문 문장",
        "korean": "해당 영문 문장의 한국어 해석"
      }
    }
  ]
}

규칙:
1) example.english는 반드시 아래 목록에 그대로 존재해야 한다.
2) 의미 1개당 예문은 정확히 1개만.
3) 의미가 여러 개면 중복 없는 의미로 구성하고, 문장 목록에서 확인되는 의미를 가능한 한 전부 반환.
4) 사용자가 뜻을 지정한 경우, 해당 뜻과 가장 맞는 결과 1개만 반환.
5) 추론 과장 금지.
6) meaning은 반드시 한국어 뜻으로 작성하고 품사 태그를 앞에 붙인다.
   - 형식: "[동] ...", "[명] ...", "[형] ...", "[부] ...", "[전] ..."
   - 예: "[동] 운영하다", "[명] 강둑"
7) 동일한 입력에는 동일한 결과를 반환하도록 일관되게 선택하라.
8) 사용자 지정 뜻이 없는 경우, 의미 누락을 최소화하되 중복 의미는 절대 만들지 마라.

문장 목록:
${JSON.stringify(candidates.map((item) => item.sentence), null, 2)}`;

    const llmRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0,
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: prompt }],
          },
        ],
      }),
    });

    if (!llmRes.ok) {
      const errorText = await llmRes.text();
      return NextResponse.json(
        { error: `OpenAI API 오류: ${errorText}` },
        { status: llmRes.status },
      );
    }

    const llmJson = await llmRes.json();
    const text = extractResponseText(llmJson);
    const parsed = parseJsonFromText(text) as ParsedSearchResult;
    const deduped = new Map<
      string,
      { meaning: string; example: { english: string; korean: string } }
    >();
    for (const item of parsed.meanings ?? []) {
      const meaningText = ensureMeaningTag(item.meaning ?? "");
      const key = normalizeMeaningKey(meaningText);
      if (!key) continue;
      if (deduped.has(key)) continue;
      deduped.set(key, {
        meaning: meaningText,
        example: {
          english: item.example?.english?.trim() ?? "",
          korean: item.example?.korean?.trim() ?? "",
        },
      });
    }
    const normalizedMeanings = Array.from(deduped.values());

    return NextResponse.json({
      word: parsed.word ?? word,
      meanings: normalizedMeanings,
      candidateCount: candidates.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    const status = message.includes("환경 변수가 필요합니다") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
