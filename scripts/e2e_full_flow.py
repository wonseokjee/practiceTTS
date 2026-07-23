"""Phase 1~6 전구간 헤드리스 E2E (API 직접 호출).

흐름: register → 오늘의 질문 → 캡처(multipart) → 이벤트 자동 생성 폴링
      → 풀이 조회 → 채점(더미→정답 재채점=만점) → 한마디 변환 → 오늘의 메시지.

요구: backend(3000), ai-service(8000) 가동 + GEMINI_API_KEY 설정.
실행: python scripts/e2e_full_flow.py
"""

import json
import sys
import time
import uuid

import requests

API = "http://localhost:3000"
AI = "http://localhost:8000"
s = requests.Session()
s.headers["Accept"] = "application/json"

OK, FAIL = "[OK]", "[FAIL]"
fails = 0


def hdr(n):
    print(f"\n=== {n} ===")


def show(label, ok, extra=""):
    global fails
    if not ok:
        fails += 1
    print(f"  {OK if ok else FAIL} {label}{(' — ' + extra) if extra else ''}")


def body(r):
    try:
        return json.dumps(r.json(), ensure_ascii=False)[:400]
    except Exception:
        return r.text[:400]


# 0) 헬스 ----------------------------------------------------------------
hdr("0) 헬스체크")
try:
    h = s.get(f"{AI}/health", timeout=5)
    show(f"ai-service /health {h.status_code}", h.ok, body(h))
except Exception as e:
    show("ai-service /health", False, str(e))

# 1) 회원가입 ------------------------------------------------------------
hdr("1) register (보호자+환자 단일 트랜잭션)")
email = f"e2e_{uuid.uuid4().hex[:10]}@test.local"
r = s.post(
    f"{API}/auth/register",
    json={
        "email": email,
        "password": "Test1234!",
        "displayName": "E2E보호자",
        "patientDisplayName": "E2E어르신",
        "patientModePin": "1234",
    },
    timeout=15,
)
show(f"register {r.status_code}", r.status_code == 201, email)
if r.status_code != 201:
    print("    ", body(r))
    sys.exit(1)
data = r.json()
token = data["accessToken"]
patient_id = data["user"]["patientId"]
s.headers["Authorization"] = f"Bearer {token}"
show("patientId 연결됨", bool(patient_id), patient_id)

# 2) 오늘의 환자 질문 ----------------------------------------------------
hdr("2) GET /diary-questions/today (scope=patient)")
r = s.get(
    f"{API}/diary-questions/today",
    params={"scope": "patient", "category": "activity"},
    timeout=10,
)
show(f"질문 조회 {r.status_code}", r.ok, body(r))
question_id = r.json()["id"]

# 3) 캡처 (multipart, 사진 없이 + 보호자 한마디 포함) ---------------------
hdr("3) POST /memory-entries (캡처)")
fields = {
    "patientId": patient_id,
    "mood": json.dumps({"level": 4}),
    "patientAnswers": json.dumps(
        [
            {
                "questionId": question_id,
                "category": "activity",
                "answerText": "오늘 손주랑 공원에서 산책했어요. 벚꽃이 활짝 펴서 사진도 찍었어요.",
            }
        ]
    ),
    "caregiverWishMessage": "엄마 오늘도 사랑해요. 늘 곁에 있을게요.",
}
r = s.post(
    f"{API}/memory-entries",
    files={k: (None, v) for k, v in fields.items()},
    timeout=20,
)
show(f"캡처 {r.status_code}", r.status_code == 201, body(r))
if r.status_code != 201:
    sys.exit(1)
memory_entry_id = r.json()["id"]

