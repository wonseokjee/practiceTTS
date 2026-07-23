#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
단어이해·그림이름대기 검사용 그림 자산 생성기.

왜 스크립트인가
---------------
자산 74개를 손으로 관리하면 스타일이 갈라지고, 한 곳만 규칙을 어겨도 검사
타당도가 깨진다(아래 규칙 2번이 실제로 그렇게 깨져 있었다). 규칙을 코드로
못 박고 한 번에 생성한다.

규칙
----
1. **그림에 글자를 넣지 않는다.** 그림 이름대기는 그림만 보고 이름을 말하는
   검사다. 이전 자산은 사물 아래에 정답 단어를 인쇄해 두어, 환자가 읽기만
   하면 맞히는 상태였다 — 검사가 성립하지 않았다.
2. **배경은 전 항목 동일.** 이전에는 항목마다 배경색이 달라(16종) 4지선다에서
   배경색 자체가 시각 단서로 작동할 수 있었다.
3. **사물 하나만, 중앙에, 정면(또는 가장 전형적인) 각도로.** 장면·행위가 아닌
   사물의 전형을 그린다.
4. **굵은 외곽선 + 평면 색.** 시야·대비가 떨어지는 고령 사용자를 전제한다.
5. 사물은 캔버스의 약 60~70%를 채운다.

