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

import type { ChangeKind, DecisionOutcome, Severity, SpecOutcome } from "@/lib/types";

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

export const DECISION_LABEL: Dict<DecisionOutcome> = {
  ja: {
    accept: "受入",
    reject: "差戻し",
    conditional_accept: "条件付き受入",
  },
  en: {
    accept: "Accept",
    reject: "Reject",
    conditional_accept: "Conditional accept",
  },
};

export const DECISION_COPY = {
  ja: {
    title: "判定を記録",
    description: "このランに対する結論と、その根拠を記録します。記録後も履歴は変更されません。",
    rationale: "判定理由",
    rationaleHint: "コンサルタントに説明できる具体的な理由を入力してください。",
    citedFindings: "根拠として引用する指摘",
    citeFinding: "この指摘を引用",
    removeCitation: "引用を外す",
    requiredCitation: "条件付き受入には少なくとも1件の指摘が必要です。",
    submit: "判定を記録",
    supersede: "現在の判定を更新",
    current: "現在の判定",
    history: "判定履歴",
    noDecision: "まだ判定は記録されていません。",
    evidence: "判定の根拠",
    run: "ラン",
    pack: "チェックパック",
    engine: "エンジン",
    provenance: "入力来歴",
    export: "記録を保存",
    copied: "保存しました",
  },
  en: {
    title: "Record decision",
    description: "Record the conclusion for this run and the rationale a submitter can inspect. History stays intact.",
    rationale: "Rationale",
    rationaleHint: "State a concrete reason you can explain to the consultant.",
    citedFindings: "Findings cited as evidence",
    citeFinding: "Cite this finding",
    removeCitation: "Remove citation",
    requiredCitation: "Conditional accept requires at least one cited finding.",
    submit: "Record decision",
    supersede: "Update current decision",
    current: "Current decision",
    history: "Decision history",
    noDecision: "No decision has been recorded yet.",
    evidence: "Decision evidence",
    run: "Run",
    pack: "Check pack",
    engine: "Engine",
    provenance: "Input provenance",
    export: "Download record",
    copied: "Saved",
  },
} as const;

export const LOCALE_LABEL: Dict<Locale> = {
  ja: { ja: "日本語", en: "English" },
  en: { ja: "Japanese", en: "English" },
};
export const LOCALE_GROUP_LABEL: Record<Locale, string> = { ja: "表示言語", en: "Display language" };

export const DELIVERY_COPY = {
  ja: {
    finalizeTitle: "納品を確定しますか？",
    finalizeDescription: "確定後はモデル構成を変更できません。この操作は判定履歴の対象となる納品を固定します。",
    finalizeCancel: "キャンセル",
    finalizeConfirm: "納品を確定",
    viewMode: "表示モード",
    deskView: "作業",
    meetingView: "会議",
    meetingReview: "会議レビュー",
  },
  en: {
    finalizeTitle: "Finalize this delivery?",
    finalizeDescription: "Finalizing freezes its model membership. You cannot change the source revisions afterward.",
    finalizeCancel: "Cancel",
    finalizeConfirm: "Finalize delivery",
    viewMode: "View mode",
    deskView: "Desk",
    meetingView: "Meeting",
    meetingReview: "Meeting review",
  },
} as const;

