# LLM 없이 구현 가능한 QAB 하위검사 구체화 계획

> 작성일: 2026-02-23
> 최종 수정: 2026-03-27 (디자인 문서 결정 사항 반영)
> 참조 문서: `docs/history/implementation_plan.md`, `~/.gstack/projects/practicetts/wsji9-unknown-design-20260327-201318.md`

---

## 개요

8가지 QAB 하위검사 중 LLM(대형 언어 모델) 없이 앱으로 구현 가능한 검사를 선별하고, 각 검사의 UI/UX, 채점 로직, 데이터 구조를 구체화한다.

> **LLM vs STT 구분**
> - **LLM (Large Language Model):** GPT, Claude 등 문맥 이해·생성 모델 → 제외 대상
> - **STT (Speech-to-Text):** Web Speech API, Whisper 등 음성→텍스트 변환 → 허용 (LLM 아님)

---

## 검사별 LLM 의존도 분류

| # | 검사명 | LLM 필요 여부 | STT 필요 여부 | 구현 가능 여부 |
|---|--------|:-------------:|:-------------:|:--------------:|
| 1 | 의식 수준 (Level of Consciousness) | ❌ 불필요 | ❌ 불필요 | ✅ 바로 구현 가능 |
| 2 | 연결 발화 (Connected Speech) | ✅ **필요** (착어증·문법 분석) | ✅ 필요 | ⛔ LLM 의존 |
| 3 | 단어 이해 (Word Comprehension) | ❌ 불필요 | ❌ 불필요 | ✅ 바로 구현 가능 |
| 4 | 문장 이해 (Sentence Comprehension) | ❌ 불필요 | ❌ 불필요 | ✅ 바로 구현 가능 |
| 5 | 그림 이름대기 (Picture Naming) | ❌ 불필요 | ✅ 필요 | ✅ 규칙 기반으로 구현 가능 |
| 6 | 따라말하기 (Repetition) | ❌ 불필요 | ✅ 필요 | ✅ 규칙 기반으로 구현 가능 |
| 7 | 소리 내어 읽기 (Reading Aloud) | ❌ 불필요 | ✅ 필요 | ✅ 규칙 기반으로 구현 가능 |
| 8 | 말운동 프로그래밍 (Motor Speech) | ❌ 불필요 | ❌ 불필요 | ✅ 오디오 신호 처리로 구현 가능 |

> **결론:** 8개 중 **7개**를 LLM 없이 구현 가능. 단, 검사 2(연결 발화)는 LLM 없이 정밀 분석 불가.

---

## 구체화된 구현 계획

---

### ✅ 검사 1: 의식 수준 (Level of Consciousness)

#### 목적
환자의 각성 상태 및 검사 참여 가능 여부 평가. 검사의 첫 관문으로 이후 검사 진행 여부를 결정.

#### UI/UX 상세

```
┌─────────────────────────────────┐
│                                 │
│   🔊 "화면을 눌러주세요"         │  ← 음성 안내 자동 재생 (TTS)
│        (오디오 재생 중)          │
│                                 │
│   ┌─────────────────────────┐   │
│   │                         │   │
│   │      여기를 눌러         │   │  ← 전체 화면의 70% 차지하는 대형 버튼
│   │        주세요           │   │
│   │                         │   │
│   └─────────────────────────┘   │
│                                 │
│   ⏱ 남은 시간: 10초             │  ← 진행 바 (Progress Bar)
└─────────────────────────────────┘
```

#### 측정 항목
| 항목 | 설명 | 단위 |
|------|------|------|
| 반응 지연 시간 (Latency) | 지시음 종료 → 첫 터치까지 시간 | ms |
| 터치 성공 여부 | 10초 이내 버튼 터치 완료 여부 | boolean |
| 터치 정확성 | 버튼 영역 내 터치 여부 | boolean |
| 시도 횟수 | 최대 3회 반복 시도 | count |

#### 채점 로직
```
latency ≤ 3,000ms   → 3점 (정상)
latency ≤ 6,000ms   → 2점 (경도 지연)
latency ≤ 10,000ms  → 1점 (중도 지연)
무반응 (10,000ms 초과) → 0점
```

