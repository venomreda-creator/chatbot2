import { redirect } from "next/navigation";
import { GoogleButton } from "@/components/google-button";
import { createClient } from "@/lib/supabase/server";

const points = [
  { title: "문서 기반 답변", copy: "KB 반려행복펫보험 약관을 임베딩해, 관련 질문에는 근거와 함께 답합니다." },
  { title: "대화가 남습니다", copy: "로그인한 계정의 질문, 답변, 생성 시간을 채팅방마다 저장합니다." },
  { title: "Google 계정으로", copy: "Supabase Auth와 Google OAuth로 로그인하고, 언제든 로그아웃할 수 있습니다." },
];

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) redirect("/chat");

  return (
    <main className="landing">
      <header className="landing-nav">
        <span className="brand">
          <span className="brand-mark" aria-hidden="true">모</span>
          모두의 AI
        </span>
      </header>
      <section className="landing-hero">
        <p className="eyebrow">DOCUMENT-AWARE ASSISTANT</p>
        <h1>모두의 AI</h1>
        <p className="landing-lead">
          모두의 AI는 누구나 문서 속 답을 쉽게 찾을 수 있도록 만든 RAG 챗봇입니다.
          KB 반려행복펫보험 약관을 바탕으로 질문하고, Google 계정으로 대화를 이어서 볼 수 있어요.
        </p>
        <GoogleButton />
        {params.error === "auth" && (
          <p className="auth-error" role="alert">Google 로그인에 실패했어요. 잠시 후 다시 시도해 주세요.</p>
        )}
        <ul className="landing-points">
          {points.map((point) => (
            <li key={point.title}>
              <strong>{point.title}</strong>
              <span>{point.copy}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
