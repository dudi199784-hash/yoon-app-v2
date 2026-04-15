"use client";

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

  useEffect(() => {
    void refreshCorpusStatus();
  }, []);

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
            최초 1회 ZIP 파일을 적재하면, 이후에는 단어 검색만으로 뜻별 대표 예문(영문+해석)을
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
            <h2 className="text-lg font-semibold">코퍼스 적재 (최초 1회)</h2>
            <p className="text-sm text-zinc-300">
              .hwpx/.txt 파일이 들어있는 ZIP을 올리면 서버에 코퍼스를 저장합니다.
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
