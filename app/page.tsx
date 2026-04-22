"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type CorpusStatus = {
  exists: boolean;
  createdAt?: string;
  totalFiles?: number;
  totalSentences?: number;
};

type SearchMeaning = {
  meaning: string;
  example: {
    english: string;
    korean: string;
  };
};

type SearchResult = {
  word: string;
  meanings: SearchMeaning[];
  candidateCount: number;
};

type TemplateSummary = {
  id: string;
  title: string;
  createdAt: string;
  filledSlots: number;
};

export default function Home() {
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<CorpusStatus>({ exists: false });
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [word, setWord] = useState("");
  const [meaning, setMeaning] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [templateTitle, setTemplateTitle] = useState("");
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [templateQuery, setTemplateQuery] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [addingToTemplate, setAddingToTemplate] = useState(false);

  useEffect(() => {
    void refreshCorpusStatus();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const url = templateQuery.trim()
          ? `/api/templates?q=${encodeURIComponent(templateQuery.trim())}`
          : "/api/templates";
        const res = await fetch(url);
        const json = await res.json();
        if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "템플릿 조회 실패");
        const list = (json.templates as TemplateSummary[]) ?? [];
        setTemplates(list);
        if (!selectedTemplateId && list.length > 0) {
          setSelectedTemplateId(list[0].id);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "템플릿 조회 실패");
      }
    })();
  }, [templateQuery, selectedTemplateId]);

  async function refreshCorpusStatus() {
    try {
      const res = await fetch("/api/corpus");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "코퍼스 상태 조회 실패");
      setStatus(json as CorpusStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : "코퍼스 상태 조회 실패");
    }
  }

  async function copyText(value: string) {
    await navigator.clipboard.writeText(value);
  }

  async function refreshTemplates() {
    const url = templateQuery.trim()
      ? `/api/templates?q=${encodeURIComponent(templateQuery.trim())}`
      : "/api/templates";
    const res = await fetch(url);
    const json = await res.json();
    if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "템플릿 조회 실패");
    const list = (json.templates as TemplateSummary[]) ?? [];
    setTemplates(list);
    if (!selectedTemplateId && list.length > 0) {
      setSelectedTemplateId(list[0].id);
    }
  }

  async function handleCreateTemplate() {
    setError("");
    setCreatingTemplate(true);
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: templateTitle.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "템플릿 생성 실패");
      setTemplateTitle("");
      setSelectedTemplateId(json.id as string);
      await refreshTemplates();
      window.open(`/template/${json.id as string}`, "_blank");
    } catch (e) {
      setError(e instanceof Error ? e.message : "템플릿 생성 실패");
    } finally {
      setCreatingTemplate(false);
    }
  }

  async function handleAddToTemplate() {
    setError("");
    if (!result) return;
    if (!selectedTemplateId) {
      setError("먼저 템플릿을 생성하거나 선택해 주세요.");
      return;
    }
    setAddingToTemplate(true);
    try {
      const res = await fetch(`/api/templates/${selectedTemplateId}/add-word`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word: result.word,
          meanings: result.meanings.map((item) => ({
            meaning: item.meaning,
            english: item.example.english,
            korean: item.example.korean,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "단어장 추가 실패");
      await refreshTemplates();
    } catch (e) {
      setError(e instanceof Error ? e.message : "단어장 추가 실패");
    } finally {
      setAddingToTemplate(false);
    }
  }

  function buildCopyAllText(data: SearchResult): string {
    const lines: string[] = [];
    lines.push(`단어: ${data.word}`);
    for (const item of data.meanings) {
      lines.push(`- 뜻: ${item.meaning}`);
      lines.push(`  ${item.example.english}`);
      lines.push(`  ${item.example.korean}`);
    }
    return lines.join("\n");
  }

  const resultCount = useMemo(() => result?.meanings.length ?? 0, [result]);

  async function handleUploadCorpus() {
    setError("");
    setResult(null);
    if (!zipFile) {
      setError("먼저 ZIP 파일을 선택해 주세요.");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("zip", zipFile);
      const res = await fetch("/api/corpus", { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(typeof json.error === "string" ? json.error : "코퍼스 업로드 실패");
      }
      await refreshCorpusStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "코퍼스 업로드 실패");
    } finally {
      setUploading(false);
    }
  }

  async function handleSearch() {
    setError("");
    setResult(null);
    if (!apiKey.trim()) {
      setError("OpenAI API Key를 입력해 주세요.");
      return;
    }
    if (!status.exists) {
      setError("먼저 ZIP 파일로 코퍼스를 적재해 주세요.");
      return;
    }
    if (!word.trim()) {
      setError("검색할 단어를 입력해 주세요.");
      return;
    }

    setSearching(true);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          word: word.trim(),
          meaning: meaning.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(typeof json.error === "string" ? json.error : "검색 실패");
      }
      setResult(json as SearchResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "검색 중 오류가 발생했습니다.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl bg-zinc-950 p-6 text-zinc-100 md:p-10">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold md:text-3xl">코퍼스 기반 단어 의미 검색기</h1>
          <p className="mt-2 text-sm text-zinc-300">
            ZIP 파일을 누적 적재한 뒤, 단어 검색만으로 뜻별 대표 예문(영문+해석)을
            가져옵니다.
          </p>
        </div>

        <section className="rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-sm">
          <label className="mb-2 block text-sm font-medium text-zinc-100">
            OpenAI API Key (사용자 직접 입력)
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            className="w-full rounded-md border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500"
          />
        </section>

        <section className="rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-sm">
          <div className="mb-3">
            <h2 className="text-lg font-semibold">코퍼스 적재 (누적 추가)</h2>
            <p className="text-sm text-zinc-300">
              .hwpx/.txt 파일이 들어있는 ZIP을 올리면 기존 데이터에 코퍼스를 누적 저장합니다.
            </p>
          </div>
          <label
            htmlFor="zip-upload"
            className="inline-flex cursor-pointer items-center rounded-md border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-700"
          >
            파일 선택
          </label>
          <input
            id="zip-upload"
            type="file"
            accept=".zip"
            onChange={(e) => setZipFile(e.target.files?.[0] ?? null)}
            className="sr-only"
          />
          {zipFile && <p className="mt-2 text-sm text-emerald-700">선택됨: {zipFile.name}</p>}
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void handleUploadCorpus()}
              disabled={uploading}
              className="rounded-md border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-700 disabled:opacity-60"
            >
              {uploading ? "적재 중..." : "ZIP 적재 실행"}
            </button>
            {status.exists ? (
              <p className="text-sm text-zinc-200">
                저장됨: 파일 {status.totalFiles?.toLocaleString()}개 / 문장{" "}
                {status.totalSentences?.toLocaleString()}개
              </p>
            ) : (
              <p className="text-sm text-amber-700">아직 코퍼스가 저장되지 않았습니다.</p>
            )}
          </div>
          {status.exists && status.createdAt && (
            <p className="mt-2 text-xs text-zinc-400">
              마지막 적재 시각: {new Date(status.createdAt).toLocaleString()}
            </p>
          )}
        </section>

        <section className="rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-sm">
          <h2 className="text-lg font-semibold">템플릿</h2>
          <p className="mb-3 text-sm text-zinc-300">
            템플릿 생성 후 검색 결과를 단어장에 추가할 수 있습니다. (템플릿당 최대 4단어)
          </p>
          <div className="grid gap-2 md:grid-cols-12">
            <input
              value={templateTitle}
              onChange={(e) => setTemplateTitle(e.target.value)}
              placeholder="템플릿 제목 (선택)"
              className="rounded-md border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 md:col-span-6"
            />
            <button
              type="button"
              onClick={() => void handleCreateTemplate()}
              disabled={creatingTemplate}
              className="rounded-md border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-700 disabled:opacity-60 md:col-span-3"
            >
              {creatingTemplate ? "생성 중..." : "템플릿에 추가하기"}
            </button>
            <input
              value={templateQuery}
              onChange={(e) => setTemplateQuery(e.target.value)}
              placeholder="제목 검색"
              className="rounded-md border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 md:col-span-2"
            />
            <button
              type="button"
              onClick={() => void refreshTemplates()}
              className="rounded-md border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-700 md:col-span-1"
            >
              조회
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {templates.map((template) => (
              <div
                key={template.id}
                className={`flex items-center justify-between rounded-md border p-2 ${
                  selectedTemplateId === template.id
                    ? "border-indigo-500 bg-zinc-800"
                    : "border-zinc-700 bg-zinc-900"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setSelectedTemplateId(template.id)}
                  className="text-left text-sm"
                >
                  {template.title} / {new Date(template.createdAt).toLocaleDateString()} /{" "}
                  {template.filledSlots}/4
                </button>
                <Link
                  className="rounded-md border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs hover:bg-zinc-700"
                  href={`/template/${template.id}`}
                  target="_blank"
                >
                  열기
                </Link>
              </div>
            ))}
            {templates.length === 0 && (
              <p className="text-sm text-zinc-400">템플릿이 없습니다. 먼저 생성해 주세요.</p>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-sm">
          <h2 className="text-lg font-semibold">단어 검색</h2>
          <p className="mb-3 text-sm text-zinc-300">
            뜻을 비워두면 AI가 의미를 자동 분류하고, 의미당 예문 1개씩 반환합니다.
          </p>
          <div className="grid gap-2 md:grid-cols-12">
            <input
              value={word}
              onChange={(e) => setWord(e.target.value)}
              placeholder="단어 (예: run)"
              className="rounded-md border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 md:col-span-4"
            />
            <input
              value={meaning}
              onChange={(e) => setMeaning(e.target.value)}
              placeholder="뜻 (선택) - 예: [동] 운영하다"
              className="rounded-md border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 md:col-span-6"
            />
            <button
              type="button"
              onClick={() => void handleSearch()}
              disabled={searching}
              className="rounded-md border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-700 disabled:opacity-60 md:col-span-2"
            >
              {searching ? "검색 중..." : "검색"}
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        </section>

        {result && (
          <section className="rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">검색 결과 (의미 {resultCount}개)</h2>
              <p className="text-xs text-zinc-400">
                코퍼스 후보 문장 수: {result.candidateCount.toLocaleString()}개
              </p>
              <button
                type="button"
                onClick={() => void copyText(buildCopyAllText(result))}
                className="rounded-md border border-zinc-600 bg-zinc-800 px-3 py-1 text-sm text-zinc-100 hover:bg-zinc-700"
              >
                전체 복사
              </button>
              <button
                type="button"
                onClick={() => void handleAddToTemplate()}
                disabled={addingToTemplate}
                className="rounded-md border border-zinc-600 bg-zinc-800 px-3 py-1 text-sm text-zinc-100 hover:bg-zinc-700 disabled:opacity-60"
              >
                {addingToTemplate ? "추가 중..." : "단어장에 추가하기"}
              </button>
            </div>

            <div className="space-y-5">
              <article className="rounded-lg border border-zinc-700 bg-zinc-950 p-3">
                <h3 className="text-base font-bold">단어: {result.word}</h3>
                <div className="mt-3 space-y-3">
                  {result.meanings.map((item, idx) => {
                    const payload = `${item.example.english}\n${item.example.korean}`;
                    return (
                      <div
                        key={`${item.meaning}-${idx}`}
                        className="rounded-md border border-zinc-700 bg-zinc-900 p-3"
                      >
                        <p className="mb-2 text-sm font-semibold text-zinc-100">뜻: {item.meaning}</p>
                        <p className="text-sm text-zinc-100">{item.example.english}</p>
                        <p className="mt-1 text-sm text-zinc-300">{item.example.korean}</p>
                        <button
                          type="button"
                          onClick={() => void copyText(payload)}
                          className="mt-2 rounded-md border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs text-zinc-100 hover:bg-zinc-700"
                        >
                          복사
                        </button>
                      </div>
                    );
                  })}
                  {result.meanings.length === 0 && (
                    <p className="text-sm text-zinc-400">해당 단어 예문을 찾지 못했습니다.</p>
                  )}
                </div>
              </article>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
