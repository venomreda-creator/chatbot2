# 모두의 AI

KB 반려행복펫보험 약관(`dataset/kb.pdf`)을 검색해 근거와 출처를 함께 보여 주는 한국어 RAG 챗봇입니다. Next.js App Router, Supabase(인증·DB·벡터 검색), Upstage 임베딩, OpenAI 스트리밍을 사용합니다.

## 주요 기능

- Google 소셜 로그인 / 로그아웃, 프로필 이름·사진 표시
- 채팅방별 질문·답변·생성 시간 저장, 사이드바에서 이전 대화 다시 열기
- 질문과 관련된 약관 조각을 벡터 검색해 답변 생성, 답변 아래 참고 문서(쪽수) 표시
- 약관과 무관한 질문은 문서를 인용하지 않고 일반 답변
- RLS로 사용자별 대화·메시지 접근 격리

## 로컬 실행

```bash
npm install
cp .env.example .env.local
```

`.env.local`에 아래 값을 채운 뒤 실행합니다.

```bash
npm run dev
```

`http://localhost:3000`에서 확인할 수 있습니다.

## 환경 변수

| 변수 | 필수 | 설명 |
| --- | --- | --- |
| `OPENAI_API_KEY` | 예 | 답변 생성에 사용하는 OpenAI API 키 |
| `OPENAI_MODEL` | 아니요 | 사용할 모델. 기본값은 `gpt-4o-mini` |
| `UPSTAGE_API_KEY` | 예 | 질문·문서 임베딩(`embedding-query`, `embedding-passage`) |
| `NEXT_PUBLIC_SUPABASE_URL` | 예 | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 예 | Supabase publishable(anon) 키. 브라우저에 노출됩니다. |
| `SUPABASE_SECRET_KEY` | 아니요 | `npm run ingest`·검증 스크립트에서만 사용하는 시크릿 키. 배포 환경에는 넣지 않아도 됩니다. |

`OPENAI_API_KEY`, `UPSTAGE_API_KEY`, `SUPABASE_SECRET_KEY`는 `NEXT_PUBLIC_` 접두사를 붙이지 마세요.

## Supabase 준비

1. Supabase 프로젝트를 만듭니다.
2. **SQL Editor**에서 `supabase/schema.sql`을 실행합니다. `vector` 확장(4096차원), `conversations`·`messages`·`document_chunks` 테이블, RLS 정책, `match_document_chunks` 함수가 생성됩니다.
3. **Authentication → Providers → Google**을 활성화하고 Google OAuth 클라이언트 ID/Secret을 등록합니다.
4. **Authentication → URL Configuration**의 Redirect URLs에 아래를 추가합니다.
   - `http://localhost:3000/**`
   - 배포 도메인의 `https://<도메인>/auth/callback`
5. Google Cloud Console의 OAuth 클라이언트 승인된 리디렉션 URI에 `https://<project-ref>.supabase.co/auth/v1/callback`을 등록합니다.

## 문서 인덱싱

약관 PDF를 청크로 나누고 Upstage로 임베딩해 `document_chunks`에 저장합니다. 스키마 적용 후 한 번만 실행하면 됩니다.

```bash
npm run ingest
```

`.env.local`의 `SUPABASE_SECRET_KEY`가 필요합니다. 원문을 바꿨다면 같은 명령을 다시 실행하세요. `(source, chunk_index)` 기준으로 중복 없이 갱신됩니다.

## 검증

```bash
# 벡터 검색이 실제로 동작하는지 확인
node scripts/verify-rag.mjs

# 로그인 사용자 권한으로 저장·검색·RLS 격리 확인 (임시 계정 생성 후 자동 삭제)
node scripts/verify-access.mjs

npm run lint
npm run typecheck
npm run build
```

## Vercel 배포

1. 저장소를 Vercel에 연결합니다.
2. **Settings → Environment Variables**에 `OPENAI_API_KEY`, `UPSTAGE_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`를 추가합니다.
3. 배포 후 Supabase Redirect URLs에 배포 도메인의 `/auth/callback`을 추가합니다.
4. 로컬에서 `npm run ingest`를 한 번 실행해 문서를 인덱싱합니다(또는 배포 환경에서 시크릿 키로 실행).

API 키는 서버에서만 사용하며 브라우저 번들에 포함되지 않습니다. OpenAI·Upstage 사용량에 따라 비용이 발생할 수 있습니다.
