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

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anon = createClient(url, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const stamp = Date.now();
const emailA = `rag-test-a-${stamp}@example.com`;
const emailB = `rag-test-b-${stamp}@example.com`;
const password = `Test-${stamp}-pass!`;

const results = [];
const check = (label, ok, detail = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
};

const { data: userA, error: userAError } = await admin.auth.admin.createUser({
  email: emailA,
  password,
  email_confirm: true,
  user_metadata: { full_name: "테스트 사용자 A", avatar_url: null },
});
check("create user A", !userAError, userAError?.message);

const { data: userB, error: userBError } = await admin.auth.admin.createUser({
  email: emailB,
  password,
  email_confirm: true,
  user_metadata: { full_name: "테스트 사용자 B" },
});
check("create user B", !userBError, userBError?.message);

const sessionA = createClient(url, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { error: signInAError } = await sessionA.auth.signInWithPassword({ email: emailA, password });
check("sign in as A (authenticated role)", !signInAError, signInAError?.message);

const sessionB = createClient(url, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
await sessionB.auth.signInWithPassword({ email: emailB, password });

const { data: conversation, error: conversationError } = await sessionA
  .from("conversations")
  .insert({ user_id: userA.user.id, title: "새 대화" })
  .select("id, title")
  .single();
check("A creates conversation", !conversationError, conversationError?.message);

const { error: userMessageError } = await sessionA.from("messages").insert({
  conversation_id: conversation?.id,
  user_id: userA.user.id,
  role: "user",
  content: "보험금 청구는 어떻게 하나요?",
});
check("A stores user message", !userMessageError, userMessageError?.message);

const { error: assistantMessageError } = await sessionA.from("messages").insert({
  conversation_id: conversation?.id,
  user_id: userA.user.id,
  role: "assistant",
  content: "약관 p.15에 따르면...",
  sources: [{ source: "KB 반려행복펫보험 약관", page: 15, similarity: 0.48 }],
});
check("A stores assistant message", !assistantMessageError, assistantMessageError?.message);

const { data: touched } = await sessionA
  .from("conversations")
  .select("title, updated_at")
  .eq("id", conversation?.id)
  .single();
check("trigger renames conversation", touched?.title === "보험금 청구는 어떻게 하나요?", touched?.title);

const embeddingResponse = await fetch("https://api.upstage.ai/v1/embeddings", {
  method: "POST",
  headers: { Authorization: `Bearer ${env.UPSTAGE_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ model: "embedding-query", input: "보험금 청구는 어떻게 하나요?" }),
});
const embedding = (await embeddingResponse.json()).data[0].embedding;
const { data: matches, error: matchError } = await sessionA.rpc("match_document_chunks", {
  query_embedding: `[${embedding.join(",")}]`,
  match_count: 4,
  match_threshold: 0.3,
});
check("A runs vector search", !matchError && (matches ?? []).length > 0, matchError?.message ?? `${matches?.length} chunks`);

const { data: bConversations, error: bReadError } = await sessionB
  .from("conversations")
  .select("id");
check("B cannot see A's conversations", !bReadError && (bConversations ?? []).length === 0, bReadError?.message ?? `${bConversations?.length ?? "?"} rows`);

const { error: bInsertError } = await sessionB.from("messages").insert({
  conversation_id: conversation?.id,
  user_id: userB.user.id,
  role: "user",
  content: "침입 시도",
});
check("B cannot write into A's conversation", Boolean(bInsertError), bInsertError?.message ?? "unexpectedly allowed");

const { error: bMessageReadError, data: bMessages } = await sessionB
  .from("messages")
  .select("id")
  .eq("conversation_id", conversation?.id);
check("B cannot read A's messages", !bMessageReadError && (bMessages ?? []).length === 0, bMessageReadError?.message ?? `${bMessages?.length ?? "?"} rows`);

const { error: anonReadError, data: anonRows } = await anon.from("conversations").select("id");
check("signed-out visitor sees nothing", (anonRows ?? []).length === 0, anonReadError?.message ?? "no rows");

await admin.auth.admin.deleteUser(userA.user.id);
await admin.auth.admin.deleteUser(userB.user.id);

const { count: remaining } = await admin
  .from("conversations")
  .select("id", { count: "exact", head: true });
check("test data cleaned up", (remaining ?? 0) === 0, `${remaining} conversations left`);

console.log(results.join("\n"));
