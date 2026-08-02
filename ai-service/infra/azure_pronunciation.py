"""Azure Speech 발음 평가(Pronunciation Assessment) 엔진 구현.

- WAV(PCM 16kHz mono) 오디오를 임시 파일로 받아 recognize_once로 채점한다.
- PronunciationAssessmentConfig(reference_text, HundredMark, Phoneme, miscue)로
  음소 단위 정확도 + 빠뜨림/덧붙임/오발음(error_type)까지 얻는다.
- 운율(prosody)은 SDK/언어가 지원하면 함께 켠다(미지원이면 조용히 생략).
- Windows에서 SDK가 WAV 핸들을 쥔 채 삭제하면 WinError 32가 나므로,
  azure_stt와 동일하게 객체 해제 → gc → 재시도 unlink 순으로 정리한다.
"""
import gc
import os
import tempfile
import time

import azure.cognitiveservices.speech as speechsdk

from interfaces.pronunciation_assessor import IPronunciationAssessor
from models.pronunciation import (
    PhonemeScore,
    PronunciationResult,
    WordScore,
)


class AzurePronunciationAssessor(IPronunciationAssessor):
    """Azure Cognitive Services Speech 기반 발음 평가 엔진."""

    def __init__(self, speech_key: str, speech_region: str) -> None:
        if not speech_key or not speech_region:
            raise ValueError("AZURE_SPEECH_KEY/AZURE_SPEECH_REGION이 설정되지 않았습니다.")
        self._key = speech_key
        self._region = speech_region

    @property
    def name(self) -> str:
        return "azure"

    def assess(
        self,
        wav_bytes: bytes,
        reference_text: str,
        lang: str,
    ) -> PronunciationResult:
        speech_config = speechsdk.SpeechConfig(
            subscription=self._key, region=self._region
        )
        speech_config.speech_recognition_language = lang

        pa_config = speechsdk.PronunciationAssessmentConfig(
            reference_text=reference_text,
            grading_system=speechsdk.PronunciationAssessmentGradingSystem.HundredMark,
            granularity=speechsdk.PronunciationAssessmentGranularity.Phoneme,
            # 실어증 환자는 목표 단어를 빠뜨리거나 다른 말을 덧붙이기 쉽다.
            # miscue를 켜야 빠뜨림(Omission)/덧붙임(Insertion)이 completeness에 반영된다.
            enable_miscue=True,
        )
        # 운율(억양·강세) 채점 — 지원 SDK에서만. 실패해도 핵심 채점은 유지.
        try:
            pa_config.enable_prosody_assessment()
        except Exception:  # noqa: BLE001 - 미지원 버전/언어면 조용히 생략
            pass

        tmp_path: str | None = None
        recognizer = None
        audio_config = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                tmp.write(wav_bytes)
                tmp_path = tmp.name

            audio_config = speechsdk.audio.AudioConfig(filename=tmp_path)
            recognizer = speechsdk.SpeechRecognizer(
                speech_config=speech_config, audio_config=audio_config
            )
            pa_config.apply_to(recognizer)

            result = recognizer.recognize_once()
        finally:
            # Windows: SDK가 WAV 파일 핸들을 놓도록 객체를 먼저 해제한 뒤 삭제한다.
            recognizer = None
            audio_config = None
            gc.collect()
            if tmp_path and os.path.exists(tmp_path):
                for _ in range(5):
                    try:
                        os.unlink(tmp_path)
                        break
                    except PermissionError:
                        time.sleep(0.1)

        if result.reason == speechsdk.ResultReason.RecognizedSpeech:
            return self._parse(result)
        if result.reason == speechsdk.ResultReason.NoMatch:
            # 발화를 인식하지 못함 — 0점 결과(상위에서 재시도/안내).
            return PronunciationResult(
                recognized_text="",
                accuracy_score=0.0,
                fluency_score=0.0,
                completeness_score=0.0,
                pronunciation_score=0.0,
                prosody_score=None,
                words=[],
            )
        # Canceled 등 — 상위에서 502로 변환하고 클라는 폴백한다.
        raise RuntimeError(f"Azure 발음 평가 실패: reason={result.reason}")

    def _parse(
        self, result: speechsdk.SpeechRecognitionResult
    ) -> PronunciationResult:
        """PronunciationAssessmentResult에서 점수/단어/음소를 파싱한다."""
        pa = speechsdk.PronunciationAssessmentResult(result)

        words: list[WordScore] = []
        for w in pa.words or []:
            phonemes = [
                PhonemeScore(
                    phoneme=p.phoneme,
                    accuracy=float(getattr(p, "accuracy_score", 0.0) or 0.0),
                )
                for p in (getattr(w, "phonemes", None) or [])
            ]
            words.append(
                WordScore(
                    word=w.word,
                    accuracy=float(getattr(w, "accuracy_score", 0.0) or 0.0),
                    error_type=getattr(w, "error_type", "None") or "None",
                    phonemes=phonemes,
                )
            )

        # prosody_score는 지원 버전에서만 존재. 없거나 None이면 None 유지.
        prosody = getattr(pa, "prosody_score", None)
        prosody_val = float(prosody) if prosody is not None else None

        return PronunciationResult(
            recognized_text=result.text or "",
            accuracy_score=float(pa.accuracy_score or 0.0),
            fluency_score=float(pa.fluency_score or 0.0),
            completeness_score=float(pa.completeness_score or 0.0),
            pronunciation_score=float(pa.pronunciation_score or 0.0),
            prosody_score=prosody_val,
            words=words,
        )
