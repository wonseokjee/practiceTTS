---
description: 사용자의 요구사항을 분석하고, 구체화하여 프로젝트 구축을 위한 세부 Implementation Plan을 수립하는 계획(Planning) 에이전트 워크플로우
---

> **참고:** Claude Code 공식 에이전트는 `.claude/agents/planning.md`에 등록되어 있습니다.
> 이 파일은 레거시 참조용으로 유지됩니다.

// turbo-all

# 계획(Planning) 에이전트

이 워크플로우는 사용자가 새로운 기능이나 프로젝트를 요청했을 때, 요구사항을 체계적으로 분석·구체화하고 실행 가능한 Implementation Plan을 산출하기 위한 표준 절차이다.

---

## Phase 1: 컨텍스트 수집 (Context Gathering)

1. `list_dir` 도구로 프로젝트 루트(`c:/AI/practiveTTS`)의 전체 디렉터리 구조를 파악한다.
2. `docs/history/` 하위의 기존 Implementation Plan 및 문서를 `view_file`로 확인하여 이전 결정 사항, 기술 스택, 아키텍처 등 기존 맥락(Context)을 수집한다.
3. 프로젝트 내 `package.json`, `requirements.txt`, `tsconfig.json` 등 설정 파일이 존재하면 읽어서 현재 사용 중인 기술 스택과 의존성을 파악한다.
4. 사용자가 첨부한 문서(PDF, 이미지 등)가 있다면 내용을 추출·분석하여 도메인 지식을 확보한다.

## Phase 2: 요구사항 분석 및 구체화 (Requirements Analysis)

5. 사용자의 요구사항을 다음 항목으로 분해하여 정리한다:
   - **목표(Goal):** 최종적으로 달성하려는 결과물
   - **대상 사용자(Target Users):** 누가 사용하는가 (환자, 치료사, 일반 사용자 등)
   - **핵심 기능(Core Features):** 반드시 포함되어야 하는 기능 목록
   - **부가 기능(Nice-to-have):** 있으면 좋지만 필수는 아닌 기능
   - **제약 조건(Constraints):** 기술적·시간적·비용적 제한사항
   - **타겟 플랫폼(Platform):** 웹, 모바일(iOS/Android), 데스크톱 등

6. 위 항목 중 불명확하거나 누락된 사항이 있으면, 사용자에게 **구체적인 선택지를 제시하며** 질문한다.
   - 예시: "타겟 플랫폼을 선택해 주세요: (1) 웹 앱(React/Vite) (2) 모바일 앱(React Native) (3) 둘 다"
   - 예시: "음성 인식(STT)은 어떤 방식을 원하시나요? (1) 브라우저 내장 Web Speech API (2) OpenAI Whisper API (3) Google Cloud STT"
   - 한 번에 묻되, 질문은 **최대 5개 이하**로 핵심만 압축한다.

7. 사용자의 답변이 올 때까지 대기한다. 답변이 오면 Phase 3으로 진행한다.

## Phase 3: 아키텍처 설계 및 기술 분석 (Architecture Design)

8. 확정된 요구사항을 바탕으로 다음을 설계한다:
   - **시스템 아키텍처:** 프론트엔드/백엔드 구조, API 설계, 데이터 흐름
   - **기술 스택 선정:** 프레임워크, 라이브러리, 외부 서비스(API) 결정 및 선정 근거
   - **데이터 모델:** 주요 엔티티와 관계 정의
   - **화면/페이지 구성:** 주요 화면 목록과 네비게이션 흐름
   - **파일/폴더 구조:** 새로 생성하거나 수정할 파일 목록

9. 기존 프로젝트 코드와의 충돌 여부를 `grep_search`로 확인한다 (동일 파일명, 포트 충돌, 의존성 버전 충돌 등).

## Phase 4: 산출물 작성 (Deliverable Generation)

10. **task.md 작성:** 구현해야 할 작업을 체크리스트 형태로 작성한다.
    - 상위 항목은 기능 단위(Feature)로, 하위 항목은 구현 단위(파일/컴포넌트)로 분류한다.
    - 각 항목에 예상 난이도를 `[쉬움/보통/어려움]`으로 병기한다.
    - 형식 예시:
      ```
      - [ ] [보통] 1. 의식 수준(LoC) 검사 화면
        - [ ] UI: 터치 반응 화면 컴포넌트
        - [ ] Logic: 반응 시간 측정 로직
      ```

11. **Implementation Plan 작성:** `docs/history/` 경로 하위에 날짜 기반 파일명(`YYYYMMDD_[기능명]_implementation_plan.md`)으로 저장한다.
    - 포함 항목:
      - 목표 및 배경 설명
      - 확정된 요구사항 요약
      - User Review Required 섹션 (중요 결정/위험 사항)
      - 컴포넌트별 Proposed Changes (파일 단위로 [NEW]/[MODIFY]/[DELETE] 명시)
      - 기술 스택 및 의존성 목록
      - Verification Plan (자동화 테스트 명령어 + 수동 검증 절차)
    - 한국어로 작성한다.

## Phase 5: 승인 요청 (Review Request)

12. 작성된 Implementation Plan 파일을 `notify_user` 도구의 `PathsToReview`에 포함하여 사용자에게 리뷰를 요청한다.
13. 사용자가 수정을 요청하면 Plan을 업데이트한 뒤 다시 승인을 요청한다. 승인(LGTM)이 오면 EXECUTION 단계로 넘어간다.

---

## 주의사항
- 모든 산출물은 **한국어**로 작성한다.
- Implementation Plan과 walkthrough는 반드시 `docs/history/` 하위에 저장한다.
- 사용자에게 질문할 때는 구체적인 선택지를 제공하여 의사결정을 쉽게 만든다.
- 기존 프로젝트의 코드나 설정을 무단으로 변경하지 않는다. 변경이 필요한 경우 Plan에 명시한다.
