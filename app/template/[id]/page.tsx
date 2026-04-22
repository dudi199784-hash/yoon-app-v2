"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type TemplateMeaning = {
  meaning: string;
  english: string;
  korean: string;
};

type TemplateSlot = {
  slotIndex: number;
  word: string;
  meanings: TemplateMeaning[];
};

type TemplateData = {
  id: string;
  title: string;
  createdAt: string;
  slots: TemplateSlot[];
};

type EditableSlot = {
  slotIndex: number;
  word: string;
  meanings: TemplateMeaning[];
};

export default function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState("");
  const [data, setData] = useState<TemplateData | null>(null);
  const [error, setError] = useState("");
  const [slots, setSlots] = useState<EditableSlot[]>([]);
  const [savingSlot, setSavingSlot] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      const resolved = await params;
      setId(resolved.id);
    })();
  }, [params]);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      setError("");
      const res = await fetch(`/api/templates/${id}`);
      const json = await res.json();
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "템플릿 조회 실패");
        return;
      }
      const template = json as TemplateData;
      setData(template);
      const map = new Map<number, TemplateSlot>();
      for (const slot of template.slots) map.set(slot.slotIndex, slot);
      setSlots(
        [1, 2, 3, 4].map((slotIndex) => ({
          slotIndex,
          word: map.get(slotIndex)?.word ?? "",
          meanings:
            map.get(slotIndex)?.meanings.length
              ? map.get(slotIndex)!.meanings
              : [{ meaning: "", english: "", korean: "" }],
        })),
      );
    })();
  }, [id]);

  if (error) {
    return <main className="p-6 text-red-400">{error}</main>;
  }
  if (!data) {
    return <main className="p-6 text-zinc-300">템플릿 불러오는 중...</main>;
  }

  function updateSlot(slotIndex: number, updater: (prev: EditableSlot) => EditableSlot) {
    setSlots((prev) => prev.map((slot) => (slot.slotIndex === slotIndex ? updater(slot) : slot)));
  }

  async function saveSlot(slot: EditableSlot) {
    setSavingSlot(slot.slotIndex);
    setError("");
    try {
      const res = await fetch(`/api/templates/${id}/slots/${slot.slotIndex}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word: slot.word,
          meanings: slot.meanings,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "슬롯 저장 실패");
    } catch (e) {
      setError(e instanceof Error ? e.message : "슬롯 저장 실패");
    } finally {
      setSavingSlot(null);
    }
  }

  return (
    <main className="kpub-font mx-auto min-h-screen w-full max-w-5xl bg-zinc-950 p-6 text-zinc-100 md:p-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">단어장 템플릿</h1>
          <p className="mt-1 text-sm text-zinc-400">
            제목: {data.title} / 생성: {new Date(data.createdAt).toLocaleString()}
          </p>
        </div>
        <Link
          href="/"
          className="rounded-md border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700"
        >
          검색 페이지로 돌아가기
        </Link>
      </div>

      <section className="space-y-3">
        {slots.map((slot) => {
          return (
            <article key={slot.slotIndex} className="rounded-md border border-zinc-700 bg-zinc-900 p-4">
              <p className="text-xs text-zinc-400">슬롯 {slot.slotIndex}</p>
              <input
                value={slot.word}
                onChange={(e) =>
                  updateSlot(slot.slotIndex, (prev) => ({ ...prev, word: e.target.value }))
                }
                placeholder="단어"
                className="mt-2 w-full rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-sm"
              />
              <div className="mt-3 space-y-2">
                {slot.meanings.map((item, idx) => (
                  <div key={`${slot.slotIndex}-${idx}`} className="rounded-md border border-zinc-700 p-3">
                    <input
                      value={item.meaning}
                      onChange={(e) =>
                        updateSlot(slot.slotIndex, (prev) => {
                          const meanings = [...prev.meanings];
                          meanings[idx] = { ...meanings[idx], meaning: e.target.value };
                          return { ...prev, meanings };
                        })
                      }
                      placeholder="뜻 (예: [형] 효과적인)"
                      className="w-full rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1 text-xs"
                    />
                    <textarea
                      value={item.english}
                      onChange={(e) =>
                        updateSlot(slot.slotIndex, (prev) => {
                          const meanings = [...prev.meanings];
                          meanings[idx] = { ...meanings[idx], english: e.target.value };
                          return { ...prev, meanings };
                        })
                      }
                      placeholder="영어 예문"
                      rows={2}
                      className="mt-2 w-full rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1 text-sm"
                    />
                    <textarea
                      value={item.korean}
                      onChange={(e) =>
                        updateSlot(slot.slotIndex, (prev) => {
                          const meanings = [...prev.meanings];
                          meanings[idx] = { ...meanings[idx], korean: e.target.value };
                          return { ...prev, meanings };
                        })
                      }
                      placeholder="한글 해석"
                      rows={2}
                      className="mt-2 w-full rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1 text-sm text-zinc-300"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        updateSlot(slot.slotIndex, (prev) => ({
                          ...prev,
                          meanings: prev.meanings.filter((_, i) => i !== idx),
                        }))
                      }
                      className="mt-2 rounded-md border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs"
                    >
                      뜻 항목 삭제
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    updateSlot(slot.slotIndex, (prev) => ({
                      ...prev,
                      meanings: [...prev.meanings, { meaning: "", english: "", korean: "" }],
                    }))
                  }
                  className="rounded-md border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs"
                >
                  뜻 항목 추가
                </button>
                <button
                  type="button"
                  onClick={() => void saveSlot(slot)}
                  disabled={savingSlot === slot.slotIndex}
                  className="rounded-md border border-zinc-600 bg-zinc-800 px-3 py-1 text-xs hover:bg-zinc-700 disabled:opacity-60"
                >
                  {savingSlot === slot.slotIndex ? "저장 중..." : "슬롯 저장"}
                </button>
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
