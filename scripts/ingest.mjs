import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { extractText, getDocumentProxy } from "unpdf";

const env = Object.fromEntries(
  (await readFile(new URL("../.env.local", import.meta.url), "utf8"))
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);

const source = "KB 반려행복펫보험 약관";
const buffer = await readFile(new URL("../dataset/kb.pdf", import.meta.url));
const pdf = await getDocumentProxy(new Uint8Array(buffer));
const { text } = await extractText(pdf, { mergePages: false });
const pages = Array.isArray(text) ? text : [text];

function chunkPage(raw) {
  const cleaned = String(raw).replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
  if (cleaned.length < 40) return [];
  const size = 800;
  const overlap = 120;
  const chunks = [];
  let start = 0;
  while (start < cleaned.length) {
    let end = Math.min(cleaned.length, start + size);
    if (end < cleaned.length) {
      const breakAt = Math.max(cleaned.lastIndexOf(" ", end), cleaned.lastIndexOf("\n", end));
      if (breakAt > start + size * 0.55) end = breakAt;
    }
    const piece = cleaned.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= cleaned.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

const documents = [];
pages.forEach((pageText, pageIndex) => {
  chunkPage(pageText).forEach((content) => {
    documents.push({ source, page: pageIndex + 1, content });
  });
});
documents.forEach((document, index) => {
  document.chunk_index = index;
});

async function embedPassages(inputs) {
  const response = await fetch("https://api.upstage.ai/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.UPSTAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "embedding-passage", input: inputs }),
  });
  if (!response.ok) throw new Error(await response.text());
  const payload = await response.json();
  return payload.data.sort((a, b) => a.index - b.index).map((row) => row.embedding);
}

const embeddings = [];
for (let index = 0; index < documents.length; index += 8) {
  const batch = documents.slice(index, index + 8).map((document) => document.content);
  embeddings.push(...(await embedPassages(batch)));
  console.log(`embedded ${embeddings.length}/${documents.length}`);
}

const rows = documents.map((document, index) => ({
  source: document.source,
  page: document.page,
  chunk_index: document.chunk_index,
  content: document.content,
  embedding: embeddings[index],
}));

const secretKey = env.SUPABASE_SECRET_KEY;
if (secretKey) {
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: deleteError } = await supabase.from("document_chunks").delete().eq("source", source);
  if (deleteError) throw deleteError;
  for (let index = 0; index < rows.length; index += 20) {
    const batch = rows.slice(index, index + 20).map((row) => ({
      ...row,
      embedding: `[${row.embedding.join(",")}]`,
    }));
    const { error } = await supabase.from("document_chunks").insert(batch);
    if (error) throw error;
  }
  console.log(`inserted ${rows.length} chunks with secret key`);
} else {
  const schema = await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8");
  const sqlString = (value) => `'${String(value).replace(/'/g, "''")}'`;
  const inserts = rows
    .map(
      (row) =>
        `insert into public.document_chunks (source, page, chunk_index, content, embedding) values (${sqlString(row.source)}, ${row.page}, ${row.chunk_index}, ${sqlString(row.content)}, ${sqlString(`[${row.embedding.join(",")}]`)}::extensions.vector);`,
    )
    .join("\n");
  const bootstrap = `${schema}\n\ndelete from public.document_chunks where source = ${sqlString(source)};\n${inserts}\n`;
  await writeFile(new URL("../supabase/bootstrap.sql", import.meta.url), bootstrap);
  console.log(`wrote supabase/bootstrap.sql with ${rows.length} chunks. Secret key was not available, so the database was not updated.`);
}
