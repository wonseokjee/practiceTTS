"""
practiveTTS AI 서비스 엔트리포인트.
FastAPI 앱 초기화, CORS 설정, 라우터 등록.
"""
from fastapi import FastAPI
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
from routers import tagging, masking, scenario, chat, quiz

app.include_router(tagging.router)
app.include_router(masking.router)
app.include_router(scenario.router)
app.include_router(chat.router)
app.include_router(quiz.router)


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "ai-service"}
