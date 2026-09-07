// Design-alternative fixture data. Every number below traces to the real
// evaluation of the BLCJ S1000 demo pack against the real GLOOBE/Rebro exports
// (packs/demo/checks.md, .omo/evidence/modelshelf-prototype/task-5/). Japanese
// property and object names are the ones actually present in those IFC files.
// This file exists so the three design routes render one identical dataset —
// the designs differ in presentation, never in facts.

import type { ChangeKind, Severity, SpecOutcome } from "@/lib/types";

export const SEVERITY_LABEL_JA: Record<Severity, string> = {
  critical: "重大",
  high: "高",
  medium: "中",
  advisory: "参考",
};

export const OUTCOME_LABEL_JA: Record<SpecOutcome, string> = {
  pass: "合格",
  fail: "不合格",
  not_applicable: "対象外",
  review_incomplete: "未判定",
};

export const CHANGE_LABEL_JA: Record<ChangeKind, string> = {
  added: "追加",
  removed: "削除",
  unchanged: "変更なし",
  moved: "移動",
  shape_changed: "形状変更",
  properties_changed: "属性変更",
  mixed: "複合",
};

export const PROJECT = {
  name: "BLCJ S1000 標準モデル棟",
  client: "発注者側BIMレビュー",
} as const;

export const PACK = {
  name: "BLCJ S1000 デモパック",
  version: 2,
  specCount: 11,
  idsSha256: "70cc8ff2a1b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d",
} as const;

export const DELIVERY = {
  label: "第3回納品",
  date: "2026-08-28",
  finalized: true,
} as const;

export const RUN = {
  id: "run_2026-08-29T09:14",
  engineVersion: "IfcOpenShell 0.8.3 / IfcTester 0.8.3",
  parserVersion: "web-ifc 0.0.77",
  startedAt: "2026-08-29T09:14:02Z",
  durationMs: 47_300,
  passCount: 2279,
  failCount: 241,
  notApplicableCount: 312,
  incompleteCount: 3,
} as const;

export interface MockModel {
  id: string;
  name: string;
  discipline: "ARCH" | "STRUCT" | "MEP";
  authoringTool: string;
  revision: number;
  objectCount: number;
  reusedFromPrevious: boolean;
}

export const MODELS: MockModel[] = [
  { id: "m-arch", name: "建築", discipline: "ARCH", authoringTool: "GLOOBE", revision: 4, objectCount: 3014, reusedFromPrevious: false },
  { id: "m-struct", name: "構造", discipline: "STRUCT", authoringTool: "GLOOBE", revision: 2, objectCount: 2184, reusedFromPrevious: true },
  { id: "m-mep", name: "設備", discipline: "MEP", authoringTool: "Rebro", revision: 5, objectCount: 322, reusedFromPrevious: false },
];

export interface MockFindingObject {
  expressId: number;
  ifcType: string;
  name: string;
  storey: string;
  model: string;
  actual: string;
}

export interface MockFinding {
  id: string;
  severity: Severity;
  category: string;
  title: string;
  requirement: string;
  expected: string;
  objectCount: number;
  passCount: number;
  applicableCount: number;
  incomplete: boolean;
  objects: MockFindingObject[];
}