사용법:  python frontend/scripts/generate-wordcomp-illustrations.py
출력:    frontend/public/assets/images/wordComp/*.svg
"""

import os
import sys

OUT_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    '..', 'public', 'assets', 'images', 'wordComp',
)

# ─── 팔레트 ────────────────────────────────────────────────────
BG = '#FAF9F7'   # 전 항목 공통 배경 (배경색이 단서가 되지 않도록)
OL = '#2A2724'   # 외곽선

RED = '#D64545'
DEEPRED = '#B23434'
ORANGE = '#E07B54'
YELLOW = '#F0C246'
CREAM = '#F5E7C6'
GREEN = '#4A9A6F'
DGREEN = '#2D6A56'
BLUE = '#4A86C8'
DBLUE = '#2F5F94'
SKY = '#A8D0EE'
PURPLE = '#8A6BB1'
PINK = '#E9A0B4'
BROWN = '#9A6B45'
DBROWN = '#6E4A2E'
GRAY = '#B8B5AF'
DGRAY = '#7A7671'
WHITE = '#FFFFFF'
BLACK = '#3A3733'

HEADER = (
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" '
    'viewBox="0 0 300 300" role="img">\n'
    '  <rect width="300" height="300" fill="%s" rx="16"/>\n'
    '  <g fill="none" stroke="%s" stroke-width="5" '
    'stroke-linejoin="round" stroke-linecap="round">\n'
) % (BG, OL)
FOOTER = '  </g>\n</svg>\n'


def f(shape):
    """채움 도형 (외곽선은 그룹에서 상속)."""
    return shape


ART = {}

# ─── 과일·먹을거리 ──────────────────────────────────────────────
ART['apple'] = f'''
    <path d="M150 90 C110 90 88 122 88 160 c0 46 28 82 62 82 s62-36 62-82 c0-38-22-70-62-70 z" fill="{RED}"/>
    <path d="M150 92 C150 74 156 60 172 52" />
    <path d="M152 78 C168 62 192 62 200 70 C192 88 168 92 152 78 z" fill="{GREEN}"/>
'''

ART['pear'] = f'''
    <path d="M150 96 c-16 0-26 14-26 30 c0 14-24 24-24 54 c0 34 24 58 50 58 s50-24 50-58 c0-30-24-40-24-54 c0-16-10-30-26-30 z" fill="{CREAM}"/>
    <path d="M150 96 C150 78 154 66 166 58"/>
    <ellipse cx="132" cy="176" rx="10" ry="14" fill="{WHITE}" stroke="none" opacity="0.6"/>
'''

ART['banana'] = f'''
    <path d="M70 128 C82 196 146 234 214 210 c14-5 20-18 10-26 c-52 18-102-16-116-64 c-4-14-24-12-24 0 z" fill="{YELLOW}"/>
    <path d="M70 128 c-2-10 4-16 12-14"/>
    <path d="M224 184 c10 4 12 14 4 20"/>
'''

ART['grape'] = f'''
    <path d="M150 74 C150 60 156 52 168 46"/>
    <path d="M154 62 C172 50 196 54 202 64 C190 80 166 80 154 62 z" fill="{GREEN}"/>
    <circle cx="150" cy="102" r="24" fill="{PURPLE}"/>
    <circle cx="118" cy="140" r="24" fill="{PURPLE}"/>
    <circle cx="182" cy="140" r="24" fill="{PURPLE}"/>
    <circle cx="150" cy="152" r="24" fill="{PURPLE}"/>
    <circle cx="132" cy="192" r="24" fill="{PURPLE}"/>
    <circle cx="168" cy="192" r="24" fill="{PURPLE}"/>
    <circle cx="150" cy="230" r="22" fill="{PURPLE}"/>
'''

ART['strawberry'] = f'''
    <path d="M150 108 c-42 0-66 26-66 58 c0 40 40 74 66 74 s66-34 66-74 c0-32-24-58-66-58 z" fill="{RED}"/>
    <path d="M112 96 h76 l-14 18 h-48 z" fill="{GREEN}"/>
    <path d="M150 96 V72"/>
    <g fill="{YELLOW}" stroke="none">
      <ellipse cx="130" cy="150" rx="5" ry="7"/><ellipse cx="170" cy="150" rx="5" ry="7"/>
      <ellipse cx="150" cy="176" rx="5" ry="7"/><ellipse cx="118" cy="184" rx="5" ry="7"/>
      <ellipse cx="182" cy="184" rx="5" ry="7"/><ellipse cx="150" cy="212" rx="5" ry="7"/>
    </g>
'''

ART['watermelon'] = f'''
    <path d="M46 208 A110 110 0 0 1 254 208 z" fill="{RED}"/>
    <path d="M46 208 A110 110 0 0 1 254 208" fill="none"/>
    <path d="M46 208 h208" />
    <path d="M60 208 A96 96 0 0 1 240 208 z" fill="none" stroke="{WHITE}" stroke-width="10"/>
    <g fill="{BLACK}" stroke="none">
      <ellipse cx="120" cy="176" rx="6" ry="9"/><ellipse cx="180" cy="176" rx="6" ry="9"/>
      <ellipse cx="150" cy="150" rx="6" ry="9"/><ellipse cx="150" cy="196" rx="6" ry="9"/>
    </g>
'''

ART['tomato'] = f'''
    <circle cx="150" cy="168" r="72" fill="{RED}"/>
    <path d="M150 96 V76"/>
    <path d="M150 100 l-34-22 l6 26 l-26 2 l24 18 z" fill="{GREEN}"/>
    <path d="M150 100 l34-22 l-6 26 l26 2 l-24 18 z" fill="{GREEN}"/>
'''

ART['melon'] = f'''
    <ellipse cx="150" cy="162" rx="60" ry="80" fill="{YELLOW}"/>
    <path d="M150 82 V70"/>
    <g stroke="{WHITE}" stroke-width="9">
      <path d="M120 92 C108 130 108 194 120 232"/>
      <path d="M150 84 V240"/>
      <path d="M180 92 C192 130 192 194 180 232"/>
    </g>
'''

ART['sweet_potato'] = f'''
    <path d="M78 190 C68 148 108 96 158 82 c40-12 70 14 62 54 c-8 42-58 92-104 92 c-26 0-36-16-38-38 z" fill="{PURPLE}"/>
    <g stroke="{DEEPRED}" stroke-width="4">
      <path d="M112 148 l16 10"/><path d="M148 118 l16 10"/><path d="M132 190 l16 10"/>
    </g>
'''

ART['bread'] = f'''
    <path d="M62 150 c0-40 40-62 88-62 s88 22 88 62 v62 a14 14 0 0 1-14 14 H76 a14 14 0 0 1-14-14 z" fill="{CREAM}"/>
    <path d="M62 150 h176"/>
    <path d="M96 150 c0-26 8-44 20-54" />
    <path d="M150 150 V88"/>
    <path d="M204 150 c0-26-8-44-20-54"/>
'''

ART['candy'] = f'''
    <ellipse cx="150" cy="150" rx="52" ry="42" fill="{PINK}"/>
    <path d="M98 150 L58 118 l10 32 l-10 32 z" fill="{RED}"/>
    <path d="M202 150 L242 118 l-10 32 l10 32 z" fill="{RED}"/>
    <path d="M132 128 C142 148 142 152 132 172" stroke="{WHITE}" stroke-width="7"/>
    <path d="M168 128 C158 148 158 152 168 172" stroke="{WHITE}" stroke-width="7"/>
'''

ART['milk'] = f'''
    <path d="M100 116 h100 v130 a10 10 0 0 1-10 10 h-80 a10 10 0 0 1-10-10 z" fill="{WHITE}"/>
    <path d="M100 116 l30-46 h40 l30 46 z" fill="{SKY}"/>
    <path d="M130 70 h40"/>
    <rect x="120" y="160" width="60" height="46" rx="6" fill="{SKY}"/>
'''

ART['juice'] = f'''
    <path d="M104 108 h92 l-12 140 a10 10 0 0 1-10 9 h-48 a10 10 0 0 1-10-9 z" fill="{WHITE}"/>
    <path d="M110 168 h80 l-8 88 h-64 z" fill="{ORANGE}"/>
    <path d="M104 108 h92"/>
    <path d="M176 104 L206 52" stroke-width="9" stroke="{RED}"/>
'''

ART['pot'] = f'''
    <path d="M74 140 h152 v72 a24 24 0 0 1-24 24 H98 a24 24 0 0 1-24-24 z" fill="{GRAY}"/>
    <rect x="66" y="122" width="168" height="20" rx="8" fill="{DGRAY}"/>
    <path d="M150 122 v-16"/>
    <circle cx="150" cy="100" r="9" fill="{DGRAY}"/>
    <path d="M66 156 h-22 a10 10 0 0 0 0 20 h22" fill="none"/>
    <path d="M234 156 h22 a10 10 0 0 1 0 20 h-22" fill="none"/>
'''

ART['ladle'] = f'''
    <path d="M96 176 a44 34 0 0 0 88 0 z" fill="{GRAY}"/>
    <path d="M96 176 h88"/>
    <path d="M184 176 C204 132 208 96 196 62" stroke-width="10"/>
    <path d="M196 62 a12 12 0 1 1 0-0.1" fill="none"/>
'''

ART['rice_cooker'] = f'''
    <path d="M72 156 h156 v70 a16 16 0 0 1-16 16 H88 a16 16 0 0 1-16-16 z" fill="{WHITE}"/>
    <path d="M72 156 a78 40 0 0 1 156 0 z" fill="{GRAY}"/>
    <rect x="112" y="180" width="76" height="34" rx="6" fill="{SKY}"/>
    <circle cx="150" cy="118" r="10" fill="{DGRAY}"/>
    <path d="M92 132 h20"/>
'''

# ─── 동물 ───────────────────────────────────────────────────────
ART['cat'] = f'''
    <path d="M90 118 l6-48 l44 30 z" fill="{GRAY}"/>
    <path d="M210 118 l-6-48 l-44 30 z" fill="{GRAY}"/>
    <ellipse cx="150" cy="168" rx="76" ry="66" fill="{GRAY}"/>
    <circle cx="122" cy="156" r="8" fill="{OL}" stroke="none"/>
    <circle cx="178" cy="156" r="8" fill="{OL}" stroke="none"/>
    <path d="M150 180 l-10 10 h20 z" fill="{PINK}"/>
    <path d="M150 190 v10"/>
    <g stroke-width="4">
      <path d="M96 178 h-30"/><path d="M96 192 h-28"/>
      <path d="M204 178 h30"/><path d="M204 192 h28"/>
    </g>
'''

ART['dog'] = f'''
    <path d="M84 122 c-16 24-14 66 8 82 l30-30 z" fill="{BROWN}"/>
    <path d="M216 122 c16 24 14 66-8 82 l-30-30 z" fill="{BROWN}"/>
    <ellipse cx="150" cy="160" rx="70" ry="62" fill="{CREAM}"/>
    <ellipse cx="150" cy="196" rx="38" ry="30" fill="{WHITE}"/>
    <circle cx="126" cy="150" r="8" fill="{OL}" stroke="none"/>
    <circle cx="174" cy="150" r="8" fill="{OL}" stroke="none"/>
    <ellipse cx="150" cy="184" rx="12" ry="9" fill="{OL}" stroke="none"/>
    <path d="M150 193 v12"/>
    <path d="M150 205 c-10 10-24 4-24-6"/>
    <path d="M150 205 c10 10 24 4 24-6"/>
'''

ART['chick'] = f'''
    <ellipse cx="150" cy="188" rx="62" ry="54" fill="{YELLOW}"/>
    <circle cx="150" cy="116" r="42" fill="{YELLOW}"/>
    <circle cx="136" cy="110" r="7" fill="{OL}" stroke="none"/>
    <circle cx="164" cy="110" r="7" fill="{OL}" stroke="none"/>
    <path d="M150 122 l-16 10 l16 10 z" fill="{ORANGE}"/>
    <path d="M128 240 v14"/><path d="M172 240 v14"/>
    <path d="M118 254 h20"/><path d="M162 254 h20"/>
'''

ART['elephant'] = f'''
    <ellipse cx="164" cy="164" rx="76" ry="64" fill="{GRAY}"/>
    <ellipse cx="96" cy="148" rx="44" ry="46" fill="{GRAY}"/>
    <path d="M96 190 c-14 22-6 50 14 58 c14 6 24-6 18-18" fill="{GRAY}"/>
    <circle cx="82" cy="136" r="7" fill="{OL}" stroke="none"/>
    <ellipse cx="140" cy="140" rx="30" ry="34" fill="{DGRAY}"/>
    <path d="M120 222 v26"/><path d="M164 226 v22"/><path d="M212 216 v32"/>
'''

ART['lion'] = f'''
    <circle cx="150" cy="160" r="86" fill="{ORANGE}"/>
    <circle cx="150" cy="160" r="58" fill="{YELLOW}"/>
    <circle cx="128" cy="148" r="8" fill="{OL}" stroke="none"/>
    <circle cx="172" cy="148" r="8" fill="{OL}" stroke="none"/>
    <path d="M150 172 l-11 11 h22 z" fill="{OL}"/>
    <path d="M150 183 v10"/>
    <path d="M150 193 c-11 10-24 3-24-7"/>
    <path d="M150 193 c11 10 24 3 24-7"/>
'''

ART['tiger'] = f'''
    <path d="M96 108 a24 24 0 0 1 34 0 z" fill="{ORANGE}"/>
    <path d="M204 108 a24 24 0 0 0-34 0 z" fill="{ORANGE}"/>
    <ellipse cx="150" cy="166" rx="76" ry="70" fill="{ORANGE}"/>
    <ellipse cx="150" cy="186" rx="42" ry="34" fill="{CREAM}"/>
    <g stroke-width="7">
      <path d="M104 130 l16 14"/><path d="M196 130 l-16 14"/>
      <path d="M86 168 h18"/><path d="M214 168 h-18"/>
      <path d="M92 198 l18-8"/><path d="M208 198 l-18-8"/>
    </g>
    <circle cx="128" cy="154" r="8" fill="{OL}" stroke="none"/>
    <circle cx="172" cy="154" r="8" fill="{OL}" stroke="none"/>
    <path d="M150 178 l-11 10 h22 z" fill="{PINK}"/>
    <path d="M150 188 v10"/>
'''

ART['turtle'] = f'''
    <ellipse cx="150" cy="164" rx="86" ry="62" fill="{GREEN}"/>
    <ellipse cx="150" cy="164" rx="56" ry="38" fill="{DGREEN}"/>
    <path d="M150 126 v76"/><path d="M110 148 l80 32"/><path d="M110 180 l80-32"/>
    <circle cx="238" cy="158" r="24" fill="{GREEN}"/>
    <circle cx="246" cy="152" r="6" fill="{OL}" stroke="none"/>
    <ellipse cx="96" cy="220" rx="22" ry="14" fill="{GREEN}"/>
    <ellipse cx="196" cy="222" rx="22" ry="14" fill="{GREEN}"/>
    <ellipse cx="62" cy="176" rx="18" ry="12" fill="{GREEN}"/>
'''

ART['whale'] = f'''
    <path d="M56 168 c0-42 44-70 96-70 c56 0 92 30 92 66 c0 34-40 60-92 60 c-52 0-96-24-96-56 z" fill="{BLUE}"/>
    <path d="M244 164 l40-34 v78 z" fill="{BLUE}"/>
    <path d="M70 190 c40 20 130 20 168 0" stroke="{WHITE}" stroke-width="8"/>
    <circle cx="106" cy="150" r="7" fill="{OL}" stroke="none"/>
    <path d="M126 92 C120 70 136 58 150 66" stroke="{SKY}" stroke-width="9"/>
    <path d="M150 66 C160 52 178 56 180 72" stroke="{SKY}" stroke-width="9"/>
'''

ART['butterfly'] = f'''
    <path d="M148 150 C112 92 46 96 52 142 c4 34 60 44 96 20 z" fill="{ORANGE}"/>
    <path d="M152 150 C188 92 254 96 248 142 c-4 34-60 44-96 20 z" fill="{ORANGE}"/>
    <path d="M148 152 C116 200 62 214 68 240 c6 22 62 4 82-40 z" fill="{YELLOW}"/>
    <path d="M152 152 C184 200 238 214 232 240 c-6 22-62 4-82-40 z" fill="{YELLOW}"/>
    <ellipse cx="150" cy="164" rx="10" ry="50" fill="{OL}"/>
    <path d="M144 116 C134 92 122 84 112 82"/>
    <path d="M156 116 C166 92 178 84 188 82"/>
'''

# ─── 탈것 ───────────────────────────────────────────────────────
ART['airplane'] = f'''
    <path d="M46 158 c0-12 10-20 28-22 l120-8 l44 2 a14 14 0 0 1 0 28 l-44 2 l-120 -8 c-18-2-28 -10-28-20 z" fill="{WHITE}"/>
    <path d="M118 152 L88 78 h28 l52 74 z" fill="{SKY}"/>
    <path d="M118 164 L88 238 h28 l52 -74 z" fill="{SKY}"/>
    <path d="M56 152 L38 112 h20 l24 40 z" fill="{DBLUE}"/>
    <path d="M56 164 L38 204 h20 l24 -40 z" fill="{DBLUE}"/>
    <circle cx="206" cy="158" r="8" fill="{SKY}" stroke="none"/>
    <circle cx="182" cy="158" r="8" fill="{SKY}" stroke="none"/>
'''

ART['car'] = f'''
    <path d="M46 200 v-30 c0-10 8-16 18-18 l26-40 c4-8 12-12 22-12 h76 c10 0 18 4 22 12 l26 40 c10 2 18 8 18 18 v30 z" fill="{RED}"/>
    <path d="M104 112 h40 v40 h-66 z" fill="{SKY}"/>
    <path d="M156 112 h34 l22 40 h-56 z" fill="{SKY}"/>
    <circle cx="96" cy="204" r="26" fill="{DGRAY}"/>
    <circle cx="204" cy="204" r="26" fill="{DGRAY}"/>
    <circle cx="96" cy="204" r="9" fill="{WHITE}" stroke="none"/>
    <circle cx="204" cy="204" r="9" fill="{WHITE}" stroke="none"/>
'''

ART['bus'] = f'''
    <rect x="46" y="76" width="208" height="132" rx="18" fill="{YELLOW}"/>
    <rect x="66" y="98" width="72" height="46" rx="6" fill="{SKY}"/>
    <rect x="162" y="98" width="72" height="46" rx="6" fill="{SKY}"/>
    <path d="M46 166 h208"/>
    <circle cx="94" cy="212" r="24" fill="{DGRAY}"/>
    <circle cx="206" cy="212" r="24" fill="{DGRAY}"/>
    <circle cx="94" cy="212" r="8" fill="{WHITE}" stroke="none"/>
    <circle cx="206" cy="212" r="8" fill="{WHITE}" stroke="none"/>
'''

ART['train'] = f'''
    <path d="M56 108 h84 v104 H56 z" fill="{RED}"/>
    <path d="M140 140 h104 v72 H140 z" fill="{RED}"/>
    <rect x="72" y="126" width="52" height="40" rx="5" fill="{SKY}"/>
    <rect x="160" y="156" width="30" height="28" rx="4" fill="{SKY}"/>
    <rect x="204" y="156" width="30" height="28" rx="4" fill="{SKY}"/>
    <path d="M92 108 V78 h26 v30" fill="{DGRAY}"/>
    <path d="M44 212 h212"/>
    <circle cx="90" cy="228" r="18" fill="{DGRAY}"/>
    <circle cx="160" cy="228" r="18" fill="{DGRAY}"/>
    <circle cx="220" cy="228" r="18" fill="{DGRAY}"/>
'''

ART['bicycle'] = f'''
    <circle cx="78" cy="188" r="50" fill="none" stroke-width="7"/>
    <circle cx="222" cy="188" r="50" fill="none" stroke-width="7"/>
    <path d="M78 188 L128 188 L156 116 L186 188 L222 188"/>
    <path d="M128 188 L156 116"/>
    <path d="M156 116 h-34"/>
    <path d="M186 188 L200 118 h-18"/>
    <circle cx="150" cy="188" r="10" fill="{OL}"/>
'''

ART['ship'] = f'''
    <path d="M52 190 h196 l-26 44 H78 z" fill="{RED}"/>
    <rect x="104" y="130" width="92" height="60" rx="6" fill="{WHITE}"/>
    <circle cx="130" cy="160" r="9" fill="{SKY}"/>
    <circle cx="170" cy="160" r="9" fill="{SKY}"/>
    <rect x="136" y="82" width="28" height="48" rx="5" fill="{DGRAY}"/>
    <path d="M34 246 c22-12 44 12 66 0 c22-12 44 12 66 0 c22-12 44 12 66 0" stroke="{BLUE}" stroke-width="7"/>
'''

# ─── 집안 물건 ──────────────────────────────────────────────────
ART['chair'] = f'''
    <path d="M96 46 h96 a12 12 0 0 1 12 12 v96 h-120 V58 a12 12 0 0 1 12-12 z" fill="{BROWN}"/>
    <g stroke="{DBROWN}" stroke-width="6">
      <path d="M120 78 h48"/><path d="M120 110 h48"/>
    </g>
    <path d="M66 154 h156 a10 10 0 0 1 10 10 v18 a10 10 0 0 1-10 10 H66 a10 10 0 0 1-10-10 v-18 a10 10 0 0 1 10-10 z" fill="{DBROWN}"/>
    <path d="M78 192 v58"/><path d="M210 192 v58"/>
    <path d="M96 154 v-108"/><path d="M192 154 v-108"/>
'''

ART['desk'] = f'''
    <rect x="38" y="112" width="224" height="24" rx="6" fill="{BROWN}"/>
    <path d="M58 136 v112"/><path d="M242 136 v112"/>
    <rect x="150" y="146" width="86" height="42" rx="6" fill="{DBROWN}"/>
    <circle cx="193" cy="167" r="6" fill="{CREAM}" stroke="none"/>
'''

ART['bed'] = f'''
    <path d="M40 66 h38 v168 h-38 z" fill="{BROWN}"/>
    <path d="M238 128 h26 v106 h-26 z" fill="{BROWN}"/>
    <path d="M78 156 h160 v46 H78 z" fill="{WHITE}"/>
    <path d="M78 202 h160 v18 H78 z" fill="{SKY}"/>
    <path d="M96 120 h74 a10 10 0 0 1 10 10 v16 a10 10 0 0 1-10 10 H96 a10 10 0 0 1-10-10 v-16 a10 10 0 0 1 10-10 z" fill="{WHITE}"/>
    <path d="M180 156 c26 0 42 12 58 12" stroke="{SKY}" stroke-width="5"/>
'''

ART['blanket'] = f'''
    <path d="M52 84 c34-16 62 12 98 0 c36-12 64 16 98 0 v134 c-34 16-62-12-98 0 c-36 12-64-16-98 0 z" fill="{SKY}"/>
    <path d="M52 122 c34-16 62 12 98 0 c36-12 64 16 98 0" stroke="{WHITE}" stroke-width="8"/>
    <path d="M52 172 c34-16 62 12 98 0 c36-12 64 16 98 0" stroke="{WHITE}" stroke-width="8"/>
    <g stroke="{WHITE}" stroke-width="6">
      <path d="M100 92 v134"/><path d="M150 88 v134"/><path d="M200 92 v134"/>
    </g>
'''

ART['refrigerator'] = f'''
    <rect x="88" y="46" width="124" height="208" rx="14" fill="{WHITE}"/>
    <path d="M88 128 h124"/>
    <path d="M186 88 v28"/>
    <path d="M186 142 v34"/>
    <rect x="104" y="150" width="30" height="60" rx="6" fill="{SKY}" stroke="none"/>
'''

ART['washing_machine'] = f'''
    <rect x="70" y="56" width="160" height="192" rx="14" fill="{WHITE}"/>
    <path d="M70 100 h160"/>
    <circle cx="150" cy="176" r="52" fill="{SKY}"/>
    <circle cx="150" cy="176" r="34" fill="{WHITE}"/>
    <circle cx="96" cy="78" r="9" fill="{DGRAY}" stroke="none"/>
    <rect x="176" y="68" width="42" height="20" rx="5" fill="{GRAY}" stroke="none"/>
'''

ART['mirror'] = f'''
    <ellipse cx="150" cy="132" rx="72" ry="88" fill="{SKY}"/>
    <ellipse cx="150" cy="132" rx="72" ry="88" fill="none" stroke-width="8"/>
    <path d="M112 92 L136 172" stroke="{WHITE}" stroke-width="8"/>
    <path d="M146 92 L170 172" stroke="{WHITE}" stroke-width="7"/>
    <path d="M136 220 h28 v48 h-28 z" fill="{BROWN}"/>
'''

ART['towel'] = f'''
    <path d="M60 70 h180 v18 H60 z" fill="{GRAY}"/>
    <path d="M78 88 h144 v150 a10 10 0 0 1-10 10 H88 a10 10 0 0 1-10-10 z" fill="{WHITE}"/>
    <path d="M78 126 h144" stroke="{SKY}" stroke-width="12"/>
    <path d="M78 152 h144" stroke="{PINK}" stroke-width="9"/>
    <path d="M78 214 h144" stroke="{SKY}" stroke-width="9"/>
    <path d="M150 88 v160" stroke="{BG}" stroke-width="4"/>
'''

ART['soap'] = f'''
    <path d="M70 158 h160 v52 a14 14 0 0 1-14 14 H84 a14 14 0 0 1-14-14 z" fill="{PINK}"/>
    <path d="M70 158 a80 26 0 0 1 160 0 z" fill="{PINK}"/>
    <path d="M70 158 h160"/>
    <circle cx="106" cy="102" r="18" fill="{WHITE}"/>
    <circle cx="146" cy="76" r="12" fill="{WHITE}"/>
    <circle cx="180" cy="102" r="9" fill="{WHITE}"/>
'''

ART['comb'] = f'''
    <path d="M52 96 h196 a10 10 0 0 1 10 10 v34 H42 v-34 a10 10 0 0 1 10-10 z" fill="{DGRAY}"/>
    <g stroke-width="6">
      <path d="M58 140 v76"/><path d="M80 140 v76"/><path d="M102 140 v76"/>
      <path d="M124 140 v76"/><path d="M146 140 v76"/><path d="M168 140 v76"/>
      <path d="M190 140 v76"/><path d="M212 140 v76"/><path d="M234 140 v76"/>
    </g>
'''

ART['mailbox'] = f'''
    <path d="M78 118 a72 46 0 0 1 144 0 v82 H78 z" fill="{RED}"/>
    <rect x="112" y="140" width="76" height="16" rx="6" fill="{OL}" stroke="none"/>
    <path d="M136 200 v50"/><path d="M164 200 v50"/>
    <path d="M118 250 h64"/>
    <path d="M222 128 h22 v46 h-22" fill="{RED}"/>
'''

# ─── 학용품·사무 ───────────────────────────────────────────────
ART['pencil'] = f'''
    <path d="M74 226 l16-54 L206 56 l38 38 L128 210 z" fill="{YELLOW}"/>
    <path d="M74 226 l16-54 l38 38 z" fill="{CREAM}"/>
    <path d="M92 208 l22-6 l-16-16 z" fill="{OL}"/>
    <path d="M206 56 l38 38"/>
    <path d="M182 80 l38 38" stroke-width="4"/>
    <path d="M222 34 l-16 22 l38 38 l22-16 a16 16 0 0 0 0-24 l-20-20 a16 16 0 0 0-24 0 z" fill="{PINK}"/>
'''

ART['notebook'] = f'''
    <rect x="82" y="52" width="150" height="196" rx="10" fill="{WHITE}"/>
    <path d="M112 52 v196" stroke="{RED}" stroke-width="5"/>
    <g stroke="{SKY}" stroke-width="5">
      <path d="M130 96 h82"/><path d="M130 128 h82"/><path d="M130 160 h82"/>
      <path d="M130 192 h82"/>
    </g>
    <g stroke-width="6">
      <path d="M68 76 h34"/><path d="M68 118 h34"/><path d="M68 160 h34"/><path d="M68 202 h34"/>
    </g>
'''

ART['book'] = f'''
    <path d="M62 78 h176 a10 10 0 0 1 10 10 v134 a10 10 0 0 1-10 10 H62 z" fill="{DGREEN}"/>
    <path d="M62 78 v154"/>
    <path d="M50 78 h12 v154 H50 a4 4 0 0 1-4-4 V82 a4 4 0 0 1 4-4 z" fill="{DBROWN}"/>
    <g stroke="{CREAM}" stroke-width="5">
      <path d="M104 128 h100"/><path d="M104 158 h100"/><path d="M104 188 h70"/>
    </g>
'''

ART['scissors'] = f'''
    <path d="M96 62 L186 196"/>
    <path d="M204 62 L114 196"/>
    <circle cx="106" cy="220" r="28" fill="none" stroke-width="9"/>
    <circle cx="194" cy="220" r="28" fill="none" stroke-width="9"/>
    <circle cx="150" cy="138" r="9" fill="{DGRAY}"/>
'''

ART['student'] = f'''
    <circle cx="150" cy="86" r="36" fill="{CREAM}"/>
    <circle cx="138" cy="82" r="5" fill="{OL}" stroke="none"/>
    <circle cx="162" cy="82" r="5" fill="{OL}" stroke="none"/>
    <path d="M140 98 c6 6 14 6 20 0"/>
    <path d="M110 138 c0-18 18-16 40-16 s40-2 40 16 v76 h-80 z" fill="{BLUE}"/>
    <path d="M86 152 h24 v66 H86 z" fill="{ORANGE}"/>
    <path d="M190 152 h24 v66 h-24 z" fill="{ORANGE}"/>
    <path d="M124 214 v40"/><path d="M176 214 v40"/>
'''

# ─── 의류·소지품 ───────────────────────────────────────────────
ART['hat'] = f'''
    <path d="M96 168 c0-58 12-98 54-98 s54 40 54 98 z" fill="{DGREEN}"/>
    <path d="M92 152 h116 v20 H92 z" fill="{OL}"/>
    <ellipse cx="150" cy="180" rx="112" ry="26" fill="{DGREEN}"/>
'''

ART['bag'] = f'''
    <path d="M74 122 h152 l14 122 a10 10 0 0 1-10 11 H70 a10 10 0 0 1-10-11 z" fill="{BROWN}"/>
    <path d="M108 122 v-16 a42 42 0 0 1 84 0 v16" fill="none" stroke-width="9"/>
    <rect x="128" y="164" width="44" height="30" rx="6" fill="{CREAM}"/>
'''

ART['shoes'] = f'''
    <path d="M40 186 C40 166 58 158 88 152 C134 142 182 128 206 108 C218 98 242 102 248 118 C256 140 254 168 250 186 Z" fill="{BLUE}"/>
    <path d="M96 150 C104 166 106 176 106 186" stroke-width="5"/>
    <g stroke-width="5">
      <path d="M126 144 l14 42"/><path d="M156 134 l14 52"/><path d="M186 122 l12 64"/>
    </g>
    <path d="M212 110 C224 128 226 158 224 186" stroke-width="5"/>
    <path d="M32 186 h236 a14 14 0 0 1 14 14 v10 a14 14 0 0 1-14 14 H32 a14 14 0 0 1-14-14 v-10 a14 14 0 0 1 14-14 z" fill="{WHITE}"/>
'''

ART['socks'] = f'''
    <path d="M92 56 h56 v104 c0 26-16 40-38 40 s-38-16-38-38 c0-20 20-24 20-44 z" fill="{WHITE}"/>
    <path d="M92 88 h56" stroke="{RED}" stroke-width="9"/>
    <path d="M162 56 h56 v66 c0 20 20 24 20 44 c0 22-16 38-38 38 s-38-14-38-40 z" fill="{WHITE}"/>
    <path d="M162 88 h56" stroke="{RED}" stroke-width="9"/>
'''

ART['gloves'] = f'''
    <path d="M104 138 h92 a10 10 0 0 1 10 10 v66 a16 16 0 0 1-16 16 h-80 a16 16 0 0 1-16-16 v-66 a10 10 0 0 1 10-10 z" fill="{RED}"/>
    <g fill="{RED}">
      <path d="M112 138 v-32 a11 11 0 0 1 22 0 v32 z"/>
      <path d="M140 138 v-44 a11 11 0 0 1 22 0 v44 z"/>
      <path d="M168 138 v-38 a11 11 0 0 1 22 0 v38 z"/>
    </g>
    <path d="M104 158 l-30 22 a14 14 0 0 0 16 24 l24-18 z" fill="{RED}"/>
    <path d="M90 230 h120 v22 a8 8 0 0 1-8 8 H98 a8 8 0 0 1-8-8 z" fill="{WHITE}"/>
'''

ART['umbrella'] = f'''
    <path d="M36 160 a114 114 0 0 1 228 0 z" fill="{RED}"/>
    <path d="M36 160 c22-22 36 22 57 0 c22-22 36 22 57 0 c22-22 36 22 57 0 c22-22 36 22 57 0" fill="none"/>
    <path d="M150 46 v186"/>
    <path d="M150 232 a24 24 0 0 1-46 8" fill="none" stroke-width="9"/>
    <path d="M150 46 v-14"/>
'''

# ─── 도구·기계 ─────────────────────────────────────────────────
ART['hammer'] = f'''
    <path d="M78 62 h96 a14 14 0 0 1 14 14 v34 a14 14 0 0 1-14 14 h-96 c-18 0-32-14-32-31 s14-31 32-31 z" fill="{DGRAY}"/>
    <path d="M138 124 l-20 130 a12 12 0 0 1-24-3 l14-127 z" fill="{BROWN}"/>
'''

ART['knife'] = f'''
    <path d="M40 176 L196 106 v56 c-52 20-108 26-156 14 z" fill="{GRAY}"/>
    <path d="M40 176 L196 106"/>
    <path d="M196 108 h58 a14 14 0 0 1 14 14 v28 a14 14 0 0 1-14 14 h-58 z" fill="{DBROWN}"/>
    <g fill="{CREAM}" stroke="none">
      <circle cx="216" cy="136" r="5"/><circle cx="240" cy="136" r="5"/>
    </g>
'''

ART['ladder'] = f'''
    <path d="M92 44 v212" stroke-width="10"/>
    <path d="M208 44 v212" stroke-width="10"/>
    <g stroke-width="9">
      <path d="M92 84 h116"/><path d="M92 126 h116"/>
      <path d="M92 168 h116"/><path d="M92 210 h116"/>
    </g>
'''

ART['basket'] = f'''
    <path d="M62 140 h176 l-22 100 a12 12 0 0 1-12 10 H96 a12 12 0 0 1-12-10 z" fill="{BROWN}"/>
    <g stroke="{CREAM}" stroke-width="5">
      <path d="M92 178 h116"/><path d="M98 214 h104"/>
      <path d="M110 140 l10 110"/><path d="M150 140 v110"/><path d="M190 140 l-10 110"/>
    </g>
    <path d="M86 140 a64 60 0 0 1 128 0" fill="none" stroke-width="9"/>
'''

ART['computer'] = f'''
    <rect x="66" y="60" width="168" height="120" rx="10" fill="{WHITE}"/>
    <rect x="82" y="76" width="136" height="88" rx="5" fill="{SKY}"/>
    <path d="M46 216 h208 a0 0 0 0 0 0 0 l-16-36 H62 z" fill="{GRAY}"/>
    <path d="M46 216 h208 a10 10 0 0 1-10 12 H56 a10 10 0 0 1-10-12 z" fill="{DGRAY}"/>
'''

ART['phone'] = f'''
    <path d="M62 178 h176 a16 16 0 0 1 16 16 v40 a16 16 0 0 1-16 16 H62 a16 16 0 0 1-16-16 v-40 a16 16 0 0 1 16-16 z" fill="{CREAM}"/>
    <g fill="{DGRAY}" stroke="none">
      <circle cx="96" cy="200" r="7"/><circle cx="124" cy="200" r="7"/><circle cx="152" cy="200" r="7"/>
      <circle cx="96" cy="226" r="7"/><circle cx="124" cy="226" r="7"/><circle cx="152" cy="226" r="7"/>
    </g>
    <path d="M64 106 a20 20 0 0 1 40 0 v22 h92 v-22 a20 20 0 0 1 40 0 c0 16-10 26-24 26 H88 c-14 0-24-10-24-26 z" fill="{RED}"/>
    <path d="M104 128 h92" stroke="{DEEPRED}" stroke-width="5"/>
    <path d="M196 200 c22 0 30 12 30 26" stroke-width="5"/>
'''

ART['piano'] = f'''
    <rect x="46" y="96" width="208" height="48" rx="8" fill="{OL}"/>
    <rect x="46" y="144" width="208" height="86" rx="8" fill="{WHITE}"/>
    <g stroke-width="5">
      <path d="M76 144 v86"/><path d="M106 144 v86"/><path d="M136 144 v86"/>
      <path d="M166 144 v86"/><path d="M196 144 v86"/><path d="M226 144 v86"/>
    </g>
    <g fill="{OL}" stroke="none">
      <rect x="66" y="144" width="16" height="52"/><rect x="98" y="144" width="16" height="52"/>
      <rect x="158" y="144" width="16" height="52"/><rect x="190" y="144" width="16" height="52"/>
      <rect x="220" y="144" width="16" height="52"/>
    </g>
'''

ART['guitar'] = f'''
    <path d="M150 108 c40 0 58 22 58 48 c0 18-14 28-14 44 c0 34-20 56-44 56 s-44-22-44-56 c0-16-14-26-14-44 c0-26 18-48 58-48 z" fill="{BROWN}"/>
    <ellipse cx="150" cy="176" rx="26" ry="26" fill="{OL}"/>
    <rect x="136" y="44" width="28" height="66" fill="{DBROWN}"/>
    <path d="M124 24 h52 a8 8 0 0 1 8 8 v22 h-68 V32 a8 8 0 0 1 8-8 z" fill="{DBROWN}"/>
    <g stroke="{CREAM}" stroke-width="3">
      <path d="M140 54 V232"/><path d="M150 54 V236"/><path d="M160 54 V232"/>
    </g>
    <rect x="126" y="228" width="48" height="14" rx="4" fill="{DBROWN}"/>
'''

ART['trumpet'] = f'''
    <path d="M190 150 l68-52 v104 z" fill="{YELLOW}"/>
    <path d="M62 134 h128 v32 H62 z" fill="{YELLOW}"/>
    <path d="M62 134 a18 16 0 0 0 0 32" fill="{YELLOW}"/>
    <g fill="{DGRAY}">
      <rect x="94" y="104" width="18" height="30" rx="5"/>
      <rect x="126" y="104" width="18" height="30" rx="5"/>
      <rect x="158" y="104" width="18" height="30" rx="5"/>
    </g>
'''

ART['toothbrush'] = f'''
    <path d="M60 132 h150 a16 16 0 0 1 0 32 H60 a16 16 0 0 1 0-32 z" fill="{WHITE}"/>
    <path d="M206 132 l44 -10 a16 16 0 0 1 4 32 l-48 -6 z" fill="{BLUE}"/>
    <path d="M60 132 h72 v-30 h-72 z" fill="{SKY}"/>
    <g stroke="{DBLUE}" stroke-width="5">
      <path d="M72 132 v-30"/><path d="M88 132 v-30"/><path d="M104 132 v-30"/><path d="M120 132 v-30"/>
    </g>
'''

ART['toothpaste'] = f'''
    <path d="M104 112 h114 a12 12 0 0 1 12 12 v62 a12 12 0 0 1-12 12 H104 z" fill="{WHITE}"/>
    <path d="M104 112 l-44 22 v42 l44 22 z" fill="{WHITE}"/>
    <path d="M60 134 v42"/>
    <path d="M132 136 h74" stroke="{SKY}" stroke-width="11"/>
    <path d="M132 164 h74" stroke="{GREEN}" stroke-width="11"/>
    <rect x="230" y="128" width="20" height="54" rx="5" fill="{GRAY}"/>
    <path d="M250 142 a16 22 0 0 1 0 26 c14-6 14-20 0-26 z" fill="{SKY}"/>
'''

ART['spine'] = f'''
    <g fill="{CREAM}">
      <rect x="120" y="46" width="60" height="26" rx="9"/>
      <rect x="118" y="80" width="64" height="26" rx="9"/>
      <rect x="116" y="114" width="68" height="26" rx="9"/>
      <rect x="118" y="148" width="64" height="26" rx="9"/>
      <rect x="120" y="182" width="60" height="26" rx="9"/>
      <path d="M126 216 h48 l-12 44 h-24 z"/>
    </g>
    <g stroke-width="4">
      <path d="M110 59 h-16"/><path d="M190 59 h16"/>
      <path d="M108 127 h-18"/><path d="M192 127 h18"/>
      <path d="M110 195 h-16"/><path d="M190 195 h16"/>
    </g>
'''

# ─── 자연 ───────────────────────────────────────────────────────
ART['tree'] = f'''
    <circle cx="150" cy="126" r="76" fill="{GREEN}"/>
    <circle cx="102" cy="152" r="40" fill="{GREEN}"/>
    <circle cx="198" cy="152" r="40" fill="{GREEN}"/>
    <path d="M132 190 h36 v66 h-36 z" fill="{DBROWN}"/>
    <path d="M150 220 l-24-20" stroke-width="7"/>
    <path d="M150 236 l24-20" stroke-width="7"/>
'''

ART['flower'] = f'''
    <circle cx="150" cy="70" r="32" fill="{PINK}"/>
    <circle cx="96" cy="110" r="32" fill="{PINK}"/>
    <circle cx="204" cy="110" r="32" fill="{PINK}"/>
    <circle cx="118" cy="172" r="32" fill="{PINK}"/>
    <circle cx="182" cy="172" r="32" fill="{PINK}"/>
    <circle cx="150" cy="128" r="30" fill="{YELLOW}"/>
    <path d="M150 200 v62"/>
    <path d="M150 224 c-26-14-44 2-44 2 c14 16 34 12 44-2 z" fill="{GREEN}"/>
'''

ART['sand'] = f'''
    <path d="M34 234 c26-64 68-102 116-102 s90 38 116 102 z" fill="{CREAM}"/>
    <path d="M34 234 h232"/>
    <g fill="{BROWN}" stroke="none">
      <circle cx="112" cy="200" r="4"/><circle cx="148" cy="180" r="4"/>
      <circle cx="186" cy="204" r="4"/><circle cx="130" cy="224" r="4"/>
      <circle cx="172" cy="228" r="4"/><circle cx="150" cy="208" r="4"/>
    </g>
    <path d="M200 130 l34-52 l18 12 l-34 52 z" fill="{RED}"/>
    <path d="M196 128 h34 v18 h-34 z" fill="{DGRAY}"/>
'''

# ─── 건물·장소 ─────────────────────────────────────────────────
ART['school'] = f'''
    <path d="M50 132 L150 66 l100 66 v112 H50 z" fill="{CREAM}"/>
    <path d="M50 132 L150 66 l100 66" fill="none"/>
    <rect x="128" y="180" width="44" height="64" fill="{DBROWN}"/>
    <rect x="76" y="164" width="34" height="34" rx="4" fill="{SKY}"/>
    <rect x="190" y="164" width="34" height="34" rx="4" fill="{SKY}"/>
    <path d="M150 66 V26"/>
    <path d="M150 30 h40 v24 h-40 z" fill="{RED}"/>
'''

ART['hospital'] = f'''
    <rect x="66" y="72" width="168" height="172" rx="10" fill="{WHITE}"/>
    <path d="M138 96 h24 v22 h22 v24 h-22 v22 h-24 v-22 h-22 v-24 h22 z" fill="{RED}"/>
    <g fill="{SKY}">
      <rect x="90" y="172" width="32" height="32" rx="4"/>
      <rect x="134" y="172" width="32" height="32" rx="4"/>
      <rect x="178" y="172" width="32" height="32" rx="4"/>
    </g>
    <rect x="130" y="212" width="40" height="32" fill="{DGRAY}"/>
'''

ART['pharmacy'] = f'''
    <rect x="66" y="96" width="168" height="148" rx="10" fill="{WHITE}"/>
    <path d="M56 96 h188 l-16-34 H72 z" fill="{GREEN}"/>
    <path d="M138 118 h24 v20 h20 v24 h-20 v20 h-24 v-20 h-20 v-24 h20 z" fill="{GREEN}"/>
    <rect x="96" y="196" width="108" height="48" rx="6" fill="{SKY}"/>
    <path d="M150 196 v48"/>
'''

ART['library'] = f'''
    <rect x="52" y="60" width="196" height="184" rx="10" fill="{BROWN}"/>
    <path d="M52 150 h196" stroke-width="8"/>
    <g stroke="none">
      <rect x="72" y="78" width="22" height="66" fill="{RED}"/>
      <rect x="100" y="86" width="22" height="58" fill="{YELLOW}"/>
      <rect x="128" y="74" width="22" height="70" fill="{GREEN}"/>
      <rect x="156" y="88" width="22" height="56" fill="{SKY}"/>
      <rect x="184" y="78" width="22" height="66" fill="{PURPLE}"/>
      <rect x="72" y="172" width="22" height="60" fill="{PURPLE}"/>
      <rect x="100" y="166" width="22" height="66" fill="{GREEN}"/>
      <rect x="128" y="178" width="22" height="54" fill="{RED}"/>
      <rect x="156" y="168" width="22" height="64" fill="{YELLOW}"/>
      <rect x="184" y="176" width="22" height="56" fill="{SKY}"/>
    </g>
'''

ART['pool'] = f'''
    <rect x="40" y="96" width="220" height="140" rx="14" fill="{SKY}"/>
    <rect x="40" y="96" width="220" height="140" rx="14" fill="none" stroke-width="8"/>
    <g stroke="{WHITE}" stroke-width="7">
      <path d="M56 138 c22-12 44 12 66 0 c22-12 44 12 66 0 c22-12 34 8 56 0"/>
      <path d="M56 178 c22-12 44 12 66 0 c22-12 44 12 66 0 c22-12 34 8 56 0"/>
      <path d="M56 216 c22-12 44 12 66 0 c22-12 44 12 66 0 c22-12 34 8 56 0"/>
    </g>
    <path d="M212 96 v-38"/><path d="M244 96 v-38"/>
    <path d="M212 68 h32"/><path d="M212 84 h32"/>
'''

ART['balloon'] = f'''
    <ellipse cx="150" cy="118" rx="66" ry="80" fill="{RED}"/>
    <path d="M138 198 h24 l-12 18 z" fill="{DEEPRED}"/>
    <path d="M150 216 c22 22-22 34 0 56"/>
    <ellipse cx="124" cy="90" rx="14" ry="20" fill="{WHITE}" stroke="none" opacity="0.55"/>
'''

# ─── 검증 ───────────────────────────────────────────────────────

def main():
    out = os.path.abspath(OUT_DIR)
    existing = {n[:-4] for n in os.listdir(out) if n.endswith('.svg')}
    missing = existing - set(ART)
    extra = set(ART) - existing
    if missing:
        print('ERROR: 기존 자산인데 정의가 없음:', sorted(missing), file=sys.stderr)
        return 1
    if extra:
        print('ERROR: 데이터에 없는 자산 정의:', sorted(extra), file=sys.stderr)
        return 1

    for name, body in sorted(ART.items()):
        svg = HEADER + body.rstrip() + '\n' + FOOTER
        # 규칙 1 자동 검증: 그림에 글자가 있으면 검사가 무효가 된다.
        if '<text' in svg:
            print(f'ERROR: {name} 에 글자가 들어 있음', file=sys.stderr)
            return 1
        with open(os.path.join(out, name + '.svg'), 'w', encoding='utf-8') as fh:
            fh.write(svg)

    print(f'{len(ART)}개 생성 완료 → {out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