#### 데이터 구조
```typescript
interface LocResult {
  trialNumber: number;       // 시도 회차 (1~3)
  audioEndTime: number;      // 음성 안내 종료 timestamp (ms)
  touchTime: number | null;  // 터치 발생 timestamp (ms), 무반응이면 null
  latency: number | null;    // audioEndTime - touchTime (ms)
  touchInBounds: boolean;    // 버튼 영역 내 터치 여부
  score: 0 | 1 | 2 | 3;     // 채점 결과
}
```

#### 화면 흐름
`시작 화면 → 음성 안내 재생 → 대기(타이머 카운트다운) → 터치 감지 → 결과 기록 → [최대 3회 반복] → 다음 검사`

---

### ✅ 검사 3: 단어 이해 (Word Comprehension)

#### 목적
청각적으로 제시된 단어를 듣고 해당 이미지를 선택하여 청각적 단어 인지 능력 평가.

#### UI/UX 상세

```
┌─────────────────────────────────┐
│  🔊 단어 듣기    [다시 듣기]     │  ← 목표 단어 음성 재생 버튼
├─────────────────────────────────┤
│                                 │
│  ┌──────────┐  ┌──────────┐    │
│  │  [사과]  │  │  [바나나] │    │  ← 2x2 그리드 이미지 선택지
│  │  (이미지)│  │  (이미지) │    │
│  └──────────┘  └──────────┘    │
│  ┌──────────┐  ┌──────────┐    │
│  │  [포도]  │  │  [딸기]  │    │
│  │  (이미지)│  │  (이미지) │    │
│  └──────────┘  └──────────┘    │
│                                 │
└─────────────────────────────────┘
```

#### 자극 세트 구성
- 총 문항 수: 20문항 (QAB 원본 기준)
- 선택지: 4개 이미지 (정답 1개 + 의미적/음운적으로 유사한 오답 3개)
- 오답 구성 전략:
  - **의미 착어 오답:** 같은 범주의 다른 단어 (예: "사과" → 오답: "배", "바나나")
  - **음운 착어 오답:** 유사한 발음의 다른 단어 (예: "사과" → 오답: "사탕")
  - **무관 오답:** 전혀 관련 없는 단어

#### 측정 항목
| 항목 | 설명 | 단위 |
|------|------|------|
| 정답 여부 | 선택한 이미지 == 목표 단어 | boolean |
| 반응 시간 | 음성 재생 종료 → 이미지 선택까지 | ms |
| 재청취 횟수 | "다시 듣기" 버튼 클릭 횟수 | count |
| 오답 유형 | 의미 착어 / 음운 착어 / 무관 오답 선택 | enum |

#### 채점 로직
```
문항당: 정답 = 1점, 오답 = 0점
총점 = 정답 수 / 전체 문항 수 × 100 (%)
오답 패턴 분석: 의미 착어형 vs 음운 착어형 오답 비율 집계
```

#### 데이터 구조
```typescript
type DistractorType = 'semantic' | 'phonemic' | 'unrelated';

interface WordComprehensionItem {
  itemId: string;             // 문항 ID
  targetWord: string;         // 목표 단어
  targetAudioUrl: string;     // 목표 단어 음성 파일 경로
  choices: {
    imageUrl: string;
    word: string;
    isCorrect: boolean;
    distractorType?: DistractorType;
  }[];
}

interface WordComprehensionResult {
  itemId: string;
  selectedWord: string;
  isCorrect: boolean;
  reactionTimeMs: number;
  replayCount: number;        // 다시 듣기 횟수
  distractorTypeSelected?: DistractorType;
}
```

---

### ✅ 검사 4: 문장 이해 (Sentence Comprehension)

#### 목적
복잡한 구문(수동태, 관계절 등)의 문장을 듣고 해당 장면의 그림을 선택하여 문법적 이해력 평가.

#### UI/UX 상세

```
┌─────────────────────────────────┐
│  🔊 "개가 고양이를 쫓고 있어요"  │  ← 재생 중인 문장 표시 + 오디오
│         [다시 듣기]              │
├─────────────────────────────────┤
│                                 │
│  ┌─────────────────────────┐    │
│  │    [그림 A - 정답]       │    │  ← 상단 큰 이미지
│  │  (개가 고양이를 쫓는 장면)│    │
│  └─────────────────────────┘    │
│                                 │
│  ┌─────────────────────────┐    │
│  │    [그림 B - 오답]       │    │  ← 하단 오답 이미지
│  │  (고양이가 개를 쫓는 장면)│    │    (의미 역전된 장면)
│  └─────────────────────────┘    │
└─────────────────────────────────┘
```

