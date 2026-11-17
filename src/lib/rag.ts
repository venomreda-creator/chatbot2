import type { SourceRef } from "@/lib/types";

const UPSTAGE_URL = "https://api.upstage.ai/v1/embeddings";
const QUERY_MODEL = "embedding-query";
const PASSAGE_MODEL = "embedding-passage";

export const DOCUMENT_SOURCE = "KB 반려행복펫보험 약관";
export const MATCH_THRESHOLD = 0.3;
export const MATCH_COUNT = 4;

export async function embedTexts(inputs: string[], kind: "query" | "passage") {
  const apiKey = process.env.UPSTAGE_API_KEY;
  if (!apiKey) throw new Error("UPSTAGE_API_KEY가 설정되지 않았어요.");

  const response = await fetch(UPSTAGE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: kind === "query" ? QUERY_MODEL : PASSAGE_MODEL,
      input: inputs,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Upstage 임베딩에 실패했어요. ${detail.slice(0, 180)}`);
  }

  const payload = (await response.json()) as {
    data?: Array<{ index: number; embedding: number[] }>;
  };
  const rows = payload.data ?? [];
  if (rows.length !== inputs.length) {
    throw new Error("임베딩 결과 개수가 입력과 달라요.");
  }
  return rows.sort((a, b) => a.index - b.index).map((row) => row.embedding);
}

export function toVectorLiteral(values: number[]) {
  return `[${values.join(",")}]`;
}

type MatchRow = {
  id: string;
  source: string;
  page: number | null;
  content: string;
  similarity: number;
};

export async function matchDocuments(
  supabase: {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  },
  query: string,
) {
  const [embedding] = await embedTexts([query], "query");
  const { data, error } = await supabase.rpc("match_document_chunks", {
    query_embedding: toVectorLiteral(embedding),
    match_count: MATCH_COUNT,
    match_threshold: MATCH_THRESHOLD,
  });

  if (error) {
    throw new Error(
      error.message.includes("match_document_chunks")
        ? "문서 검색 함수가 아직 준비되지 않았어요. Supabase에 스키마를 적용해 주세요."
        : error.message,
    );
  }

  const rows = (Array.isArray(data) ? data : []) as MatchRow[];
  return rows.filter((row) => Number(row.similarity) >= MATCH_THRESHOLD);
}

export function sourcesFromRows(
  rows: Array<{ source: string; page: number | null; similarity: number }>,
): SourceRef[] {
  const seen = new Set<string>();
  const sources: SourceRef[] = [];
  for (const row of rows) {
    const key = `${row.source}:${row.page ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({
      source: row.source,
      page: row.page,
      similarity: Number(row.similarity),
    });
  }
  return sources;
}

export function buildSystemPrompt(chunks: Array<{ source: string; page: number | null; content: string }>) {
  if (chunks.length === 0) {
    return [
      "당신은 모두의 AI입니다. 한국어로 친절하고 정확하게 답하세요.",
      "이번 질문은 첨부 문서와 충분히 관련 있지 않아 문서 검색 결과를 사용하지 않습니다.",
      "문서에 없는 내용을 문서에서 찾은 것처럼 말하지 마세요.",
    ].join("\n");
  }

  const context = chunks
    .map((chunk, index) => {
      const page = chunk.page ? ` p.${chunk.page}` : "";
      return `[${index + 1}] ${chunk.source}${page}\n${chunk.content}`;
    })
    .join("\n\n");

  return [
    "당신은 모두의 AI입니다. 한국어로 친절하고 정확하게 답하세요.",
    "아래 참고 문서는 KB 반려행복펫보험 약관에서 검색한 내용입니다. 질문과 관련된 답은 이 문서에 근거하세요.",
    "문서에 없는 보장, 금액, 절차는 추측하지 말고 문서에서 확인되지 않는다고 말하세요.",
    "답변 본문에 참고 문서 이름을 자연스럽게 언급해도 됩니다. 출처 목록은 화면에서 따로 보여 줍니다.",
    "",
    context,
  ].join("\n");
}
