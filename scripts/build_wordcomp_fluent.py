"""단어이해 그림을 Fluent Emoji Flat(MS, MIT) 컬러로 전면 교체한다.

상업화를 위해 CC-BY-SA인 OpenMoji를 상업 안전한 Fluent(MIT)로 바꾼다.
Fluent에 없는 사물(냉장고·국자 등)은 단어 자체를 컬러 이모지가 있는 사물로
교체했다(qabWordPool도 함께 수정). 이미지는 기존 크림 카드(#FAF9F7)로 감싼다.

실행: python scripts/build_wordcomp_fluent.py
"""
from __future__ import annotations
import json, os, re, sys, urllib.request

sys.stdout.reconfigure(encoding="utf-8")
OUT_DIR = r"frontend/public/assets/images/wordComp"
MAP_OUT = r"scripts/_fluent_final.json"
UA = {"User-Agent": "Mozilla/5.0 icon/1.0"}
CDN = "https://api.iconify.design/fluent-emoji-flat/{name}.svg"

# 제거(컬러 이모지가 없어 교체된 5: 빗·책상·수건·냉장고 + 안 쓰기로 한 국자·모래)
#
# 고구마는 2026-08-25에 목록에서 뺐다 — Fluent에 roasted-sweet-potato가 있는데도
# 함께 지워져 있었다. 실사 사진도 있어 이름대기까지 바로 쓸 수 있다.
#
# 국자·모래는 아이콘이 없고 낱말로도 안 쓰기로 정했다(2026-08-25). 실사 사진도
# 지웠다 — 쓸 수 없는 파일을 남겨두면 다음 사람이 또 "왜 안 쓰지"를 묻는다.
REMOVED = ["comb", "desk", "ladle", "towel", "sand", "refrigerator"]
# 신규(교체 6 + 추가 10): slug -> (한국어, 범주, fluent-name)
NEW = {
    "candle": ("양초", "object", "candle"),
    "couch": ("소파", "object", "couch-and-lamp"),
    "spoon": ("숟가락", "object", "spoon"),
    "mirror": ("거울", "object", "mirror"),
    "rock": ("돌", "object", "rock"),
    "television": ("텔레비전", "object", "television"),
    "bear": ("곰", "animal", "bear"),
    "rabbit": ("토끼", "animal", "rabbit"),
    "pig": ("돼지", "animal", "pig"),
    "corn": ("옥수수", "food", "ear-of-corn"),
    "carrot": ("당근", "food", "carrot"),
    "cake": ("케이크", "food", "shortcake"),
    "cactus": ("선인장", "plant", "cactus"),
    "mushroom": ("버섯", "plant", "mushroom"),
    "house": ("집", "place", "house"),
    "truck": ("트럭", "vehicle", "delivery-truck"),
}
# 2026-08-22 추가 — 무리 범주를 넷에서 늘리기 위한 낱말(docs/ASSETS-NEEDED.md).
# 그릴 그림은 없다. 전부 Fluent에 이미 있어 이름만 대면 된다.
NEW.update({
    # 실사 사진이 이미 있어 이름대기까지 바로 쓴다.
    "sweet_potato": ("고구마", "food", "roasted-sweet-potato"),
    # object를 하위 범주로 쪼갤 때 셋을 못 채우는 통 둘을 메운다.
    "soap": ("비누", "object", "soap"),              # 욕실: 칫솔·거울과 함께 셋
    "screwdriver": ("드라이버", "object", "screwdriver"),  # 연장: 망치·사다리와 함께 셋
    # 비어 있던 범주 둘을 연다. body는 0개, person은 학생 하나뿐이었다.
    "hand": ("손", "body", "hand-with-fingers-splayed"),
    "foot": ("발", "body", "foot"),
    "eye": ("눈", "body", "eye"),
    "ear": ("귀", "body", "ear"),
    "nose": ("코", "body", "nose"),
    "mouth": ("입", "body", "mouth"),
    "doctor": ("의사", "person", "health-worker"),
    "baby": ("아기", "person", "baby"),
    "firefighter": ("소방관", "person", "firefighter"),
    # 장소 교체용(TODO-115). 도서관은 책 더미, 수영장은 헤엄치는 사람으로 그려져
    # 있는데 Fluent에 대체 아이콘이 없다(swimming-pool 404). 건물이 보이는 장소
    # 낱말을 새로 넣고, 도서관·수영장 제거는 qabWordPool 편집과 같이 한다.
    "school": ("학교", "place", "school"),
    "bank": ("은행", "place", "bank"),
})
# 기존 단어의 이름 교정/명시(오매칭 방지). slug -> fluent-name
EXPLICIT = {
    "flower": "tulip", "melon": "melon", "phone": "telephone",
    "piano": "musical-keyboard", "tree": "deciduous-tree", "turtle": "turtle",
    "orange": "tangerine",
    # 자동매칭이 애매한 것들 보정
    "juice": "cup-with-straw", "car": "automobile", "computer": "laptop",
    "book": "open-book", "bag": "backpack", "chick": "front-facing-baby-chick",
    "clock": "alarm-clock", "hat": "billed-cap", "glasses": "glasses",
    "ship": "passenger-ship", "kettle": "teapot", "notebook": "notebook",
    "key": "key", "bed": "bed", "milk": "glass-of-milk", "candy": "candy",
    "grape": "grapes", "pencil": "pencil", "guitar": "guitar", "hammer": "hammer",
    "scissors": "scissors", "knife": "kitchen-knife", "gloves": "gloves",
    "socks": "socks", "shoes": "running-shoe", "umbrella": "umbrella",
    "balloon": "balloon", "basket": "basket", "trumpet": "trumpet",
    "student": "student", "pool": "person-swimming", "library": "books",
    "pharmacy": "hospital", "mailbox": "closed-mailbox-with-lowered-flag",
    "toothbrush": "toothbrush",
}

