"""Azure Speech STT 엔진 구현.

- WAV(PCM 16kHz mono) 오디오를 임시 파일로 받아 recognize_once로 인식한다.
- PhraseListGrammar로 정답 후보(candidates)를 부스팅해 병리 발화 인식률을 높인다.
- Detailed 출력으로 confidence/n-best를 파싱한다.
"""
import gc
import json
import os
import tempfile
import time

import azure.cognitiveservices.speech as speechsdk

from interfaces.stt_engine import ISttEngine
from models.stt import SttNBestItem, SttResult


class AzureSttEngine(ISttEngine):
    """Azure Cognitive Services Speech 기반 STT 엔진."""

    def __init__(self, speech_key: str, speech_region: str) -> None:
        if not speech_key or not speech_region:
            raise ValueError("AZURE_SPEECH_KEY/AZURE_SPEECH_REGION이 설정되지 않았습니다.")
        self._key = speech_key
        self._region = speech_region

    @property
    def name(self) -> str:
        return "azure"

    def recognize(
        self,
        wav_bytes: bytes,
        lang: str,
        candidates: list[str],
    ) -> SttResult:
        speech_config = speechsdk.SpeechConfig(
            subscription=self._key, region=self._region
        )
        speech_config.speech_recognition_language = lang
        # confidence/n-best를 얻기 위해 상세 출력 포맷 사용.
        speech_config.output_format = speechsdk.OutputFormat.Detailed

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

            # 정답 후보 phrase hint(제약 인식) — 병리 발화 인식률 향상.
            if candidates:
                grammar = speechsdk.PhraseListGrammar.from_recognizer(recognizer)
                for phrase in candidates:
                    if phrase:
                        grammar.addPhrase(phrase)

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
            # 발화를 인식하지 못함 — 빈 결과(상위에서 폴백/재시도 안내).
            return SttResult(transcript="", confidence=0.0, nbest=[])
        # Canceled 등 — 상위에서 502로 변환하고 클라는 폴백한다.
        raise RuntimeError(f"Azure STT 인식 실패: reason={result.reason}")

    def _parse(self, result: speechsdk.SpeechRecognitionResult) -> SttResult:
        """Detailed JSON에서 transcript/confidence/n-best를 파싱한다."""
        transcript = result.text or ""
        confidence = 0.0
        nbest: list[SttNBestItem] = []
        try:
            detailed = json.loads(result.json)
            for item in detailed.get("NBest", []):
                nbest.append(
                    SttNBestItem(
                        text=item.get("Display", item.get("Lexical", "")),
                        confidence=float(item.get("Confidence", 0.0)),
                    )
                )
            if nbest:
                confidence = nbest[0].confidence
                if not transcript:
                    transcript = nbest[0].text
        except (ValueError, KeyError, TypeError):
            # 상세 파싱 실패 시에도 transcript(text)는 유지한다.
            pass
        return SttResult(transcript=transcript, confidence=confidence, nbest=nbest)
