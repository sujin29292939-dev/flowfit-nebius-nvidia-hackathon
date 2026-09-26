// settings/settingsService.ts
// 검증 게이트 + 룰 동기화.
// 잘못된 설정이 정책에 들어가는 경로를 원천 차단하고,
// 검증을 통과한 값에서 파생된 룰을 RuleStore에 자동 반영한다.

import { z } from "zod";
import type { ModuleSetting, Rule } from "../policy/types.js";
import type { RuleStore, SettingStore } from "../policy/stores.js";
import { MODULES, DEFAULTS, type ModuleName } from "./schemas.js";

export interface ValidationOk<T> {
  ok: true;
  value: T;
  rules: Rule[];
}
export interface ValidationErr {
  ok: false;
  issues: Array<{ path: string; message: string }>;
}
export type ValidationResult<T = unknown> = ValidationOk<T> | ValidationErr;

function formatIssues(err: z.ZodError): ValidationErr {
  return {
    ok: false,
    issues: err.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    })),
  };
}

export class SettingsService {
  /** module → 그 모듈이 만든 룰 id 집합 (재적용 시 정리용) */
  private ownedRuleIds = new Map<ModuleName, Set<string>>();

  constructor(
    private settings: SettingStore,
    private rules: RuleStore,
  ) {}

  /** 검증만 (적용 안 함) */
  validate(module: ModuleName, values: unknown): ValidationResult {
    const def = MODULES[module];
    const parsed = def.schema.safeParse(values);
    if (!parsed.success) return formatIssues(parsed.error);
    const derived = def.toRules(parsed.data as never);
    return { ok: true, value: parsed.data, rules: derived };
  }

  /**
   * 검증 통과 시에만 설정 저장 + 파생 룰 동기화.
   * 이전에 이 모듈이 만든 룰은 비활성화하고 새 룰로 교체한다.
   */
  apply(
    module: ModuleName,
    values: unknown,
    updatedBy: string,
  ): ValidationResult {
    const result = this.validate(module, values);
    if (!result.ok) return result;

    const def = MODULES[module];
    const now = new Date().toISOString();

    // 1) 설정 저장 (검증된 값만)
    const setting: ModuleSetting = {
      module,
      title: def.title,
      values: result.value as Record<string, number | string | boolean>,
      updatedBy,
      updatedAt: now,
    };
    this.settings.upsert(setting);

    // 2) 이전 소유 룰 비활성화
    const prev = this.ownedRuleIds.get(module) ?? new Set<string>();
    for (const id of prev) this.rules.setStatus(id, "disabled");

    // 3) 새 룰 등록 + 소유 집합 갱신
    const newIds = new Set<string>();
    for (const r of result.rules) {
      this.rules.upsert({ ...r, updatedBy, updatedAt: now });
      newIds.add(r.id);
    }
    this.ownedRuleIds.set(module, newIds);

    return result;
  }

  /**
   * 채팅 ai_card_settings_update.patch 적용.
   * 기존 값에 patch를 머지한 뒤 전체를 재검증한다(부분 변경도 전체 검증).
   */
  applyPatch(
    module: ModuleName,
    patch: Record<string, unknown>,
    updatedBy: string,
  ): ValidationResult {
    const current = this.settings.get(module)?.values ?? (DEFAULTS[module] as Record<string, unknown>);
    return this.apply(module, { ...current, ...patch }, updatedBy);
  }

  /** 기본값으로 초기화 (전 모듈) */
  applyDefaults(updatedBy = "system"): void {
    (Object.keys(MODULES) as ModuleName[]).forEach((m) =>
      this.apply(m, DEFAULTS[m], updatedBy),
    );
  }

  ruleIdsOwnedBy(module: ModuleName): string[] {
    return [...(this.ownedRuleIds.get(module) ?? [])];
  }
}
