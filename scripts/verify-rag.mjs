import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  (await readFile(new URL("../.env.local", import.meta.url), "utf8"))
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { count, error: countError } = await supabase
  .from("document_chunks")
  .select("id", { count: "exact", head: true });
console.log("chunk rows:", count, countError?.message ?? "");

const questions = [
  "보험금 청구는 어떻게 하나요?",
  "반려동물이 다쳤을 때 보장되나요?",
  "오늘 점심 메뉴 추천해 줘",
];

for (const question of questions) {
  const embeddingResponse = await fetch("https://api.upstage.ai/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.UPSTAGE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "embedding-query", input: question }),
  });
  const embedding = (await embeddingResponse.json()).data[0].embedding;
  const { data, error } = await supabase.rpc("match_document_chunks", {
    query_embedding: `[${embedding.join(",")}]`,
    match_count: 4,
    match_threshold: 0.3,
  });
  console.log("\nQ:", question, error ? `ERROR ${error.message}` : "");
  for (const row of data ?? []) {
    console.log(`  ${row.similarity.toFixed(3)} p.${row.page} ${row.content.slice(0, 60).replace(/\n/g, " ")}`);
  }
}
