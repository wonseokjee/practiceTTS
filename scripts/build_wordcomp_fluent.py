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

# 제거(고구마 1 + 컬러 이모지 없어 교체된 6: 빗·책상·국자·수건·모래·냉장고)
REMOVED = ["sweet_potato", "comb", "desk", "ladle", "towel", "sand", "refrigerator"]
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

# 최종 단어 목록: 기존 68 - 제거 6 + 신규 15
base = json.load(open(r"scripts/_wordmap.json", encoding="utf-8"))
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
    open(os.path.join(OUT_DIR, f"{slug}.svg"), "w", encoding="utf-8").write(svg)
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
          open(MAP_OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

print(f"\n생성 {len(written)} / 실패 {len(failed)} {failed} / 삭제 {len(deleted)}")
print("최종 단어 수:", len(final))
print("맵 저장:", MAP_OUT)