export const FINDINGS: MockFinding[] = [
  {
    id: "f-fire",
    severity: "high",
    category: "法規(防火区画)",
    title: "建具に防火性能が設定されていない",
    requirement: "Pset_DoorCommon.FireRating / Pset_WindowCommon.FireRating",
    expected: "防火性能の宣言(例: 甲種防火戸)",
    objectCount: 78,
    passCount: 0,
    applicableCount: 78,
    incomplete: false,
    objects: [
      { expressId: 10231, ifcType: "IfcDoor", name: "SD-04 片開き", storey: "3F", model: "建築", actual: "(プロパティなし)" },
      { expressId: 10287, ifcType: "IfcDoor", name: "SD-04 片開き", storey: "3F", model: "建築", actual: "(プロパティなし)" },
      { expressId: 11054, ifcType: "IfcWindow", name: "FIX窓 W1200", storey: "2F", model: "建築", actual: "(プロパティなし)" },
      { expressId: 10412, ifcType: "IfcDoor", name: "FD-01 防火戸", storey: "1F", model: "建築", actual: "(プロパティなし)" },
    ],
  },
  {
    id: "f-room-ref",
    severity: "high",
    category: "識別",
    title: "部屋に参照コードがない",
    requirement: "Pset_SpaceCommon.Reference",
    expected: "室番号・ゾーンコード(図面凡例との照合キー)",
    objectCount: 30,
    passCount: 30,
    applicableCount: 60,
    incomplete: false,
    objects: [
      { expressId: 8841, ifcType: "IfcSpace", name: "会議室A", storey: "3F", model: "建築", actual: "Reference = (空)" },
      { expressId: 8862, ifcType: "IfcSpace", name: "廊下", storey: "3F", model: "建築", actual: "Reference = (空)" },
      { expressId: 8901, ifcType: "IfcSpace", name: "事務室", storey: "2F", model: "建築", actual: "Reference = (空)" },
    ],
  },
  {
    id: "f-slab",
    severity: "high",
    category: "構造",
    title: "建築モデルのスラブが耐力フラグ未設定",
    requirement: "Pset_SlabCommon.LoadBearing = true",
    expected: "LoadBearing = true",
    objectCount: 10,
    passCount: 17,
    applicableCount: 27,
    incomplete: false,
    objects: [
      { expressId: 22110, ifcType: "IfcSlab", name: "床スラブ t=150", storey: "2F", model: "建築", actual: "LoadBearing = (未設定)" },
      { expressId: 22144, ifcType: "IfcSlab", name: "床スラブ t=150", storey: "3F", model: "建築", actual: "LoadBearing = (未設定)" },
    ],
  },
  {
    id: "f-column",
    severity: "medium",
    category: "構造",
    title: "建築モデルの柱が耐力フラグ・部材記号なし",
    requirement: "Pset_ColumnCommon.LoadBearing / .Reference",
    expected: "LoadBearing = true かつ部材記号(例: 1C2)",
    objectCount: 12,
    passCount: 81,
    applicableCount: 93,
    incomplete: false,
    objects: [
      { expressId: 15302, ifcType: "IfcColumn", name: "RC柱 600×600", storey: "1F", model: "建築", actual: "Reference = (空)" },
      { expressId: 15319, ifcType: "IfcColumn", name: "RC柱 600×600", storey: "2F", model: "建築", actual: "Reference = (空)" },
    ],
  },
  {
    id: "f-dw-ref",
    severity: "medium",
    category: "トレーサビリティ",
    title: "建具にスケジュール参照がない",
    requirement: "Pset_DoorCommon.Reference / Pset_WindowCommon.Reference",
    expected: "建具表との照合コード",
    objectCount: 4,
    passCount: 74,
    applicableCount: 78,
    incomplete: false,
    objects: [
      { expressId: 11201, ifcType: "IfcWindow", name: "パネル窓 W800", storey: "3F", model: "建築", actual: "Reference = (空)" },
      { expressId: 11203, ifcType: "IfcWindow", name: "パネル窓 W800", storey: "3F", model: "建築", actual: "Reference = (空)" },
    ],
  },
  {
    id: "f-duct-od",
    severity: "advisory",
    category: "データ網羅性",
    title: "フローセグメントに外径が記録されていない",
    requirement: "Rebro_PartsData.外径[mm] (v2: ケーブルラックを除く)",
    expected: "外径[mm] の数値",
    objectCount: 107,
    passCount: 1187,
    applicableCount: 1294,
    incomplete: false,
    objects: [
      { expressId: 55210, ifcType: "IfcFlowSegment", name: "給水管 VP25", storey: "2F", model: "設備", actual: "外径[mm] = (なし)" },
      { expressId: 55388, ifcType: "IfcFlowSegment", name: "空調ダクト 300×300", storey: "3F", model: "設備", actual: "外径[mm] = (なし)" },
      { expressId: 55601, ifcType: "IfcFlowSegment", name: "排水管 VU75", storey: "1F", model: "設備", actual: "外径[mm] = (なし)" },
    ],
  },
];

/** The engine could not decide these — never folded into pass. */
export const INCOMPLETE_FINDING: MockFinding = {
  id: "f-incomplete",
  severity: "medium",
  category: "分類",
  title: "ケーブルラックの用途分類を判定できない",
  requirement: "Rebro_PartsData.用途",
  expected: "用途分類(電気・通信 等)",
  objectCount: 3,
  passCount: 0,
  applicableCount: 3,
  incomplete: true,
  objects: [
    { expressId: 60012, ifcType: "IfcFlowSegment", name: "電気.ケーブルラック", storey: "2F", model: "設備", actual: "データ型を解決できず" },
    { expressId: 60013, ifcType: "IfcFlowSegment", name: "電気.ケーブルラック", storey: "2F", model: "設備", actual: "データ型を解決できず" },
    { expressId: 60018, ifcType: "IfcFlowSegment", name: "電気.ケーブルラック", storey: "3F", model: "設備", actual: "データ型を解決できず" },
  ],
};

export interface MockSpecRow {
  name: string;
  outcome: SpecOutcome;
  applicable: number;
  pass: number;
  fail: number;
  incomplete: number;
}

