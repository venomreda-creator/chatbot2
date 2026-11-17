import { redirect } from "next/navigation";
import { ChatApp } from "@/components/chat-app";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) redirect("/");

  const metadata = user.user_metadata ?? {};
  const name = String(metadata.full_name || metadata.name || user.email || "사용자");
  const avatarUrl = typeof metadata.avatar_url === "string"
    ? metadata.avatar_url
    : typeof metadata.picture === "string"
      ? metadata.picture
      : null;

  return (
    <ChatApp
      profile={{
        name,
        email: user.email ?? null,
        avatarUrl,
      }}
    />
  );
}