export const VIEWER_COPY = {
  ja: {
    deliveryUnavailable: "デリバリーを開けません",
    retry: "再試行",
    loadingDelivery: "デリバリーを読み込み中",
    sourceCount: (count: number) => `${count}ソース`,
    combinedView: "結合ビュー",
    preparingOrigin: "共通原点を準備中",
    fitAll: "全体表示",
    sources: "ソース",
    readyCount: (ready: number, total: number) => `${total}件中${ready}件を読み込み済み`,
    visibility: "表示",
    canvasLabel: "結合IFCモデルビューア",
    touchHelp: "ドラッグ: 回転 · ピンチ: ズーム · 2本指: 移動",
    pointerHelp: "ドラッグ: 回転 · 右ドラッグ: 移動 · スクロール: ズーム",
    keyboardHelp: "矢印: 移動 · +/−: ズーム · Home: 全体表示",
    origin: "原点",
    pending: "準備中",
    inspectorPanels: "詳細パネル",
    selection: "選択",
    findings: "指摘",
    objectIdentity: "リビジョンを含むオブジェクト識別子",
    revisionId: "リビジョンID",
    objectId: "オブジェクトID",
    globalId: "GlobalId",
    ifcType: "IFCタイプ",
    name: "名称",
    placedGeometry: "配置ジオメトリ",
    frameSelection: "選択を表示",
    noSelection: "モデルのジオメトリを選択すると、オブジェクト識別子とソース情報を確認できます。",
    notProvided: "未登録",
    unnamed: "名称なし",
    downloading: "ダウンロード中",
    parsing: "解析中",
    preparingGeometry: "ジオメトリ準備中",
    uploading: "GPUへ転送中",
    ready: "読み込み済み",
    failed: "読み込み失敗",
    unloaded: "解放済み",
    queued: "待機中",
  },
  en: {
    deliveryUnavailable: "Delivery unavailable",
    retry: "Retry",
    loadingDelivery: "Loading delivery",
    sourceCount: (count: number) => `${count} ${count === 1 ? "source" : "sources"}`,
    combinedView: "Combined view",
    preparingOrigin: "Preparing shared origin",
    fitAll: "Fit all",
    sources: "Sources",
    readyCount: (ready: number, total: number) => `${ready} of ${total} ready`,
    visibility: "Visibility",
    canvasLabel: "Combined IFC model viewer",
    touchHelp: "Drag: orbit · Pinch: zoom · Two-finger drag: pan",
    pointerHelp: "Drag: orbit · Right-drag: pan · Scroll: zoom",
    keyboardHelp: "Arrows: pan · +/−: zoom · Home: fit all",
    origin: "Origin",
    pending: "Pending",
    inspectorPanels: "Inspector panels",
    selection: "Selection",
    findings: "Findings",
    objectIdentity: "Revision-qualified object identity",
    revisionId: "Revision ID",
    objectId: "Object ID",
    globalId: "GlobalId",
    ifcType: "IFC type",
    name: "Name",
    placedGeometry: "Placed geometry",
    frameSelection: "Frame selection",
    noSelection: "Select model geometry to inspect its object identity and source metadata.",
    notProvided: "Not provided",
    unnamed: "Unnamed",
    downloading: "Downloading",
    parsing: "Parsing",
    preparingGeometry: "Preparing geometry",
    uploading: "Uploading to GPU",
    ready: "Ready",
    failed: "Failed",
    unloaded: "Unloaded",
    queued: "Queued",
  },
} as const;

export const REVIEW_COPY = {
  ja: {
    loadingRun: "ランの指摘を読み込み中",
    runUnavailable: "ランを読み込めません",
    selectRun: "指摘を確認するランを選択してください。",
  },
  en: {
    loadingRun: "Loading run findings",
    runUnavailable: "Run could not be loaded",
    selectRun: "Select a run to review its findings.",
  },
} as const;

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
    inputsLabel: "入力モデル",
    inputsPinnedLabel: "入力モデル(固定済み)",
    totalsHeading: "結果サマリー",
    ruleTotals: "ルール件数",
    distinctObjects: "影響オブジェクト (重複除く)",
    notApplicable: "対象外",
    incomplete: "未判定",
    pass: "合格",
    fail: "不合格",
    expectedAbsent: "期待値は記載なし",
    instructionsAbsent: "指示は記載なし",
    scopeHeading: "適用範囲",
    noMatchScope: "この要件に当てはまるモデル要素がなく、対象外として判定されました。",
    membersWithoutGeometry: "ジオメトリなしのメンバー",
    malformedMembers: "一部のメンバーメタデータが不正なため、表示できる接頭辞のみ描画しています。",
    retry: "再試行",
    newRun: "新規ラン",
    runLabel: "ラン",
    packLabel: "チェックパック",
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
    inputsLabel: "Inputs",
    inputsPinnedLabel: "Inputs (pinned)",
    totalsHeading: "Results",
    ruleTotals: "Rules",
    distinctObjects: "Affected objects (distinct)",
    notApplicable: "Not applicable",
    incomplete: "Incomplete",
    pass: "Pass",
    fail: "Fail",
    expectedAbsent: "Expected value not stated",
    instructionsAbsent: "No instructions stated",
    scopeHeading: "Scope",
    noMatchScope: "No model elements matched this requirement, so it was judged not applicable.",
    membersWithoutGeometry: "Members without geometry",
    malformedMembers: "Some member metadata is malformed; rendering the valid prefix only.",
    retry: "Retry",
    newRun: "New run",
    runLabel: "Run",
    packLabel: "Check pack",
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

export function copy(entry: { readonly ja: string; readonly en: string }, locale: Locale): string {
  return entry[locale];
}
