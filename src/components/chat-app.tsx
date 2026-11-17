"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { MessageBody } from "@/components/message-body";
import type { ChatMessage, Conversation, Profile, SourceRef } from "@/lib/types";

const suggestions = [
  "보험금은 어떻게 청구하나요?",
  "반려동물이 다쳤을 때 보장 범위를 알려 줘.",
  "보험계약대출 이자는 어떻게 계산되나요?",
  "고객센터 연락처와 위치를 알려 줘.",
];

function formatTime(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function sourceLabel(source: SourceRef) {
  return source.page ? `${source.source} · ${source.page}쪽` : source.source;
}

export function ChatApp({ profile }: { profile: Profile }) {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef<string | null>(null);
  const isEmpty = messages.length === 0;

  useEffect(() => {
    void loadConversations();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isLoading]);

  async function loadConversations() {
    const response = await fetch("/api/conversations");
    if (!response.ok) return;
    const data = await response.json();
    setConversations(data.conversations ?? []);
  }

  async function openConversation(id: string) {
    if (isLoading) return;
    activeIdRef.current = id;
    setActiveId(id);
    setError("");
    const response = await fetch(`/api/conversations/${id}`);
    const data = await response.json();
    if (!response.ok) {
      setError(data.error ?? "대화를 불러오지 못했어요.");
      return;
    }
    setMessages(data.messages ?? []);
  }

  function startNewChat() {
    if (isLoading) return;
    activeIdRef.current = null;
    setActiveId(null);
    setMessages([]);
    setError("");
    setInput("");
    textareaRef.current?.focus();
  }

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  async function sendMessage(text: string) {
    const content = text.trim();
    if (!content || isLoading) return;

    const askedAt = new Date().toISOString();
    const optimistic: ChatMessage[] = [
      ...messages,
      { id: `local-user-${askedAt}`, role: "user", content, createdAt: askedAt, sources: [] },
      { id: `local-assistant-${askedAt}`, role: "assistant", content: "", createdAt: "", sources: [] },
    ];
    setMessages(optimistic);
    setInput("");
    setError("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: content, conversationId: activeIdRef.current }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? "응답을 불러오지 못했어요.");
      }
      if (!response.body) throw new Error("응답 스트림을 시작하지 못했어요.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";
      let sources: SourceRef[] = [];
      let createdAt = "";

      const apply = () => {
        setMessages([
          ...optimistic.slice(0, -1),
          {
            id: `local-assistant-${askedAt}`,
            role: "assistant",
            content: answer,
            createdAt,
            sources,
          },
        ]);
      };

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
          const parsed = JSON.parse(data) as {
            type?: string;
            conversationId?: string;
            sources?: SourceRef[];
            message?: string;
            choices?: Array<{ delta?: { content?: string } }>;
          };
          if (parsed.type === "meta") {
            if (parsed.conversationId) {
              activeIdRef.current = parsed.conversationId;
              setActiveId(parsed.conversationId);
            }
            sources = parsed.sources ?? [];
            createdAt = new Date().toISOString();
            apply();
            continue;
          }
          if (parsed.type === "error" || parsed.type === "warning") {
            setError(parsed.message ?? "응답을 저장하는 중 문제가 생겼어요.");
            continue;
          }
          const delta = parsed.choices?.[0]?.delta?.content;
          if (typeof delta === "string") {
            answer += delta;
            apply();
          }
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        consume(decoder.decode(value, { stream: true }));
      }
      consume(decoder.decode());
      await loadConversations();
    } catch (sendError) {
      setMessages(optimistic.slice(0, -2));
      setError(sendError instanceof Error ? sendError.message : "문제가 발생했어요.");
    } finally {
      setIsLoading(false);
      textareaRef.current?.focus();
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(input);
    }
  }

  return (
    <main className="chat-shell">
      <aside className="sidebar">
        <div className="sidebar-head">
          <span className="brand">
            <span className="brand-mark" aria-hidden="true">모</span>
            모두의 AI
          </span>
          <button className="new-chat-button" onClick={startNewChat} type="button">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
            <span>새 대화</span>
          </button>
        </div>
        <nav className="room-list" aria-label="채팅방">
          {conversations.length === 0 && <p className="room-empty">아직 저장된 대화가 없어요.</p>}
          {conversations.map((conversation) => (
            <button
              className={`room${conversation.id === activeId ? " is-active" : ""}`}
              key={conversation.id}
              onClick={() => void openConversation(conversation.id)}
              type="button"
            >
              <strong>{conversation.title}</strong>
              <span>{formatTime(conversation.updatedAt)}</span>
            </button>
          ))}
        </nav>
        <div className="profile">
          {profile.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="" className="profile-image" src={profile.avatarUrl} />
          ) : (
            <span className="profile-fallback" aria-hidden="true">{profile.name.slice(0, 1)}</span>
          )}
          <div>
            <strong>{profile.name}</strong>
            {profile.email && <span>{profile.email}</span>}
          </div>
          <button className="logout-button" onClick={() => void logout()} type="button">로그아웃</button>
        </div>
      </aside>

      <section className={`chat-area${isEmpty ? " is-empty" : ""}`} aria-label="채팅">
        {isEmpty ? (
          <div className="welcome">
            <div className="welcome-sparkle" aria-hidden="true">✳</div>
            <p className="eyebrow">모두의 AI</p>
            <h1>{profile.name}님, <span>무엇을 찾아볼까요?</span></h1>
            <p className="welcome-copy">약관과 관련된 질문은 문서를 검색해 답하고,<br className="mobile-break" /> 출처를 함께 보여 드려요.</p>
            <div className="suggestions" aria-label="추천 질문">
              {suggestions.map((prompt) => (
                <button className="suggestion-card" key={prompt} onClick={() => void sendMessage(prompt)} type="button">
                  <span className="suggestion-icon" aria-hidden="true">✦</span>
                  <span>{prompt}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="conversation" aria-live="polite">
            {messages.map((message, index) => (
              <article className={`message message-${message.role}`} key={message.id}>
                {message.role === "assistant" && <span className="assistant-avatar" aria-hidden="true">모</span>}
                <div className="message-content">
                  {message.content ? (
                    <MessageBody content={message.content} />
                  ) : isLoading && index === messages.length - 1 ? (
                    <span className="typing-indicator"><i /><i /><i /></span>
                  ) : null}
                  <div className="message-meta">
                    {message.createdAt && <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>}
                    {message.role === "assistant" && message.sources.length > 0 && (
                      <ul className="sources">
                        {message.sources.map((source) => (
                          <li key={`${source.source}-${source.page}`}>{sourceLabel(source)}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </article>
            ))}
            {error && <p className="error-message" role="alert">{error}</p>}
            <div ref={bottomRef} />
          </div>
        )}

        <div className="composer-wrap">
          {error && isEmpty && <p className="error-message composer-error" role="alert">{error}</p>}
          <form className="composer" onSubmit={handleSubmit}>
            <textarea
              ref={textareaRef}
              aria-label="메시지 입력"
              autoComplete="off"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="약관이나 궁금한 점을 물어보세요..."
              rows={1}
              value={input}
            />
            <div className="composer-footer">
              <span className="composer-hint"><kbd>↵</kbd> 전송 <span className="hint-divider">·</span> <kbd>shift + ↵</kbd> 줄바꿈</span>
              <button className="send-button" disabled={!input.trim() || isLoading} type="submit" aria-label="메시지 보내기">
                {isLoading ? <span className="send-spinner" /> : <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 15V5m0 0L5.5 9.5M10 5l4.5 4.5" /></svg>}
              </button>
            </div>
          </form>
          <p className="disclaimer">모두의 AI는 약관을 참고하지만 실수할 수 있어요. 중요한 내용은 원문을 확인해 주세요.</p>
        </div>
      </section>
    </main>
  );
}
