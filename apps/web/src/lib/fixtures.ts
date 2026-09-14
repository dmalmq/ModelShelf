/**
 * Fixture data for the component kitchen sink.
 *
 * These are the REAL numbers from the BLCJ S1000 evaluation recorded in
 * `packs/demo/checks.md` and `.omo/evidence/modelshelf-prototype/task-5/`, not
 * invented figures. That matters for a component kit: the demo delivery has an
 * advisory finding covering more objects than any high finding but one, 19 of
 * 36 results not applicable, and two checks that could not be evaluated. Every
 * one of those is a case a component can get wrong, and a tidy made-up dataset
 * would hide all three.
 *
 * Imported only by `src/app/kitchen-sink/page.dev.tsx`, a dev-only route.
 * `npm run lint` fails if any shipped module imports this file.
 */

import type {
  Finding,
  FindingObject,
  RunInputProvenance,
  RunSummary,
  SeverityBand,
} from "@/lib/types";

const MODEL_ARCH = "mdl_arch_east";
const MODEL_MEP = "mdl_mep_services";

const REVISION_ARCH = "rev_a71f3c92";
const REVISION_MEP = "rev_c40b18de";

function obj(partial: Partial<FindingObject> & { expressId: number }): FindingObject {
  const modelId = partial.modelId ?? MODEL_ARCH;
  return {
    objectId: `obj_${partial.expressId}`,
    modelId,
    // Opaque and unique only within its revision. Two revisions of the same
    // source model can carry the same GlobalId, so highlight and selection key
    // off this rather than off globalId.
    ref: {
      revisionId: modelId === MODEL_MEP ? REVISION_MEP : REVISION_ARCH,
      objectId: `obj_${partial.expressId}`,
    },
    discipline: "ARCH",
    globalId: null,
    ifcType: "IfcDoor",
    name: null,
    storey: "2FL",
    actual: null,
    incompleteReason: null,
    ...partial,
  };
}

function finding(partial: Partial<Finding> & { id: string; title: string }): Finding {
  return {
    findingKey: partial.id,
    specIdentifier: null,
    specName: partial.title,
    requirement: "",
    expected: null,
    instructions: null,
    facet: "property",
    severity: "high",
    categoryId: "general",
    categoryLabel: "General",
    objectCount: 0,
    incomplete: false,
    sampleObjects: [],
    ...partial,
  };
}

/** Check 5. The genuine, fully-confirmed gap: not one of 78 openings carries a fire rating. */
export const FINDING_FIRE_RATING = finding({
  id: "f_fire_rating",
  specIdentifier: "05",
  title: "Door or window declares a fire rating",
  requirement: "Every IfcDoor and IfcWindow must carry Pset_DoorCommon.FireRating.",
  expected: "Pset_DoorCommon.FireRating present",
  severity: "high",
  categoryId: "regulatory_fire",
  categoryLabel: "Regulatory · fire compartition",
  objectCount: 78,
  sampleObjects: [
    obj({ expressId: 3184, name: "SD-04 片開き", actual: "not present", globalId: "2O$k9wLbn2wf4Xy8mQ" }),
    obj({ expressId: 3190, name: "SD-07", actual: "not present" }),
    obj({ expressId: 4021, ifcType: "IfcWindow", name: "W-12 上げ下げ", storey: "1FL", actual: "not present" }),
  ],
});

/** Check 1. Half the spaces have a blank reference — the join key downstream checks need. */
export const FINDING_ROOM_REFERENCE = finding({
  id: "f_room_reference",
  specIdentifier: "01",
  title: "Room has a reference code",
  requirement: "Every IfcSpace must carry a non-empty Pset_SpaceCommon.Reference.",
  expected: "Pset_SpaceCommon.Reference non-empty",
  severity: "high",
  categoryId: "identification",
  categoryLabel: "Identification",
  objectCount: 30,
  sampleObjects: [obj({ expressId: 1204, ifcType: "IfcSpace", name: "会議室 A", actual: "" })],
});

/** Check 7. Medium — and the pair that proves object counts must not be summed blindly:
 *  these 12 columns are the same 12 that fail check 6. */
export const FINDING_COLUMN_MARK = finding({
  id: "f_column_mark",
  specIdentifier: "07",
  title: "Structural column has a member mark",
  requirement: "Every IfcColumn must carry Pset_ColumnCommon.Reference.",
  expected: "Pset_ColumnCommon.Reference present",
  severity: "medium",
  categoryId: "traceability",
  categoryLabel: "Traceability",
  objectCount: 12,
  sampleObjects: [obj({ expressId: 880, ifcType: "IfcColumn", name: "1C2", actual: "not present" })],
});

