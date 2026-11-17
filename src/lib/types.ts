export type SourceRef = {
  source: string;
  page: number | null;
  similarity: number;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  sources: SourceRef[];
};

export type Conversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type Profile = {
  name: string;
  email: string | null;
  avatarUrl: string | null;
};
