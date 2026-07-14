import { Injectable } from '@nestjs/common';
import {
  FAMILY_RELATION_LABELS,
  PLACE_TOKEN_LABEL,
} from '../constants/profile.constants';
import type {
  IPersonaContextService,
  PersonaContextResult,
} from '../interfaces/IPersonaContextService';
import { ProfileService, type PersonaSource } from '../profile.service';

/** 실명 → 토큰 치환쌍 (긴 실명 우선 치환을 위해 정렬해 사용) */
interface ReplacePair {
  realName: string;
  token: string;
}

/**
 * 페르소나 컨텍스트 서비스.
 *
 * - 외부 LLM에는 실명 대신 관계/장소 토큰([아들1], [장소1])만 전달한다.
 * - 환자 표시 직전 토큰을 실명으로 역치환한다.
 * - 매핑은 프로필로부터 결정적으로 생성되어, 치환·역치환 시점이 달라도 일치한다.
 */
@Injectable()
export class PersonaContextService implements IPersonaContextService {
  constructor(private readonly profileService: ProfileService) {}

  async buildPersonaContext(
    patientId: string,
    baseContext: string,
  ): Promise<PersonaContextResult> {
    const source = await this.profileService.getPersonaSource(patientId);
    if (!source) {
      // 프로필 미등록 → 개인화 생략(무중단)
      return { tokenizedContext: baseContext, tokenMap: {} };
    }

    const { tokenMap, pairs } = this.buildMappings(source);

    // 실명을 길이 내림차순으로 치환(부분 문자열 오치환 방지)
    const sorted = [...pairs].sort(
      (a, b) => b.realName.length - a.realName.length,
    );
    let tokenized = baseContext;
    for (const { realName, token } of sorted) {
      if (realName) {
        tokenized = tokenized.split(realName).join(token);
      }
    }

    // 프로필 배경 부가 (직업·취미는 PII가 아니므로 평문, 고향은 장소 토큰)
    const background = this.buildBackground(source, pairs);
    const assembled = background ? `${tokenized}\n${background}` : tokenized;

    // 안전망(계획서 6-1 최우선 위험): 배경 부가 등으로 실명이 최종 컨텍스트에
    // 다시 섞였을 수 있으므로, LLM에 넘기기 직전 한 번 더 실명을 토큰으로 봉합한다.
    // 이 시점 이후 tokenizedContext에는 등록된 어떤 실명도 남지 않음을 보장한다.
    const tokenizedContext = this.sealRealNames(assembled, sorted);

    return { tokenizedContext, tokenMap };
  }

  /**
   * 최종 컨텍스트에서 등록된 실명이 남아있으면 토큰으로 재치환한다.
   * 외부 LLM으로의 PII 유출을 막는 마지막 방어선.
   */
  private sealRealNames(context: string, pairs: ReplacePair[]): string {
    let sealed = context;
    for (const { realName, token } of pairs) {
      if (realName && sealed.includes(realName)) {
        sealed = sealed.split(realName).join(token);
      }
    }
    return sealed;
  }

  async buildTokenMap(patientId: string): Promise<Record<string, string>> {
    const source = await this.profileService.getPersonaSource(patientId);
    if (!source) {
      return {};
    }
    return this.buildMappings(source).tokenMap;
  }

  tokenizeWithMap(text: string, tokenMap: Record<string, string>): string {
    const pairs: ReplacePair[] = Object.entries(tokenMap).map(
      ([token, realName]) => ({ token, realName }),
    );
    if (pairs.length === 0 || !text) {
      return text;
    }
    // 긴 실명 우선(부분 문자열 오치환 방지) — sealRealNames가 정렬 없이도
    // 전부 봉합하지만, 여기서 순서를 지켜야 "영희"가 "영희자"를 깨지 않는다.
    const sorted = [...pairs].sort(
      (a, b) => b.realName.length - a.realName.length,
    );
    let tokenized = text;
    for (const { realName, token } of sorted) {
      if (realName) {
        tokenized = tokenized.split(realName).join(token);
      }
    }
    return tokenized;
  }

  restorePersonaText(
    tokenizedText: string,
    tokenMap: Record<string, string>,
  ): string {
    let restored = tokenizedText;

    // 매핑된 토큰을 실명으로 복원 (긴 토큰 우선)
    const tokens = Object.keys(tokenMap).sort((a, b) => b.length - a.length);
    for (const token of tokens) {
      restored = restored.split(token).join(tokenMap[token]);
    }

    // 미매핑 토큰 폴백: [라벨숫자] → 라벨 (토큰이 환자에게 노출되지 않게)
    restored = restored.replace(/\[([가-힣]+?)\d*\]/g, '$1');

    return restored;
  }

  // ─── 내부 헬퍼 ────────────────────────────────────────────────

  /**
   * 프로필 소스로부터 token↔realName 매핑을 결정적으로 생성한다.
   * - 가족: [관계라벨+서수] (예: [아들1])
   * - 장소: [장소+서수] (hometown 먼저, 이후 significantPlaces 순)
   */
  private buildMappings(source: PersonaSource): {
    tokenMap: Record<string, string>;
    pairs: ReplacePair[];
  } {
    const tokenMap: Record<string, string> = {};
    const pairs: ReplacePair[] = [];
    const seenRealNames = new Set<string>();

    const register = (realName: string, token: string): void => {
      const name = realName.trim();
      if (!name || seenRealNames.has(name)) {
        return;
      }
      tokenMap[token] = name;
      pairs.push({ realName: name, token });
      seenRealNames.add(name);
    };

    // 가족
    for (const m of source.family) {
      const label = FAMILY_RELATION_LABELS[m.relation] ?? '가족';
      register(m.name, `[${label}${m.relationOrdinal}]`);
    }

    // 장소: 고향 + 의미있는 장소
    const places: string[] = [];
    if (source.hometown) places.push(source.hometown);
    for (const p of source.significantPlaces) places.push(p);
    let placeOrdinal = 0;
    for (const place of places) {
      if (place?.trim() && !seenRealNames.has(place.trim())) {
        placeOrdinal += 1;
        register(place, `[${PLACE_TOKEN_LABEL}${placeOrdinal}]`);
      }
    }

    return { tokenMap, pairs };
  }

  /** 직업·취미·고향을 LLM 컨텍스트용 배경 문장으로 구성 */
  private buildBackground(
    source: PersonaSource,
    pairs: ReplacePair[],
  ): string {
    const parts: string[] = [];
    if (source.occupation?.trim()) {
      parts.push(`직업은 ${source.occupation.trim()}`);
    }
    const hobbies = source.hobbies.filter((h) => h?.trim());
    if (hobbies.length > 0) {
      parts.push(`취미는 ${hobbies.join(', ')}`);
    }
    if (source.hometown?.trim()) {
      const hometownToken = pairs.find(
        (p) => p.realName === source.hometown!.trim(),
      )?.token;
      if (hometownToken) {
        parts.push(`고향은 ${hometownToken}`);
      }
    }
    return parts.length > 0 ? `배경: ${parts.join(', ')}.` : '';
  }
}