#### 자극 세트 구성
- 총 문항 수: 10문항
- 구문 유형 (예시):
  - 능동/수동 전환: "A가 B를 쫓는다" vs "A가 B에게 쫓긴다"
  - 관계절: "선생님이 안은 아이" vs "선생님을 안은 아이"
- 선택지: 2개 이미지 (정답 장면 + 의미가 역전된 오답 장면)

#### 채점 로직
```
문항당: 정답 = 1점, 오답 = 0점
총점 = 정답 수 / 10 × 100 (%)
구문 유형별 정답률 별도 집계 (능동/수동, 관계절 등)
```

#### 데이터 구조
```typescript
type SentenceType = 'active-passive' | 'relative-clause' | 'embedded-clause';

interface SentenceComprehensionItem {
  itemId: string;
  sentence: string;
  sentenceAudioUrl: string;
  sentenceType: SentenceType;
  choices: {
    imageUrl: string;
    isCorrect: boolean;
  }[];
}

interface SentenceComprehensionResult {
  itemId: string;
  selectedImageIndex: number;  // 0 or 1
  isCorrect: boolean;
  reactionTimeMs: number;
  replayCount: number;
}
```

---

### ✅ 검사 5: 그림 이름대기 (Picture Naming)

#### 목적
그림을 보고 이름을 말하여 어휘 인출 및 음운 산출 능력 평가.

#### UI/UX 상세

```
┌─────────────────────────────────┐
│  ● 녹음 중... (2.3초)           │  ← VAD 감지 후 자동 시작
│  ════════════════════           │  ← 음성 파형 시각화
├─────────────────────────────────┤
│                                 │
│         🍎                      │  ← 그림 중앙 표시 (고해상도)
│        [사과 이미지]             │
│                                 │
├─────────────────────────────────┤
│  💡 힌트: 첫 소리는 "사"...     │  ← 치료사 모드에서만 표시
└─────────────────────────────────┘
```

#### 기술 구현: LLM 없는 채점 알고리즘

**STT 결과 → 규칙 기반 채점**

```
STT 출력 텍스트
       ↓
1. 정확 일치 검사 → 일치하면 → 만점 (2점)
       ↓ 불일치
2. Levenshtein 거리 계산
   (STT결과 vs 정답 단어)
       ↓
   distance ≤ 1   → 음운 착어 (1점) - 예: "사과" → "사화"
   distance ≤ 2   → 음운 착어 경계 (1점)
       ↓ 초과
3. 의미 카테고리 DB 조회
   (STT 결과가 같은 의미 범주에 속하는지)
   포함됨 → 의미 착어 (0점, 별도 마킹)
   미포함 → 신조어/무반응 (0점)
```

#### 착어 분류 기준
| 유형 | 기준 | 예시 | 점수 |
|------|------|------|------|
| 정반응 | STT == 정답 | "사과" → "사과" | 2점 |
| 음운 착어 | Levenshtein ≤ 2 | "사과" → "사화" | 1점 |
| 의미 착어 | 같은 의미 범주 | "사과" → "배" (과일류) | 0점 |
| 신조어 | 분류 불가 | "사과" → "싸꽈" | 0점 |
| 무반응 | STT 결과 없음 (3초 침묵) | - | 0점 |

#### 의미 범주 DB 예시 구조
```json
{
  "과일": ["사과", "배", "바나나", "딸기", "포도", "오렌지"],
  "동물": ["개", "고양이", "새", "물고기", "말"],
  "가구": ["의자", "책상", "침대", "소파", "옷장"]
}
```

#### 측정 항목
| 항목 | 설명 |
|------|------|
| VAD 감지 지연 | 그림 제시 → 첫 발화 시작까지 (ms) |
| 발화 지속 시간 | 발화 시작 → 종료까지 (ms) |
| STT 변환 텍스트 | 원본 보관 |
| 채점 결과 | 정반응/음운착어/의미착어/신조어/무반응 |

---

### ✅ 검사 6: 따라말하기 (Repetition)

#### 목적
들은 단어/문장을 그대로 따라 말하여 음운 부호화 및 청각-운동 통합 능력 평가.