/** Check 11. Advisory, and the largest object count in the run. Bar length must not
 *  encode this, or the least urgent row dominates the chart. */
export const FINDING_MEP_DIAMETER = finding({
  id: "f_mep_diameter",
  specIdentifier: "11",
  title: "MEP flow segment records its outer diameter",
  requirement: "Every IfcFlowSegment except cable tray must carry Rebro_PartsData.外径[mm].",
  expected: "Rebro_PartsData.外径[mm] present",
  severity: "advisory",
  categoryId: "completeness",
  categoryLabel: "Data completeness",
  objectCount: 107,
  sampleObjects: [
    obj({
      expressId: 90211,
      modelId: MODEL_MEP,
      discipline: "MEP",
      ifcType: "IfcFlowSegment",
      name: "空調.角ダクト",
      storey: "3FL",
      actual: "not present",
    }),
  ],
});

/** Neither pass nor fail: the engine could not decide. Renders as Undecided, never ranked. */
export const FINDING_UNDECIDED = finding({
  id: "f_space_area",
  specIdentifier: "02",
  title: "Room records a net floor area",
  requirement: "Every IfcSpace must carry BaseQuantities.NetFloorArea.",
  expected: "BaseQuantities.NetFloorArea present",
  severity: "high",
  categoryId: "regulatory_area",
  categoryLabel: "Regulatory · floor area",
  objectCount: 0,
  incomplete: true,
  sampleObjects: [
    obj({
      expressId: 1204,
      ifcType: "IfcSpace",
      name: "会議室 A",
      incompleteReason: "Space geometry absent; quantity could not be derived",
    }),
  ],
});

export const FINDINGS: Finding[] = [
  FINDING_FIRE_RATING,
  FINDING_ROOM_REFERENCE,
  FINDING_COLUMN_MARK,
  FINDING_MEP_DIAMETER,
];

/** 4 high / 2 medium / 1 advisory / 0 critical. Critical being empty is the point. */
export const SCORECARD: SeverityBand[] = [
  { severity: "critical", findingCount: 0, objectCount: 0, categories: [] },
  { severity: "high", findingCount: 4, objectCount: 130, categories: [] },
  { severity: "medium", findingCount: 2, objectCount: 16, categories: [] },
  { severity: "advisory", findingCount: 1, objectCount: 107, categories: [] },
];

/** Everything resolved except two checks nobody could evaluate. */
export const SCORECARD_CLEAN: SeverityBand[] = [
  { severity: "critical", findingCount: 0, objectCount: 0, categories: [] },
  { severity: "high", findingCount: 0, objectCount: 0, categories: [] },
  { severity: "medium", findingCount: 0, objectCount: 0, categories: [] },
  { severity: "advisory", findingCount: 0, objectCount: 0, categories: [] },
];

function run(partial: Partial<RunSummary>): RunSummary {
  return {
    id: "run_demo",
    projectId: "prj_blcj",
    deliveryId: "dlv_2026_09_04",
    deliveryLabel: "2026-09-04",
    packVersionId: "pkv_blcj_v2",
    packName: "BLCJ S1000",
    packVersion: 2,
    engineVersion: "ifctester 0.8.1",
    parserVersion: "ifcopenshell 0.8.3",
    status: "completed",
    error: null,
    startedAt: "2026-09-04T14:22:07Z",
    finishedAt: "2026-09-04T14:22:12Z",
    durationMs: 4800,
    passCount: 8,
    failCount: 7,
    notApplicableCount: 19,
    incompleteCount: 2,
    score: 8 / 15,
    findingCount: 7,
    failingObjectCount: 237,
    ...partial,
  };
}

export const RUN = run({});

/** Every evaluated check passed — and two still could not be evaluated. */
export const RUN_ALL_PASS = run({
  passCount: 15,
  failCount: 0,
  incompleteCount: 2,
  score: 1,
  findingCount: 0,
  failingObjectCount: 0,
});

/** A pack scoped almost entirely out of this delivery. `score` is null: nothing applied. */
export const RUN_NOTHING_APPLIED = run({
  passCount: 0,
  failCount: 0,
  notApplicableCount: 33,
  incompleteCount: 0,
  score: null,
  findingCount: 0,
  failingObjectCount: 0,
});

/** `complete` is the normal case since input pinning (ticket 06). `incomplete` is
 *  the historical or unproven state the UI interrupts for (AGENTS.md rule 7). */
export const PROVENANCE_INCOMPLETE: RunInputProvenance = {
  status: "incomplete",
  reason:
    "These models come from current delivery membership, not a record of what this run consumed.",
};

export const PROVENANCE_COMPLETE: RunInputProvenance = { status: "complete", reason: null };
