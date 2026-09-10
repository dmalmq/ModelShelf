// Review-screen copy. Short JA/EN pairs sized for ~1.6x EN/JA length variance:
// layout must not assume either language fits first. Severity and outcome JA
// labels reuse the shared mock dictionaries so wording never forks.
import { OUTCOME_LABEL_JA, SEVERITY_LABEL_JA } from "@/lib/mock";
import type { Severity, SpecOutcome } from "@/lib/types";

export const SEVERITY_SHORT_EN: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  advisory: "Advisory",
};

export const OUTCOME_SHORT_EN: Record<SpecOutcome, string> = {
  pass: "Pass",
  fail: "Fail",
  not_applicable: "N/A",
  review_incomplete: "Incomplete",
};

export function severityLabel(severity: Severity, lang: "ja" | "en"): string {
  return lang === "ja" ? SEVERITY_LABEL_JA[severity] : SEVERITY_SHORT_EN[severity];
}

export function outcomeLabel(outcome: SpecOutcome, lang: "ja" | "en"): string {
  return lang === "ja" ? OUTCOME_LABEL_JA[outcome] : OUTCOME_SHORT_EN[outcome];
}

export const REVIEW_COPY = {
  totalsHeading: { ja: "結果サマリー", en: "Results" },
  ruleTotals: { ja: "ルール件数", en: "Rules" },
  distinctObjects: { ja: "影響オブジェクト (重複除く)", en: "Affected objects (distinct)" },
  notApplicable: { ja: "対象外", en: "Not applicable" },
  incomplete: { ja: "未判定", en: "Incomplete" },
  pass: { ja: "合格", en: "Pass" },
  fail: { ja: "不合格", en: "Fail" },
  incompleteNotice: {
    ja: "レビュー未判定 — エンジンはこの要件を判定できませんでした。合格には数えません。",
    en: "Review incomplete — the engine could not decide this requirement. This is never counted as a pass.",
  },
  expectedAbsent: { ja: "期待値は記載なし", en: "Expected value not stated" },
  instructionsAbsent: { ja: "指示は記載なし", en: "No instructions stated" },
  scopeHeading: { ja: "適用範囲", en: "Scope" },
  noMatchScope: {
    ja: "この要件に当てはまるモデル要素がなく、対象外として判定されました。",
    en: "No model elements matched this requirement, so it was judged not applicable.",
  },
  membersWithoutGeometry: { ja: "ジオメトリなしのメンバー", en: "Members without geometry" },
  malformedMembers: {
    ja: "一部のメンバーメタデータが不正なため、表示できる接頭辞のみ描画しています。",
    en: "Some member metadata is malformed; rendering the valid prefix only.",
  },
  retry: { ja: "再試行", en: "Retry" },
  newRun: { ja: "新規ラン", en: "New run" },
  runLabel: { ja: "ラン", en: "Run" },
  packLabel: { ja: "チェックパック", en: "Check pack" },
  sectionZ: { ja: "断面 Z (m)", en: "Section Z (m)" },
  sectionZInputLabel: { ja: "断面 Z メートル", en: "Section Z metres" },
  sectionActive: { ja: "適用中", en: "active" },
  inspectSelection: { ja: "選択オブジェクトの属性を表示", en: "Inspect selection properties" },
  noOccurrence: {
    ja: "このメンバーには照会できるモデル出現がありません。",
    en: "This finding member has no model occurrence to inspect.",
  },
  propertyError: { ja: "オブジェクト属性を読み込めませんでした", en: "Object properties could not be loaded" },
  propertyType: { ja: "タイプ", en: "Type" },
  propertyName: { ja: "名称", en: "Name" },
  propertyStorey: { ja: "階", en: "Storey" },
  unnamed: { ja: "名称なし", en: "Unnamed" },
  noValue: { ja: "—", en: "—" },
  propertyTypeOrigin: { ja: " (型)", en: " (type)" },
} as const;

export type ReviewLang = "ja" | "en";

export function copy(entry: { ja: string; en: string }, lang: ReviewLang): string {
  return lang === "ja" ? entry.ja : entry.en;
}