#### UI/UX 상세

```
┌─────────────────────────────────┐
│  STEP 1: 듣기                   │
│  ┌─────────────────────────┐   │
│  │  🔊 재생 중...           │   │  ← 자극 음성 재생
│  │  ════════════           │   │
│  └─────────────────────────┘   │
│                                 │
│  STEP 2: 따라말하기             │
│  ┌─────────────────────────┐   │
│  │  ● 녹음 대기 중...       │   │  ← 음성 재생 종료 후 자동 전환
│  │  [▓▓▓▓▓░░░░░] 3초       │   │  ← 녹음 대기 타이머
│  └─────────────────────────┘   │
└─────────────────────────────────┘
```

#### 채점 알고리즘: WER (Word Error Rate)

```python
# 단어 수준 정확도
from difflib import SequenceMatcher

def calculate_wer(reference: str, hypothesis: str) -> float:
    """Word Error Rate 계산"""
    ref_words = reference.split()
    hyp_words = hypothesis.split()

    matcher = SequenceMatcher(None, ref_words, hyp_words)

    substitutions = 0
    deletions = 0
    insertions = 0

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == 'replace':
            substitutions += max(i2-i1, j2-j1)
        elif tag == 'delete':
            deletions += i2-i1
        elif tag == 'insert':
            insertions += j2-j1

    wer = (substitutions + deletions + insertions) / len(ref_words)
    return min(wer, 1.0)  # 최대 1.0 (100%)

def score_repetition(wer: float) -> int:
    if wer == 0:      return 2  # 완벽 반복
    elif wer <= 0.25: return 1  # 경미한 오류
    else:             return 0  # 심각한 오류
```

#### 자극 세트 구성
- 단어 레벨: 단음절 → 다음절 순서로 난이도 증가
- 문장 레벨: 짧은 문장 → 복잡한 문장
- 총 20문항 (단어 10 + 문장 10)

#### 데이터 구조
```typescript
interface RepetitionResult {
  itemId: string;
  stimulusText: string;      // 자극 텍스트 (정답)
  sttOutput: string;         // STT 변환 결과
  wer: number;               // Word Error Rate (0~1)
  cer: number;               // Character Error Rate (0~1)
  score: 0 | 1 | 2;
  stimulusEndTime: number;   // 자극 재생 종료 timestamp
  speechStartTime: number;   // 발화 시작 timestamp (VAD)
  reactionDelayMs: number;   // 지연 시간
}
```

---

### ✅ 검사 7: 소리 내어 읽기 (Reading Aloud)

#### 목적
화면에 표시된 텍스트를 소리 내어 읽어 자소-음소 변환 및 시각적 언어 처리 능력 평가.

#### UI/UX 상세

```
┌─────────────────────────────────┐
│                                 │
│                                 │
│   "오늘 날씨가 맑고              │
│    바람이 불었습니다."           │  ← 큰 폰트 (최소 32pt), 중앙 정렬
│                                 │
│                                 │
├─────────────────────────────────┤
│  ● 읽기 시작하면 자동 녹음됩니다 │  ← 안내 문구
│  [▓▓▓▓▓▓▓░░░] 경과: 3.2초      │  ← 전체 소요 시간 카운터
└─────────────────────────────────┘
```

#### 텍스트 표시 규칙
- 폰트 크기: 최소 32px (접근성 고려)
- 줄 간격: 1.8 이상
- 배경: 흰색, 텍스트: 검정 (고대비)
- 한 화면에 한 문장만 표시

#### 채점 알고리즘
```python
def score_reading(stimulus: str, stt_output: str) -> dict:
    """
    정확도: WER 기반
    지연 시간: 화면 표시 → VAD 감지까지
    """
    wer = calculate_wer(stimulus, stt_output)

    return {
        'accuracy_score': 2 if wer == 0 else (1 if wer <= 0.2 else 0),
        'wer': wer,
        'fluency_note': 'normal' if latency_ms < 3000 else 'delayed'
    }
```

#### 추가 측정 항목
| 항목 | 설명 |
|------|------|
| 초기 발화 지연 | 텍스트 표시 → VAD 감지 (ms) |
| 읽기 속도 | 총 단어 수 / 소요 시간 (WPM) |
| 정확도 | WER 기반 |
| 자가 수정 | 읽다 멈추고 다시 읽는 패턴 감지 (음성 분절 분석) |

