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
from routers import tagging, masking, scenario, chat, quiz, wish, stt, tts
from dependencies import require_service_token

# 백엔드만 호출하는 엔드포인트 — 공유 토큰으로 막는다.
# 여기가 Gemini를 호출하는 경로라 비용과 PII가 함께 흐른다.
_backend_only = [Depends(require_service_token)]

app.include_router(tagging.router, dependencies=_backend_only)
app.include_router(masking.router, dependencies=_backend_only)
app.include_router(scenario.router, dependencies=_backend_only)
app.include_router(chat.router, dependencies=_backend_only)
app.include_router(quiz.router, dependencies=_backend_only)
app.include_router(wish.router, dependencies=_backend_only)

# 브라우저가 직접 호출한다 — 브라우저에 심은 토큰은 비밀이 아니므로
# 토큰 대신 레이트리밋으로 막는다. 백엔드 프록시로 옮기는 것이 근본 해결(별도 과제).
app.include_router(stt.router)
app.include_router(tts.router)


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "ai-service"}