# 4) 이벤트 기반 자동 퀴즈 생성 폴링 ------------------------------------
hdr("4) 자동 생성 폴링 GET /quiz/sets?memoryEntryId=...")
quiz_set_id = None
status = None
gen_error = None
for attempt in range(40):  # 최대 ~40초
    r = s.get(f"{API}/quiz/sets", params={"memoryEntryId": memory_entry_id}, timeout=10)
    items = r.json().get("items", []) if r.ok else []
    if items:
        item = items[0]
        quiz_set_id = item["quizSetId"]
        status = item.get("generationStatus")
        gen_error = item.get("generationError")
        if status == "ready":
            break
        if status == "failed":
            break
    time.sleep(1)
show(
    f"퀴즈 생성 status={status}",
    status == "ready",
    f"setId={quiz_set_id} err={gen_error}",
)
if status != "ready":
    print("    생성 실패/타임아웃 — 이후 단계 일부 스킵")

# 5) 풀이 조회 -----------------------------------------------------------
questions = []
wish_in_detail = None
if quiz_set_id:
    hdr("5) GET /quiz/sets/:id (풀이용, 정답 은닉)")
    r = s.get(f"{API}/quiz/sets/{quiz_set_id}", timeout=10)
    if r.ok:
        detail = r.json()
        questions = detail.get("questions", [])
        wish_in_detail = detail.get("memoryEntry", {}).get("caregiverWishMessage")
        leaked = any(("correctAnswer" in q) for q in questions)
        show(f"문제 {len(questions)}개 조회", len(questions) == 5)
        show("정답 은닉(correctAnswer 미포함)", not leaked)
        show("보호자 한마디 노출", bool(wish_in_detail), str(wish_in_detail))
    else:
        show(f"풀이 조회 {r.status_code}", False, body(r))

# 6) 채점: 1차 더미 → correctAnswer 수집 → 2차 정답 재제출(만점) ---------
if questions:
    hdr("6) POST /quiz/sets/:id/attempts (채점)")
    # 6-1) 더미 답안
    t1 = str(uuid.uuid4())
    dummy = {
        "sessionToken": t1,
        "answers": [{"questionId": q["id"], "userAnswer": "___"} for q in questions],
    }
    r = s.post(f"{API}/quiz/sets/{quiz_set_id}/attempts", json=dummy, timeout=15)
    show(f"1차(더미) 채점 {r.status_code}", r.ok, f"score={r.json().get('sessionScore') if r.ok else body(r)}")
    if r.ok:
        results = r.json()["results"]
        correct = {x["questionId"]: x["correctAnswer"] for x in results}
        # 6-2) 정답 재제출 (새 sessionToken → 재채점)
        t2 = str(uuid.uuid4())
        good = {
            "sessionToken": t2,
            "answers": [
                {"questionId": qid, "userAnswer": ans} for qid, ans in correct.items()
            ],
        }
        r2 = s.post(f"{API}/quiz/sets/{quiz_set_id}/attempts", json=good, timeout=15)
        if r2.ok:
            res2 = r2.json()
            show(
                f"2차(정답) 채점 만점",
                res2.get("sessionScore") == 100,
                f"score={res2.get('sessionScore')} completed={res2.get('completed')} best={res2.get('bestScore')} newBest={res2.get('isNewBest')}",
            )
        else:
            show("2차 채점", False, body(r2))

# 7) 한마디 → 발화 연습 변환 (Pattern 1) --------------------------------
if quiz_set_id and wish_in_detail:
    hdr("7) POST /quiz/sets/:id/wish-practice (Pattern 1)")
    r = s.post(f"{API}/quiz/sets/{quiz_set_id}/wish-practice", timeout=30)
    show(f"한마디 변환 {r.status_code}", r.ok, body(r))

# 8) 오늘의 치유 메시지 (Pattern 2) -------------------------------------
hdr("8) GET /healing-messages/today (Pattern 2)")
r = s.get(f"{API}/healing-messages/today", timeout=10)
show(f"오늘의 메시지 {r.status_code}", r.ok and bool(r.json().get("text")), body(r))

# 결과 ------------------------------------------------------------------
print(f"\n{'='*40}\n전구간 결과: {'전부 통과' if fails == 0 else f'{fails}건 실패'}")
sys.exit(1 if fails else 0)