---

### ✅ 검사 8: 말운동 프로그래밍 (Motor Speech)

#### 목적
"퍼-터-커" 교대 운동을 통해 구어 산출을 위한 운동 계획 및 실행 능력 평가. LLM 전혀 불필요, 오디오 신호 처리만 사용.

#### UI/UX 상세

```
┌─────────────────────────────────┐
│  📹 시범 영상                   │
│  ┌─────────────────────────┐   │
│  │  입 모양 애니메이션      │   │  ← "퍼-터-커" 입모양 GIF/영상
│  │  퍼 → 터 → 커           │   │
│  └─────────────────────────┘   │
├─────────────────────────────────┤
│  이제 따라해보세요!              │
│  ● 녹음 중...                  │
│                                 │
│  감지된 박자: ▌ ▌ ▌ ▌ ▌        │  ← 실시간 음절 감지 표시
│  속도: 4.2 음절/초              │
└─────────────────────────────────┘
```

#### 핵심 기술: Web Audio API 기반 DDK 측정

```javascript
// DDK (Diadochokinetic) Rate 측정
class DDKAnalyzer {
  constructor(audioContext) {
    this.audioContext = audioContext;
    this.analyser = audioContext.createAnalyser();
    this.analyser.fftSize = 2048;
  }

  detectSyllableOnsets(audioBuffer) {
    /**
     * 에너지 기반 음절 경계 감지
     * 1. 단기 에너지(Short-Term Energy) 계산
     * 2. 에너지 피크(Peak) 감지 → 음절 시작점
     * 3. 피크 간격으로 DDK Rate 계산
     */
    const frameSize = 512;
    const hopSize = 256;
    const energies = [];

    // 프레임별 에너지 계산
    for (let i = 0; i < audioBuffer.length - frameSize; i += hopSize) {
      const frame = audioBuffer.slice(i, i + frameSize);
      const energy = frame.reduce((sum, x) => sum + x * x, 0) / frameSize;
      energies.push(energy);
    }

    // 피크 감지 (임계값 기반)
    const threshold = Math.max(...energies) * 0.3;
    const peaks = this.findPeaks(energies, threshold, minDistance=10);

    return peaks;
  }

  calculateDDKRate(syllableOnsets, durationSec) {
    return syllableOnsets.length / durationSec;  // 음절/초
  }

  calculateRegularityIndex(syllableOnsets) {
    /**
     * 박자 규칙성: 음절 간격의 표준편차
     * 낮을수록 규칙적 → 정상
     */
    const intervals = [];
    for (let i = 1; i < syllableOnsets.length; i++) {
      intervals.push(syllableOnsets[i] - syllableOnsets[i-1]);
    }
    const mean = intervals.reduce((a, b) => a + b) / intervals.length;
    const variance = intervals.reduce((s, x) => s + (x-mean)**2, 0) / intervals.length;
    return Math.sqrt(variance);  // 표준편차 (낮을수록 좋음)
  }
}
```

#### 채점 기준

| 지표 | 정상 범위 | 이상 신호 |
|------|----------|----------|
| DDK Rate (퍼-터-커) | 5~8 음절/초 | < 4 음절/초 |
| 규칙성 지수 (표준편차) | ≤ 30ms | > 50ms |
| 녹음 지속 시간 | 5~10초 | < 3초 |

#### 채점 로직
```
DDKRate ≥ 5 AND 규칙성지수 ≤ 30ms → 2점 (정상)
DDKRate ≥ 3 AND 규칙성지수 ≤ 50ms → 1점 (경도 장애)
그 외 → 0점 (중도 장애)
```

#### 데이터 구조
```typescript
interface MotorSpeechResult {
  task: 'pa' | 'ta' | 'ka' | 'pataka';  // 과제 유형
  durationSec: number;                   // 녹음 지속 시간
  syllableCount: number;                 // 감지된 음절 수
  ddkRate: number;                       // 음절/초
  regularityIndexMs: number;             // 음절 간격 표준편차
  syllableOnsets: number[];              // 각 음절 시작 timestamp (ms)
  score: 0 | 1 | 2;
}
```

---

## 공통 기술 스택 (LLM 제외)

