// policy/stores.ts
// 룰 메모리 + 모듈 설정 저장소.
// 운영에서는 메모리 대신 DB(룰: append-only, 설정: 버전드)로 교체.

import type { Rule, ModuleSetting, RuleScope } from "./types.js";

export class RuleStore {
  private rules = new Map<string, Rule>();

  upsert(rule: Rule): void {
    this.rules.set(rule.id, rule);
  }

  setStatus(id: string, status: Rule["status"]): boolean {
    const r = this.rules.get(id);
    if (!r) return false;
    r.status = status;
    return true;
  }

  list(): Rule[] {
    return [...this.rules.values()];
  }

  /** scope에 해당하는 active 룰을 priority 내림차순으로 */
  activeFor(actionType: string): Rule[] {
    return this.list()
      .filter((r) => r.status === "active")
      .filter((r) => r.scope === "*" || r.scope === actionType)
      .sort((a, b) => b.priority - a.priority);
  }

  /** 전체 active 룰 (전역 컴파일용) */
  allActive(): Rule[] {
    return this.list()
      .filter((r) => r.status === "active")
      .sort((a, b) => b.priority - a.priority);
  }
}

export class SettingStore {
  private settings = new Map<string, ModuleSetting>();

  upsert(setting: ModuleSetting): void {
    this.settings.set(setting.module, setting);
  }

  get(module: string): ModuleSetting | undefined {
    return this.settings.get(module);
  }

  list(): ModuleSetting[] {
    return [...this.settings.values()];
  }

  /** 설정값 단축 조회 */
  value(module: string, key: string): number | string | boolean | undefined {
    return this.settings.get(module)?.values[key];
  }
}

/** scope 매칭 헬퍼 (외부 노출용) */
export function scopeMatches(scope: RuleScope, actionType: string): boolean {
  return scope === "*" || scope === actionType;
}
