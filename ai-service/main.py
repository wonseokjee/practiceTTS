"""
practiveTTS AI 서비스 엔트리포인트.
FastAPI 앱 초기화, CORS 설정, 라우터 등록.
"""
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="practiveTTS AI Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 라우터 등록
from routers import tagging, masking, scenario, chat, quiz, wish, stt, tts, pronunciation
from dependencies import require_service_token

# 모든 엔드포인트는 백엔드를 통해서만 호출된다 — 공유 토큰으로 막는다.
#
# /stt·/tts는 예전에 브라우저가 직접 불러서 인증을 걸 수 없었다(브라우저에 심은
# 토큰은 비밀이 아니다). 백엔드에 프록시(/ai/stt, /ai/tts)를 두고 그쪽에서 JWT로
# 사용자를 검증하게 바꾸면서, 이제 이 서비스는 외부에 열린 경로가 없다.
_backend_only = [Depends(require_service_token)]

app.include_router(tagging.router, dependencies=_backend_only)
app.include_router(masking.router, dependencies=_backend_only)
app.include_router(scenario.router, dependencies=_backend_only)
app.include_router(chat.router, dependencies=_backend_only)
app.include_router(quiz.router, dependencies=_backend_only)
app.include_router(wish.router, dependencies=_backend_only)
app.include_router(stt.router, dependencies=_backend_only)
app.include_router(tts.router, dependencies=_backend_only)
app.include_router(pronunciation.router, dependencies=_backend_only)


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "ai-service"}