| 역할 | 기술 | 용도 |
|------|------|------|
| STT | **Azure STT (ko-KR)** | 음성→텍스트 — 구음장애 발화에 robust (Web Speech API 대비 우선 선택) |
| VAD | Web Audio API (에너지 임계값) | 발화 시작 감지 |
| 오디오 처리 | Web Audio API (브라우저) / librosa (서버) | 신호 분석 |
| 문자열 비교 | Levenshtein 거리 (JS: `fastest-levenshtein`) | 착어 분류 |
| WER 계산 | `difflib` (Python) / 자체 구현 (JS) | 따라말하기·읽기 채점 |
| 타이밍 측정 | `performance.now()` | 반응 시간 (ms 정밀도) |
| TTS | **Azure TTS (ko-KR-SunHiNeural)** | 자극 음성 재생 (PostgreSQL 캐시 우선) |

> **STT 신뢰도 폴백:** Azure STT confidence score 낮을 경우 "잘 들리지 않았어요, 한번 더" 자동 재시도 (최대 2회). 2회 실패 시 보호자 알림 + 수동 건너뜀.

---

## Proposed Changes (파일 구조)

```
src/
├── assessments/
│   ├── loc/              [NEW] 검사 1: 의식 수준
│   │   ├── LocScreen.tsx
│   │   └── locScoring.ts
│   ├── wordComp/         [NEW] 검사 3: 단어 이해
│   │   ├── WordCompScreen.tsx
│   │   └── wordCompScoring.ts
│   ├── sentComp/         [NEW] 검사 4: 문장 이해
│   │   ├── SentCompScreen.tsx
│   │   └── sentCompScoring.ts
│   ├── pictureNaming/    [NEW] 검사 5: 그림 이름대기
│   │   ├── PictureNamingScreen.tsx
│   │   ├── paraphasiaClassifier.ts   ← Levenshtein 기반
│   │   └── semanticCategoryDB.json   ← 의미 범주 DB
│   ├── repetition/       [NEW] 검사 6: 따라말하기
│   │   ├── RepetitionScreen.tsx
│   │   └── werCalculator.ts
│   ├── readingAloud/     [NEW] 검사 7: 소리 내어 읽기
│   │   ├── ReadingAloudScreen.tsx
│   │   └── readingScoring.ts
│   └── motorSpeech/      [NEW] 검사 8: 말운동 프로그래밍
│       ├── MotorSpeechScreen.tsx
│       └── ddkAnalyzer.ts            ← Web Audio API 기반
├── shared/
│   ├── hooks/
│   │   ├── useAudioRecorder.ts       [NEW] 마이크 녹음 공통 훅
│   │   ├── useVAD.ts                 [NEW] Voice Activity Detection
│   │   └── useTimer.ts               [NEW] 반응 시간 측정
│   └── utils/
│       └── levenshtein.ts            [NEW] 편집 거리 계산
└── assets/
    ├── audio/            [NEW] 자극 음성 파일
    └── images/           [NEW] 검사용 이미지 에셋
```

---

## 결정 사항 (2026-03-27 확정)

> **디자인 문서(`wsji9-unknown-design-20260327-201318.md`) 기준으로 아래 항목이 확정되었다.**

| # | 항목 | 결정 | 비고 |
|---|------|------|------|
| 1 | **STT 엔진** | ✅ **Azure STT (ko-KR)** | 구음장애(dysarthria) 발화에 Web Speech API보다 robust. 신뢰도 점수 기반 재시도 로직 필수 |
| 2 | **플랫폼** | ✅ **웹 앱 우선 (React SPA)** | 설치 불필요 → 고령 보호자 접근성. HTTPS 필수 (마이크 권한). PWA/네이티브는 인터뷰 이후 결정 |
| 3 | **검사 2(연결 발화)** | ✅ **LLM 단계로 보류** | 착어증·문법 분석은 LLM 없이 정밀 채점 불가. 현 단계에서 제외, 향후 FastAPI LLM 서비스 구축 시 추가 |
| 4 | **자극 에셋** | ⚠️ **미결 — 검증 필요** | 표준 QAB 이미지 세트 저작권 확인 필요. 불가 시 자체 일러스트 + Azure TTS 사전 생성 |

> **검사 4(자극 에셋)**는 빌드 전 반드시 해결해야 할 블로커다. 검증 없이 코드 작성 시작 금지.
