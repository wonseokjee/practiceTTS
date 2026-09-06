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
# post_office·department_store는 2026-09-02에 넣었다가 같은 날 물렸다(위 주석).
# 낱말 풀 밖이고 다른 화면도 안 쓰므로 파일째 지운다.
REMOVED = ["comb", "desk", "ladle", "towel", "sand", "refrigerator",
           "post_office", "department_store"]
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
# 2026-09-02 — TODO-115를 닫는다. 도서관·수영장은 아이콘이 장소로 안 보여
# (책 더미·헤엄치는 사람) 이름대기 전용으로 옮겼고, 건물이 보이는 장소 낱말을
# 대신 넣는다. **library·pool을 REMOVED에 넣으면 안 된다** — 표준 검사
# (wordComprehensionItems.json)와 발화 자극이 같은 SVG를 아직 쓴다. 지우면 그
# 화면이 깨진 이미지로 뜬다. hospital도 같은 이유로 남긴다.
#
# 처음에 넣은 우체국·백화점은 **같은 날 물렸다.** 건물이기는 한데 *어떤* 건물인지가
# 안 보였다 — 우체국은 유럽식 나팔 표지고 백화점은 그냥 사무실 빌딩이다. 소유자
# 확인(2026-09-02). 기호를 배워야 읽히는 그림은 이 검사에서 낱말 그림이 아니다.
#
# 교회(종탑 십자가)·공장(굴뚝)은 실루엣만으로 갈린다. 호텔·편의점도 후보였지만
# 아이콘에 로마자 H·24 H가 박혀 있어 뺐다 — "그림에 글자가 없다"(wordCompAssets)에
# 걸리고, 읽어서 맞히면 검사가 무효다.
NEW.update({
    "church": ("교회", "place", "church"),
    "factory": ("공장", "place", "factory"),
})
# 2026-09-02(같은 날 여섯 번째) — 일곱 번째 자리를 소방서·경찰서 → 성(castle)으로
# 갈았다. Fluent에 소방서·경찰서 건물이 없어(소방차·경찰관 이모지뿐) 직접
# 그렸는데, 다른 다섯이 전부 Fluent 원본이라 화풍·완성도가 확연히 어긋났다
# (하나는 완성된 삽화, 하나는 단순 도형 — 나란히 놓으면 바로 티가 난다).
# 손그림 품질을 올리는 대신 Fluent 안에서 겹치지 않고 글자 없는 건물을 다시
# 찾았다 — 호텔은 간판에 `H`가 박혀 있어 걸리고(wordCompAssets), 나머지 후보는
# 이미 있는 집과 겹친다. 성만 남았다: 탑·성벽으로 실루엣이 뚜렷하다.
NEW.update({
    "castle": ("성", "place", "castle"),
})
# 2026-09-06 — #150(글자조합 신규 단어) 1차 배치. 사람 검수(아래 여러
# 교정 라운드) 끝에 44개가 살아남아 qabWordPool.json이 116→160으로
# 자랐다(47개 중 3자리는 네 번 갈아도 안 맞아 그냥 없앴다 — 맨 아래
# 참고). 글자조합 2음절(56→80)·3~4음절(43→63) 두 밴드가 커진다(목표
# 116엔 아직 못 닿는다 — 이 이슈는 소규모 배치로 여러 PR에 나눠 진행).
#
# 전부 Fluent 원본이고 auto_name이 스스로 맞힌다(EXPLICIT 넷만 보정 필요 —
# 아래 참고).
#
# **사람 검수(낱말카드 검수판, 같은 날)에서 아홉이 물렸다** — 문어·키위·
# 태양·구름·복숭아·코코넛·구급차·스쿠터·트랙터. 전부 단독 아이콘이거나
# (문어·키위·복숭아·코코넛·구급차·트랙터: Fluent에 그 낱말을 가리키는
# 아이콘이 하나뿐이었다) 대안이 다른 개념이라(스쿠터의 유일한 대안
# kick-scooter는 어린이 발판이다) 다른 단어로 바꿨다(교정 배치, 아래
# 참고) — 이 자리는 그 흔적만 남긴다.
NEW.update({
    # 음식 2 — 계란은 2차 검수에서 또 물려(같은 단어에 다른 아이콘도
    # 안 통했다) 아예 다른 단어로 갔다(아래 2차 교정 배치 참고).
    "eggplant": ("가지", "food", "eggplant"),
    "beer": ("맥주", "food", "beer-mug"),
    # 탈것 2 — 로켓·택시만 남는다(구급차·트랙터·스쿠터는 물려 아래 교정
    # 배치의 동물·옷으로 대체됐다).
    "rocket": ("로켓", "vehicle", "rocket"),
    "taxi": ("택시", "vehicle", "taxi"),
    # 무지개·눈송이만 남는다 — "하늘" 범주는 해체됐다. 태양·구름은 1차
    # 교정으로, 보름달은 2차 교정으로 차례로 물려 둘만 남았고, 둘로는
    # 의미 오답 3개를 못 채워 범주 자체를 접었다(QabItemBank.ts 참고).
    "rainbow": ("무지개", None, "rainbow"),
    "snowflake": ("눈송이", None, "snowflake"),
    # 식물 2 — 새싹·나뭇잎 둘 다 사람 검수를 통과했다(나뭇잎은 같은 단어에
    # 다른 아이콘으로 바뀌었다).
    "sprout": ("새싹", "plant", "seedling"),
    "fallen_leaf": ("나뭇잎", "plant", "fallen-leaf"),
    # 의료(신규 범주) 5 — 약·주사기·반창고·체온계·청진기로 다섯을 채운다.
    "pill": ("알약", "medical", "pill"),
    "syringe": ("주사기", "medical", "syringe"),
    "bandage": ("반창고", "medical", "adhesive-bandage"),
    "thermometer": ("체온계", "medical", "thermometer"),
    "stethoscope": ("청진기", "medical", "stethoscope"),
    # 연장 2 — 도끼·렌치로 기존 넷에 더한다.
    "axe": ("도끼", "tool", "axe"),
    "wrench": ("렌치", "tool", "wrench"),
    # 가전 3 — 마이크·스피커·라디오로 기존 여섯에 더한다.
    "microphone": ("마이크", "appliance", "microphone"),
    "speaker": ("스피커", "appliance", "speaker-high-volume"),
    "radio": ("라디오", "appliance", "radio"),
    # 문구 1
    "envelope": ("봉투", "stationery", "envelope"),
    # 범주 없음 17 — 서로 한 무리가 아니거나, 무리를 이룰 만큼 남지 않았다
    # (망원경·현미경은 과학 도구지만 둘뿐이라 범주로 묶지 않는다 — 범주가
    # 너무 얇으면 의미 오답 3개를 그 안에서 못 채워 결국 무작위로 샌다).
    "baby_bottle": ("젖병", None, "baby-bottle"),
    "gift": ("선물", None, "wrapped-gift"),
    "ribbon": ("리본", None, "ribbon"),
    "crown": ("왕관", None, "crown"),
    "ring": ("반지", None, "ring"),
    "tent": ("텐트", None, "tent"),
    "satellite": ("위성", None, "satellite"),
    "gem": ("보석", None, "gem-stone"),
    "desert": ("사막", None, "desert"),
    "volcano": ("화산", None, "volcano"),
    "shield": ("방패", None, "shield"),
    "wood": ("통나무", None, "wood"),
    "desert_island": ("무인도", None, "desert-island"),
    "telescope": ("망원경", None, "telescope"),
    "microscope": ("현미경", None, "microscope"),
    "padlock": ("자물쇠", None, "locked"),
    "trophy": ("트로피", None, "trophy"),
})
# 2026-09-06(같은 날 두 번째) — #150 배치1 사람 검수 교정. 낱말카드
# 검수판(아티팩트)에서 47개 중 처음엔 31개가 걸렸는데, 검수판 자체의
# 렌더링 버그(안쪽 216×216 중첩 SVG에 바깥 CSS `width:100%`가 새어 들어가
# 부모 300×300 기준으로 늘어나며 찌그러졌다 — 실제 앱은 <img> 태그로
# 그려 이 버그와 무관하다) 때문에 상당수가 오탐이었다. `<img>`로 고쳐
# 다시 47개 전부를 처음부터 재검수하니 **아홉만** 진짜로 문제였다:
# 문어·키위·태양·구름·복숭아·코코넛·구급차·스쿠터·트랙터.
#
# Fluent 컬렉션을 다시 뒤졌지만 아홉 다 그 단어를 가리키는 아이콘이
# 하나뿐이었거나(문어·키위·복숭아·코코넛·구급차·트랙터) 유일한 대안이
# 다른 개념이라(스쿠터의 kick-scooter는 어린이 발판) 단어를 바꿨다.
# 사슴·판다는 "하늘" 범주가 줄어드는 계기이기도 하다(해·구름이 빠졌다 —
# 최종적으로는 보름달도 빠져 범주 자체가 해체됐다, 아래 2차 교정 참고).
NEW.update({
    "fox": ("여우", "animal", "fox"),
    "camel": ("낙타", "animal", "camel"),
    "deer": ("사슴", "animal", "deer"),
    "panda": ("판다", "animal", "panda"),
    "hedgehog": ("고슴도치", "animal", "hedgehog"),
    "parrot": ("앵무새", "animal", "parrot"),
    "kangaroo": ("캥거루", "animal", "kangaroo"),
    "koala": ("코알라", "animal", "koala"),
})
# 2026-09-06(같은 날 세 번째) — 낱말카드 검수판으로 1차 교정 열한 개
# (아홉 단어 교체 + 계란·보름달 아이콘 교체)를 다시 검수하니 셋이 또
# 물렸다: 계란(새 아이콘 nest-with-eggs도 안 통함), 보름달(새 아이콘
# full-moon-face도 안 통함), 목도리(교체한 단어 자체가 안 통함). 계란·
# 보름달은 같은 단어의 대안 아이콘이 Fluent에 더 없어서(egg 계열은
# egg·nest-with-eggs·eggplant뿐, moon 계열은 위상별 얼굴 이모지뿐) 아예
# 다른 단어로 갔다. 목도리도 대안 아이콘이 없어(scarf 계열의 나머지는
# 전부 사람이 두건을 쓴 모습이다) 다른 단어로 갔다.
# 2026-09-06(같은 날 네 번째) — 2차 교정 셋(감자·너구리·코뿔소)도 전부
# "단어와 이미지가 안 맞는다"로 물렸다. 3차로 새우·손목시계·아코디언까지
# 시도했지만(실루엣이 뚜렷한 서로 다른 종류의 사물로 골랐다) 그것도
# 안 통해, **결국 세 자리를 그냥 없앴다**(사용자 결정, 2026-09-06) —
# qabWordPool.json이 163이 아니라 160개다. 한 단어가 네 번(계란→
# nest-with-eggs→감자→새우) 자리를 갈아도 안 되면, 그 이상 찾는 것보다
# 자리를 접는 게 낫다는 판단이다. 목도리(→코뿔소→손목시계)·보름달(→
# full-moon-face→너구리→아코디언)도 같은 이유로 접었다.
# 기존 단어의 이름 교정/명시(오매칭 방지). slug -> fluent-name
EXPLICIT = {
    "flower": "tulip", "melon": "melon", "phone": "telephone",
    "piano": "musical-keyboard", "tree": "deciduous-tree", "turtle": "turtle",
    "orange": "tangerine",
    # 2026-09-06 #150 배치 — auto_name이 잘못 짚은 둘을 보정한다.
    # sprout/padlock은 애초에 못 찾았다(seedling/locked라는 이름을 모른다).
    # 둘 다 NEW에 이미 올바른 이름을 직접 박아 뒀지만(위 참고), auto_name이
    # 다른 곳에서 이 slug를 다시 볼 때도 같은 실수를 반복하지 않도록
    # 여기에도 남긴다. (scooter는 사람 검수로 빠졌다 — koala/코알라로
    # 대체됐다. speaker는 그대로 남아 EXPLICIT이 필요 없다 — NEW에 이미
    # 올바른 이름이 있다.)
    "sprout": "seedling", "padlock": "locked",
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
