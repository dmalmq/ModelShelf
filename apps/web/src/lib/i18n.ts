/**
 * UI copy, in both languages the product ships.
 *
 * Japanese is the default. English is a first-class alternative, not a
 * fallback — the same reviewer may work in Japanese and present the result to
 * an English-speaking stakeholder.
 *
 * These label maps previously lived in `lib/mock.ts`. That was the wrong home:
 * mock data is disposable fixture content, product copy is not, and a component
 * that imports its labels from a fixtures file cannot ship.
 *
 * Every string here has a counterpart in the other language. Adding a term to
 * one map without the other is a type error, which is the point.
 */

import type { ChangeKind, Severity, SpecOutcome } from "@/lib/types";

export type Locale = "ja" | "en";

/** Japanese is the default UI language. */
export const DEFAULT_LOCALE: Locale = "ja";

/**
 * Not a `Severity`. The API models review-incomplete as an outcome, not a
 * severity band, and it must never be ranked against the four. It appears here
 * because a reviewer still needs a word for it.
 */
export type FindingLevel = Severity | "review_incomplete";

type Dict<K extends string> = Record<Locale, Record<K, string>>;

export const SEVERITY_LABEL: Dict<FindingLevel> = {
  ja: {
    critical: "重大",
    high: "高",
    medium: "中",
    advisory: "参考",
    review_incomplete: "未判定",
  },
  en: {
    critical: "Critical",
    high: "High",
    medium: "Medium",
    advisory: "Advisory",
    review_incomplete: "Undecided",
  },
};

export const OUTCOME_LABEL: Dict<SpecOutcome> = {
  ja: {
    pass: "合格",
    fail: "不合格",
    not_applicable: "対象外",
    review_incomplete: "未判定",
  },
  en: {
    pass: "Pass",
    fail: "Fail",
    not_applicable: "Not applicable",
    review_incomplete: "Undecided",
  },
};

export const CHANGE_LABEL: Dict<ChangeKind> = {
  ja: {
    added: "追加",
    removed: "削除",
    unchanged: "変更なし",
    moved: "移動",
    shape_changed: "形状変更",
    properties_changed: "属性変更",
    mixed: "複合",
  },
  en: {
    added: "Added",
    removed: "Removed",
    unchanged: "Unchanged",
    moved: "Moved",
    shape_changed: "Shape changed",
    properties_changed: "Properties changed",
    mixed: "Multiple changes",
  },
};

/** Phrases the domain components need beyond the enum labels. */
export const UI = {
  ja: {
    noFindingsOfLevel: (levels: string) => `${levels}の指摘はありません。`,
    noFindingsAtAll: "この納品に指摘はありません。",
    findingCount: (n: number) => `${n}件`,
    objectCount: (n: number) => `${n.toLocaleString()}オブジェクト`,
    checkCount: (n: number) => `${n}チェック`,
    notAPass: "合格ではありません",
    evaluated: (n: number) => `${n}件を評価しました。`,
    didNotApply: (n: number) => `${n}件は対象外でした。`,
    nothingEvaluated: "評価された要件はありません。",
    provenanceTitle: "入力モデルの来歴: 未確定",
    provenanceShort: "再構成 — 未固定",
    provenancePinned: "固定済み",
  },
  en: {
    noFindingsOfLevel: (levels: string) => `No ${levels} findings in this delivery.`,
    noFindingsAtAll: "No findings in this delivery.",
    findingCount: (n: number) => `${n} ${n === 1 ? "finding" : "findings"}`,
    objectCount: (n: number) => `${n.toLocaleString()} ${n === 1 ? "object" : "objects"}`,
    checkCount: (n: number) => `${n} ${n === 1 ? "check" : "checks"}`,
    notAPass: "not a pass",
    evaluated: (n: number) => `${n} ${n === 1 ? "requirement was" : "requirements were"} evaluated.`,
    didNotApply: (n: number) => `${n} did not apply.`,
    nothingEvaluated: "No requirements were evaluated.",
    provenanceTitle: "Inputs reconstructed, not pinned",
    provenanceShort: "Reconstructed — not pinned",
    provenancePinned: "Pinned",
  },
} satisfies Record<Locale, Record<string, string | ((n: never) => string)>>;

/**
 * Joins a list of terms the way each language does it. Japanese uses the
 * middle dot and no conjunction; English needs "or" before the last item.
 * Getting this wrong is the kind of thing that reads as machine translation.
 */
export function joinTerms(terms: string[], locale: Locale): string {
  if (locale === "ja") return terms.join("・");
  if (terms.length <= 1) return terms[0] ?? "";
  return `${terms.slice(0, -1).join(", ")} or ${terms[terms.length - 1]}`;
}
