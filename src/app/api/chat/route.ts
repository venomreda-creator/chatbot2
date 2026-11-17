import { NextRequest, NextResponse } from "next/server";
import { buildSystemPrompt, matchDocuments, sourcesFromRows } from "@/lib/rag";
import { createClient } from "@/lib/supabase/server";


export const runtime = "nodejs";

type StoredMessage = {
  role: "user" | "assistant";
  content: string;
};

function sse(payload: unknown) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claimsData?.claims?.sub) {
    return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (userError || !userId) {
    return NextResponse.json({ error: "로그인 정보를 확인하지 못했어요." }, { status: 401 });
  }

  let conversationId: string | null = null;
  let content = "";
  try {
    const body = await request.json();
    content = typeof body.message === "string" ? body.message.trim() : "";
    conversationId = typeof body.conversationId === "string" ? body.conversationId : null;
    if (!content || content.length > 4000) {
      return NextResponse.json({ error: "질문은 1자 이상 4000자 이하로 입력해 주세요." }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "요청을 읽지 못했어요." }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY가 설정되지 않았어요." }, { status: 503 });
  }

  if (!conversationId) {
    const { data, error } = await supabase
      .from("conversations")
      .insert({ user_id: userId, title: content.slice(0, 40) })
      .select("id")
      .single();
    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? "채팅방을 만들지 못했어요. 데이터베이스 스키마를 확인해 주세요." },
        { status: 500 },
      );
    }
    conversationId = data.id;
  } else {
    const { data, error } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) {
      return NextResponse.json({ error: "채팅방을 찾을 수 없어요." }, { status: 404 });
    }
  }

  const askedAt = new Date().toISOString();
  const { error: userMessageError } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    user_id: userId,
    role: "user",
    content,
    created_at: askedAt,
  });
  if (userMessageError) {
    return NextResponse.json({ error: userMessageError.message }, { status: 500 });
  }

  let chunks: Array<{ source: string; page: number | null; content: string; similarity: number }> = [];
  try {
    chunks = await matchDocuments(supabase, content);
  } catch (error) {
    const message = error instanceof Error ? error.message : "관련 문서를 검색하지 못했어요.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const sources = sourcesFromRows(chunks);
  const { data: history, error: historyError } = await supabase
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(12);
  if (historyError) {
    return NextResponse.json({ error: historyError.message }, { status: 500 });
  }

  const prior = ((history ?? []) as StoredMessage[]).reverse();
  const modelMessages = [
    { role: "system", content: buildSystemPrompt(chunks) },
    ...prior.map((message) => ({ role: message.role, content: message.content })),
  ];

  let upstream: Response;
  try {
    upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: modelMessages,
        stream: true,
      }),
    });
  } catch {
    return NextResponse.json({ error: "AI 서버에 연결하지 못했어요." }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const errorBody = await upstream.json().catch(() => null);
    return NextResponse.json(
      { error: errorBody?.error?.message ?? "AI 응답을 가져오지 못했어요." },
      { status: upstream.status || 502 },
    );
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = upstream.body.getReader();
  const activeConversationId = conversationId;

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(sse({ type: "meta", conversationId: activeConversationId, sources, askedAt })));
      let buffer = "";
      let answer = "";

      const consume = (chunk: string) => {
        buffer += chunk;
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const event of events) {
          const data = event
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("\n");
          if (!data || data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
            const text = parsed.choices?.[0]?.delta?.content;
            if (typeof text === "string") answer += text;
          } catch {
            // Ignore incomplete provider events.
          }
          controller.enqueue(encoder.encode(`${event}\n\n`));
        }
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          consume(decoder.decode(value, { stream: true }));
        }
        consume(decoder.decode());
        if (buffer.trim()) controller.enqueue(encoder.encode(buffer.endsWith("\n\n") ? buffer : `${buffer}\n\n`));

        if (answer.trim()) {
          const { error } = await supabase.from("messages").insert({
            conversation_id: activeConversationId,
            user_id: userId,
            role: "assistant",
            content: answer,
            sources,
          });
          if (error) {
            controller.enqueue(encoder.encode(sse({ type: "warning", message: "답변은 표시했지만 저장하지 못했어요." })));
          }
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch {
        controller.enqueue(encoder.encode(sse({ type: "error", message: "응답을 마무리하지 못했어요." })));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