def get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25) as r:
            return r.read()
    except Exception:
        return None

# Fluent 전체 목록(자동매칭용)
raw = get("https://api.iconify.design/collection?prefix=fluent-emoji-flat")
FN = []
data = json.loads(raw) if raw else {}
for _, a in (data.get("categories") or {}).items():
    FN += a
FN += data.get("uncategorized", [])
FSET = set(FN)

def auto_name(slug):
    head = slug.split("_")[0]
    t = slug.replace("_", "-")
    if t in FSET:
        return t
    cands = [n for n in FN if head in n.split("-")] or [n for n in FN if head in n]
    cands.sort(key=len)
    return cands[0] if cands else None

_VIEWBOX = re.compile(r'viewBox="([^"]+)"')

def wrap(svg):
    m = _VIEWBOX.search(svg)
    vb = m.group(1) if m else "0 0 32 32"
    inner = re.sub(r"^\s*<svg\b[^>]*>", "", svg, count=1, flags=re.S)
    inner = re.sub(r"</svg>\s*$", "", inner, count=1, flags=re.S)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" '
        'viewBox="0 0 300 300" role="img">\n'
        '  <rect width="300" height="300" fill="#FAF9F7" rx="16"/>\n'
        f'  <svg x="42" y="42" width="216" height="216" viewBox="{vb}">{inner}</svg>\n'
        "</svg>\n"
    )

def fetch_wrap(name):
    raw = get(CDN.format(name=name))
    if not raw:
        return None
    svg = raw.decode("utf-8", "replace")
    return wrap(svg) if svg.strip().startswith("<svg") else None

# 기준 낱말 목록.
#
# 처음 실행할 때는 손으로 만든 scripts/_wordmap.json을 썼지만 그 파일은 저장소에
# 없다(커밋된 적 없는 작업용 스크래치였다). 기준을 qabWordPool.json의 정답
# 선택지에서 읽으면 앱이 실제로 쓰는 낱말과 어긋날 수 없고, 스크립트가 다시
# 돌아간다. REMOVED에 남은 여섯은 이미 풀에 없으므로 아래 필터는 무해하다.
WORD_POOL = r"frontend/src/assets/data/qabWordPool.json"

def load_base():
    legacy = r"scripts/_wordmap.json"
    if os.path.exists(legacy):
        return json.load(open(legacy, encoding="utf-8"))
    pool = json.load(open(WORD_POOL, encoding="utf-8"))["items"]
    out = {}
    for it in pool:
        correct = next((c for c in it["choices"] if c["isCorrect"]), None)
        if not correct:
            continue
        slug = os.path.splitext(os.path.basename(correct["imageUrl"]))[0]
        out.setdefault(slug, correct["label"])
    return out

base = load_base()
final = {s: ko for s, ko in base.items() if s not in REMOVED}
for s, (ko, cat, name) in NEW.items():
    final[s] = ko

# slug -> fluent-name
namemap = {}
for slug in final:
    if slug in NEW:
        namemap[slug] = NEW[slug][2]
    elif slug in EXPLICIT:
        namemap[slug] = EXPLICIT[slug]
    else:
        namemap[slug] = auto_name(slug)

# 생성
written, failed = [], []
print("=== slug -> fluent-name (검토) ===")
for slug in sorted(final):
    name = namemap[slug]
    print(f"  {slug:16} {final[slug]:6} -> {name}")
    svg = fetch_wrap(name) if name else None
    if not svg:
        failed.append(slug); continue
    # newline="" 로 LF를 그대로 쓴다. 저장소가 LF로 고정돼 있어(.gitattributes)
    # CRLF로 쓰면 매번 작업 트리만 더러워진다.
    open(os.path.join(OUT_DIR, f"{slug}.svg"), "w", encoding="utf-8",
         newline="").write(svg)
    written.append(slug)

# 제거 슬러그 이미지 삭제
deleted = []
for s in REMOVED:
    p = os.path.join(OUT_DIR, f"{s}.svg")
    if os.path.exists(p):
        os.remove(p); deleted.append(s)

# 후속 편집용 최종 맵 저장(slug, ko, category)
cats = {}  # slug -> category (신규는 NEW, 기존은 QabItemBank과 동일 개념 — 여기선 신규만 명시)
for s, (ko, cat, name) in NEW.items():
    cats[s] = cat
json.dump({"final": final, "namemap": namemap, "new_categories": cats,
           "removed": REMOVED, "new": {s: NEW[s][0] for s in NEW}},
          open(MAP_OUT, "w", encoding="utf-8", newline=""),
          ensure_ascii=False, indent=1)

print(f"\n생성 {len(written)} / 실패 {len(failed)} {failed} / 삭제 {len(deleted)}")
print("최종 단어 수:", len(final))
print("맵 저장:", MAP_OUT)
