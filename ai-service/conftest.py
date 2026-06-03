"""pytest 전역 설정.

ai-service 루트를 sys.path에 추가해 services/models/constants 등 최상위 패키지를
어디서 pytest를 실행하든 import할 수 있게 한다.
"""
import os
import sys

# 본 파일(conftest.py)이 위치한 ai-service 루트를 sys.path 최상단에 추가
_AI_SERVICE_ROOT = os.path.dirname(os.path.abspath(__file__))
if _AI_SERVICE_ROOT not in sys.path:
    sys.path.insert(0, _AI_SERVICE_ROOT)
