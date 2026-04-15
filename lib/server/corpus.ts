import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { stemmer } from "stemmer";
import iconv from "iconv-lite";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";

export type CorpusEntry = {
  sourceFile: string;
  sentence: string;
};

export type CorpusData = {
  createdAt: string;
  totalFiles: number;
  totalSentences: number;
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: true,
  trimValues: true,
});

function collectText(node: unknown, bag: string[]) {
  if (typeof node === "string") {
    const trimmed = node.trim();
    if (trimmed) bag.push(trimmed);
    return;
  }
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectText(item, bag);
    return;
  }
  for (const value of Object.values(node as Record<string, unknown>)) {
    collectText(value, bag);
  }
}

function normalizeText(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function sanitizeForStorage(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);

    // Drop control chars except tab/newline/carriage-return.
    if ((code >= 0x00 && code <= 0x08) || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f)) {
      continue;
    }

    // Keep valid surrogate pairs only.
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = input.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += input[i] + input[i + 1];
        i += 1;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      continue;
    }

    out += input[i];
  }
  return out;
}

function splitSentences(text: string): string[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  return normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sanitizeForStorage(sentence.trim()))
    .filter((sentence) => sentence.length >= 8);
}

async function parseHwpxBuffer(buffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const sectionFiles = Object.keys(zip.files)
    .filter((key) => key.startsWith("Contents/section") && key.endsWith(".xml"))
    .sort();

  if (sectionFiles.length === 0) return "";

  const chunks: string[] = [];
  for (const sectionPath of sectionFiles) {
    const xml = await zip.files[sectionPath].async("string");
    const parsed = xmlParser.parse(xml);
    collectText(parsed, chunks);
  }

  return normalizeText(chunks.join(" "));
}

async function parseFileEntry(name: string, file: JSZip.JSZipObject): Promise<string> {
  const lower = name.toLowerCase();
  if (lower.endsWith(".txt")) {
    const raw = await file.async("nodebuffer");
    const utf8Text = iconv.decode(raw, "utf8");
    const hasBrokenChar = utf8Text.includes("\uFFFD");
    const decoded = hasBrokenChar ? iconv.decode(raw, "cp949") : utf8Text;
    return normalizeText(decoded);
  }
  if (lower.endsWith(".hwpx")) {
    const buffer = await file.async("arraybuffer");
    return parseHwpxBuffer(buffer);
  }
  return "";
}

