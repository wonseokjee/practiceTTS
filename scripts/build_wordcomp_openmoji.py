"""단어이해(wordComp) 그림을 OpenMoji 픽토그램으로 교체한다.

기존 자동생성 placeholder SVG가 조악해, 통제된 픽토그램 스타일은 유지하되
품질을 올리기 위해 OpenMoji(오픈라이선스, 균일 스타일)로 바꾼다.

- slug → 이모지 코드포인트가 '정확히' 맞는 것만 교체(약국·국자·척추 등 부적합
  대응은 검사 타당도를 해치므로 기존 placeholder 유지).
- 파일명은 그대로 두어(<slug>.svg) 앱 코드 변경이 필요 없다.
- 기존 크림 카드 배경(#FAF9F7, rx16)에 OpenMoji를 여백 두고 중앙 배치해
  교체본과 유지본의 시각 일관성을 지킨다(잘림 없음).

OpenMoji: CC BY-SA 4.0 — 출처 표기 필요(ATTRIBUTION.md 생성).
실행: python scripts/build_wordcomp_openmoji.py
"""
from __future__ import annotations

import re
import sys
import urllib.request
from pathlib import Path

CDN = "https://cdn.jsdelivr.net/npm/openmoji@15.0.0/color/svg/{code}.svg"
OUT = Path("frontend/public/assets/images/wordComp")

# slug → OpenMoji 코드포인트(대문자 hex, ZWJ은 하이픈). 정확 매칭만 등재.
MAP = {
    "airplane": "2708", "apple": "1F34E", "bag": "1F45C", "balloon": "1F388",
    "banana": "1F34C", "basket": "1F9FA", "bed": "1F6CF", "bicycle": "1F6B2",
    "book": "1F4D6", "bread": "1F35E", "bus": "1F68C", "butterfly": "1F98B",
    "candy": "1F36C", "car": "1F697", "cat": "1F431", "chair": "1FA91",
    "chick": "1F424", "clock": "23F0", "comb": "1FAAE", "computer": "1F4BB",
    "dog": "1F436", "elephant": "1F418", "flower": "1F338", "glasses": "1F453",
    "gloves": "1F9E4", "grape": "1F347", "guitar": "1F3B8", "hammer": "1F528",
    "hat": "1F9E2", "hospital": "1F3E5", "juice": "1F9C3", "kettle": "1FAD6",
    "key": "1F511", "knife": "1F52A", "ladder": "1FA9C", "lion": "1F981",
    "mailbox": "1F4EB", "melon": "1F348", "milk": "1F95B", "mirror": "1FA9E",
    "notebook": "1F4D3", "orange": "1F34A", "pear": "1F350", "pencil": "270F",
    "phone": "1F4F1", "piano": "1F3B9", "pot": "1F372", "school": "1F3EB",
    "scissors": "2702", "ship": "1F6A2", "shoes": "1F45F", "soap": "1F9FC",
    "socks": "1F9E6", "strawberry": "1F353", "student": "1F9D1-200D-1F393",
    "sweet_potato": "1F360", "tiger": "1F42F", "tomato": "1F345",
    "toothbrush": "1FAA5", "train": "1F682", "tree": "1F333",
    "trumpet": "1F3BA", "turtle": "1F422", "umbrella": "2602",
    "watermelon": "1F349", "whale": "1F433",
}

# 대응 이모지가 부적합해 기존 placeholder를 유지하는 slug(참고용 주석).
KEEP = {"blanket", "desk", "ladle", "library", "pharmacy", "pool",
        "refrigerator", "rice_cooker", "sand", "spine", "toothpaste",
        "towel", "washing_machine"}

_VIEWBOX = re.compile(r'viewBox="([^"]+)"')


def _fetch(code: str) -> str | None:
    url = CDN.format(code=code)
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            if r.status != 200:
                return None
            return r.read().decode("utf-8")
    except Exception:  # noqa: BLE001
        return None


def _wrap(openmoji_svg: str) -> str | None:
    """OpenMoji SVG를 크림 카드(300x300) 중앙에 여백 두고 감싼다."""
    m = _VIEWBOX.search(openmoji_svg)
    vb = m.group(1) if m else "0 0 72 72"
    # 바깥 <svg ...> 여는 태그와 닫는 </svg> 제거 → 내부 그래픽만 추출
    inner = re.sub(r"^\s*<svg\b[^>]*>", "", openmoji_svg, count=1, flags=re.S)
    inner = re.sub(r"</svg>\s*$", "", inner, count=1, flags=re.S)
    if not inner.strip():
        return None
    # 300x300 중 30 여백 → 240 영역에 배치
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" '
        'viewBox="0 0 300 300" role="img">\n'
        '  <rect width="300" height="300" fill="#FAF9F7" rx="16"/>\n'
        f'  <svg x="30" y="30" width="240" height="240" viewBox="{vb}">'
        f"{inner}</svg>\n"
        "</svg>\n"
    )


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001
            pass
    if not OUT.exists():
        print(f"[오류] 폴더 없음: {OUT}", file=sys.stderr)
        return 1
    replaced, failed = [], []
    for slug, code in MAP.items():
        target = OUT / f"{slug}.svg"
        if not target.exists():
            failed.append((slug, "대상 파일 없음"))
            continue
        raw = _fetch(code)
        if not raw:
            failed.append((slug, f"다운로드 실패({code})"))
            continue
        wrapped = _wrap(raw)
        if not wrapped:
            failed.append((slug, "SVG 파싱 실패"))
            continue
        target.write_text(wrapped, encoding="utf-8")
        replaced.append(slug)

    # 출처 표기(CC BY-SA 4.0)
    (OUT / "ATTRIBUTION.md").write_text(
        "# 단어이해 그림 출처\n\n"
        "이 폴더의 다수 픽토그램은 **OpenMoji** (https://openmoji.org) 를 사용합니다.\n"
        "라이선스: **CC BY-SA 4.0** (https://creativecommons.org/licenses/by-sa/4.0/)\n\n"
        "OpenMoji가 없어 자체 제작 placeholder를 유지한 항목: "
        + ", ".join(sorted(KEEP)) + "\n",
        encoding="utf-8",
    )

    print(f"✅ 교체 {len(replaced)}개 / 유지(placeholder) {len(KEEP)}개 / 실패 {len(failed)}개")
    if failed:
        print("실패 목록:")
        for slug, why in failed:
            print(f"  - {slug}: {why}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
