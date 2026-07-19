"""엔드포인트 동작 테스트용 서비스 토큰 헤더.

/stt·/tts를 포함한 모든 경로가 백엔드 전용(서비스 토큰 필수)이 되면서, 동작을
검증하는 테스트도 토큰을 보내야 한다. 이 테스트들의 관심사는 인증이 아니라
TTS/STT 동작이므로 헤더를 기본값으로 깔아둔다.
인증 자체는 tests/test_service_auth.py가 따로 검증한다.
"""
import os

_TOKEN = "endpoint-behavior-test-token"

# 모듈 import 시점에 설정해야 require_service_token이 읽을 수 있다.
os.environ.setdefault("AI_SERVICE_TOKEN", _TOKEN)

SERVICE_HEADERS = {"X-Service-Token": os.environ["AI_SERVICE_TOKEN"]}