export function sentenceContainsWord(sentence: string, word: string): boolean {
  const raw = word.trim();
  if (!raw) return false;
  if (/^[a-zA-Z][a-zA-Z'-]*$/.test(raw)) {
    const lower = raw.toLowerCase();
    const pattern = buildEnglishVariants(lower)
      .map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");
    const directMatch = new RegExp(`\\b(?:${pattern})\\b`, "i").test(sentence);
    if (directMatch) return true;

    // Fallback: stem-based match to catch broader inflections
    // (plural, past, participle, progressive) with low risk.
    const tokens = sentence.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
    if (tokens.length === 0) return false;

    const queryStem = stemmer(lower);
    if (!queryStem) return false;

    return tokens.some((token) => {
      if (token.length <= 2) return false;
      const tokenStem = stemmer(token);
      if (!tokenStem) return false;
      return tokenStem === queryStem;
    });
  }
  return sentence.toLowerCase().includes(raw.toLowerCase());
}

function buildEnglishVariants(raw: string): string[] {
  const lower = raw.toLowerCase();
  const irregularForms: Record<string, string[]> = {
    run: ["ran"],
    go: ["went", "gone"],
    do: ["did", "done"],
    be: ["am", "is", "are", "was", "were", "been", "being"],
    have: ["has", "had"],
  };

  const variants = new Set<string>([
    lower,
    `${lower}s`,
    `${lower}es`,
    `${lower}ed`,
    `${lower}ing`,
    `${lower}ly`,
    ...(irregularForms[lower] ?? []),
  ]);

  if (lower.length >= 3) {
    variants.add(`${lower}${lower[lower.length - 1]}ing`);
    variants.add(`${lower}${lower[lower.length - 1]}ed`);
  }
  if (lower.endsWith("e")) {
    variants.add(`${lower.slice(0, -1)}ing`);
  }
  // tolerate common adverb typo: criticaly -> critically
  if (lower.endsWith("aly")) {
    variants.add(`${lower.slice(0, -1)}ly`);
  }
  return Array.from(variants);
}

function buildCandidateOrClause(word: string): string | null {
  const raw = word.trim().toLowerCase();
  if (!raw) return null;

  const needs = /^[a-zA-Z][a-zA-Z'-]*$/.test(raw) ? buildEnglishVariants(raw) : [raw];
  const escaped = needs.map((item) => item.replace(/[%_,]/g, "\\$&"));
  return escaped.map((item) => `sentence.ilike.%${item}%`).join(",");
}

export async function saveCorpusFromZip(zipFile: File): Promise<CorpusData> {
  const zipBuffer = await zipFile.arrayBuffer();
  const zip = await JSZip.loadAsync(zipBuffer);
  const entries: CorpusEntry[] = [];
  let totalFiles = 0;

  const fileNames = Object.keys(zip.files).sort();
  let parseErrors = 0;
  for (const name of fileNames) {
    const file = zip.files[name];
    if (file.dir) continue;
    const lower = name.toLowerCase();
    if (!lower.endsWith(".txt") && !lower.endsWith(".hwpx")) continue;

    let text = "";
    try {
      text = await parseFileEntry(name, file);
    } catch (error) {
      parseErrors += 1;
      console.error(`[corpus] 파일 파싱 실패: ${name}`, error);
      continue;
    }
    if (!text) continue;

    totalFiles += 1;
    const sentences = splitSentences(text);
    for (const sentence of sentences) {
      entries.push({ sourceFile: name, sentence });
    }
  }

  const dedupMap = new Map<string, CorpusEntry>();
  for (const entry of entries) {
    const key = `${entry.sourceFile}::${entry.sentence}`;
    dedupMap.set(key, entry);
  }

  const corpus: CorpusData = {
    createdAt: new Date().toISOString(),
    totalFiles,
    totalSentences: dedupMap.size,
  };
  if (totalFiles === 0) {
    throw new Error(
      parseErrors > 0
        ? "ZIP 안 파일을 파싱하지 못했습니다. txt 인코딩(UTF-8/CP949) 또는 hwpx 파일 형식을 확인해 주세요."
        : "ZIP 안에 처리 가능한 .txt/.hwpx 파일이 없습니다.",
    );
  }
  const supabase = getSupabaseAdmin();
  const entriesToInsert = Array.from(dedupMap.values());

  async function clearTableInBatches(table: "corpus_entries" | "corpus_meta", batchSize = 3000) {
    while (true) {
      const { data: idRows, error: selectError } = await supabase
        .from(table)
        .select("id")
        .order("id", { ascending: true })
        .limit(batchSize);
      if (selectError) {
        throw new Error(`${table} 조회 실패: ${selectError.message}`);
      }
      if (!idRows || idRows.length === 0) {
        break;
      }

      const ids = idRows.map((row) => row.id as number).filter((id) => Number.isFinite(id));
      const { error: deleteError } = await supabase.from(table).delete().in("id", ids);
      if (deleteError) {
        throw new Error(`${table} 삭제 실패: ${deleteError.message}`);
      }
      if (idRows.length < batchSize) {
        break;
      }
    }
  }

  await clearTableInBatches("corpus_entries");
  await clearTableInBatches("corpus_meta");

  const chunkSize = 1000;
  for (let i = 0; i < entriesToInsert.length; i += chunkSize) {
    const chunk = entriesToInsert.slice(i, i + chunkSize);
    const payload = chunk.map((entry) => ({
      source_file: entry.sourceFile,
      sentence: entry.sentence,
    }));
    const { error } = await supabase.from("corpus_entries").insert(payload);
    if (error) {
      throw new Error(`코퍼스 저장 실패: ${error.message}`);
    }
  }

  const { error: metaInsertError } = await supabase.from("corpus_meta").insert({
    total_files: totalFiles,
    total_sentences: dedupMap.size,
  });
  if (metaInsertError) {
    throw new Error(`코퍼스 메타 저장 실패: ${metaInsertError.message}`);
  }

  return corpus;
}

export async function loadCorpus(): Promise<CorpusData | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("corpus_meta")
    .select("created_at,total_files,total_sentences")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return {
    createdAt: data.created_at as string,
    totalFiles: data.total_files as number,
    totalSentences: data.total_sentences as number,
  };
}

export async function findCorpusCandidates(word: string, limit = 300): Promise<CorpusEntry[]> {
  const supabase = getSupabaseAdmin();
  const clause = buildCandidateOrClause(word);
  if (!clause) return [];

  const { data, error } = await supabase
    .from("corpus_entries")
    .select("source_file,sentence")
    .or(clause)
    .order("id", { ascending: true })
    .limit(limit * 4);

  if (error || !data) {
    return [];
  }

  const filtered: CorpusEntry[] = [];
  for (const row of data) {
    const sourceFile = (row.source_file as string) ?? "";
    const sentence = (row.sentence as string) ?? "";
    if (!sourceFile || !sentence) continue;
    if (!sentenceContainsWord(sentence, word)) continue;
    filtered.push({ sourceFile, sentence });
    if (filtered.length >= limit) break;
  }
  return filtered;
}
