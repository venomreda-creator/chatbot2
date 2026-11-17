import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "모두의 AI",
  description: "문서 기반 RAG 챗봇. Google 계정으로 로그인하고 대화를 저장하세요.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