export const SPEC_ROWS: MockSpecRow[] = [
  { name: "部屋は参照コードを持つ", outcome: "fail", applicable: 60, pass: 30, fail: 30, incomplete: 0 },
  { name: "部屋は純床面積を記録する", outcome: "pass", applicable: 60, pass: 60, fail: 0, incomplete: 0 },
  { name: "部屋は天井高を記録する", outcome: "pass", applicable: 60, pass: 60, fail: 0, incomplete: 0 },
  { name: "建具はスケジュール参照を持つ", outcome: "fail", applicable: 78, pass: 74, fail: 4, incomplete: 0 },
  { name: "建具は防火性能を宣言する", outcome: "fail", applicable: 78, pass: 0, fail: 78, incomplete: 0 },
  { name: "構造柱は耐力フラグを持つ", outcome: "fail", applicable: 164, pass: 152, fail: 12, incomplete: 0 },
  { name: "構造柱は部材記号を持つ", outcome: "fail", applicable: 164, pass: 152, fail: 12, incomplete: 0 },
  { name: "構造梁はスパンを記録する", outcome: "pass", applicable: 363, pass: 363, fail: 0, incomplete: 0 },
  { name: "構造スラブは耐力フラグを持つ", outcome: "fail", applicable: 103, pass: 93, fail: 10, incomplete: 0 },
  { name: "フローセグメントは用途を記録する", outcome: "review_incomplete", applicable: 1337, pass: 1334, fail: 0, incomplete: 3 },
  { name: "フローセグメントは外径を記録する", outcome: "fail", applicable: 1294, pass: 1187, fail: 107, incomplete: 0 },
];

export interface MockDelivery {
  label: string;
  date: string;
  finalized: boolean;
  runStatus: "completed" | "running" | "none";
  passCount: number;
  failCount: number;
  incompleteCount: number;
  findingCount: number;
  packVersion: number;
  reusedModels: string[];
}

export const DELIVERIES: MockDelivery[] = [
  { label: "第1回納品", date: "2026-06-30", finalized: true, runStatus: "completed", passCount: 2104, failCount: 398, incompleteCount: 0, findingCount: 8, packVersion: 1, reusedModels: [] },
  { label: "第2回納品", date: "2026-07-31", finalized: true, runStatus: "completed", passCount: 2199, failCount: 301, incompleteCount: 5, findingCount: 7, packVersion: 1, reusedModels: ["構造"] },
  { label: "第3回納品", date: "2026-08-28", finalized: true, runStatus: "completed", passCount: 2279, failCount: 241, incompleteCount: 3, findingCount: 6, packVersion: 2, reusedModels: ["構造"] },
];

export interface MockDiffSummary {
  base: string;
  head: string;
  counts: Partial<Record<ChangeKind, number>>;
  uncertainMatches: number;
}

export const DIFF: MockDiffSummary = {
  base: "第2回納品",
  head: "第3回納品",
  counts: { added: 42, removed: 8, moved: 15, shape_changed: 6, properties_changed: 121, unchanged: 5328 },
  uncertainMatches: 3,
};

export interface MockObjectChange {
  kind: ChangeKind;
  ifcType: string;
  name: string;
  storey: string;
  model: string;
  detail: string;
  confidence: "confirmed" | "uncertain";
}

export const OBJECT_CHANGES: MockObjectChange[] = [
  { kind: "properties_changed", ifcType: "IfcSpace", name: "会議室A", storey: "3F", model: "建築", detail: "Reference: (空) → 3F-MT-A", confidence: "confirmed" },
  { kind: "properties_changed", ifcType: "IfcFlowSegment", name: "給水管 VP25", storey: "2F", model: "設備", detail: "外径[mm]: (なし) → 32", confidence: "confirmed" },
  { kind: "moved", ifcType: "IfcDoor", name: "SD-04 片開き", storey: "3F", model: "建築", detail: "開口位置 +620 mm (X方向)", confidence: "confirmed" },
  { kind: "shape_changed", ifcType: "IfcWindow", name: "FIX窓 W1200", storey: "2F", model: "建築", detail: "W1200 → W1500", confidence: "confirmed" },
  { kind: "added", ifcType: "IfcFlowSegment", name: "空調ダクト 250×250", storey: "3F", model: "設備", detail: "新規オブジェクト", confidence: "confirmed" },
  { kind: "removed", ifcType: "IfcColumn", name: "RC柱 600×600", storey: "1F", model: "建築", detail: "前回リビジョンにのみ存在", confidence: "confirmed" },
  { kind: "properties_changed", ifcType: "IfcDoor", name: "FD-01 防火戸", storey: "1F", model: "建築", detail: "名称一致・GlobalId 重複のため照合が不確実", confidence: "uncertain" },
];

export const PROVENANCE = {
  status: "incomplete" as const,
  reason:
    "この実行の入力モデルは現在の納品メンバーシップから再構成されています。ピン留めされた入力の記録はまだ実装されていないため、表示中のモデルが当時の実入力であることは証明されていません。",
};
