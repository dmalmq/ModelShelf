// ModelShelf API contract — mirror of docs/contracts/http-api.md and the Rust
// serialisation in services/checker. Changing a field here means changing it there.

export type Severity = "critical" | "high" | "medium" | "advisory";
export type Discipline = "ARCH" | "STRUCT" | "MEP" | "OTHER";
export type FacetKind = "entity" | "attribute" | "classification" | "property" | "material" | "part_of";
export type SpecOutcome = "pass" | "fail" | "not_applicable" | "review_incomplete";
export type RunStatus = "running" | "completed" | "failed";
export type ChangeKind =
  | "added"
  | "removed"
  | "unchanged"
  | "moved"
  | "shape_changed"
  | "properties_changed"
  | "mixed";

export interface Health {
  status: "ok";
  engineVersion: string;
  parserVersion: string;
  schemaVersion: number;
}

export interface Project {
  id: string;
  tenantId: string;
  tenantName: string;
  name: string;
  createdAt: string;
  deliveryCount: number;
  runCount: number;
}

export interface Delivery {
  id: string;
  projectId: string;
  label: string;
  deliveryDate: string | null;
  createdAt: string;
  modelCount: number;
  productCount: number;
}

export interface ModelInfo {
  id: string;
  deliveryId: string;
  discipline: Discipline;
  filename: string;
  contentSha256: string;
  byteSize: number;
  schemaLabel: string;
  entityCount: number;
  productCount: number;
  lengthToMetre: number;
  parseMs: number | null;
  uploadedAt: string;
  originatingSystem: string | null;
}

export interface DeliverySummary extends Delivery {
  models: ModelInfo[];
  latestRun: RunSummary | null;
}

export interface ProjectDetail {
  project: Project;
  deliveries: DeliverySummary[];
  packs: Pack[];
  runs: RunSummary[];
}

export interface DeliveryDetail {
  delivery: Delivery;
  models: ModelInfo[];
  runs: RunSummary[];
  locked: boolean;
}

export interface Pack {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  createdAt: string;
  versions: PackVersion[];
}

export interface PackVersion {
  id: string;
  packId: string;
  packName: string;
  version: number;
  idsSha256: string;
  notes: string | null;
  specCount: number;
  createdAt: string;
}

export interface PackSpecInfo {
  identifier: string | null;
  name: string;
  description: string | null;
  severity: Severity;
  categoryId: string;
  categoryLabel: string;
  ifcVersions: string[];
  applicability: string[];
  requirements: string[];
}

export interface PackVersionDetail {
  version: PackVersion;
  idsXml: string;
  specs: PackSpecInfo[];
}

export interface RunSummary {
  id: string;
  projectId: string;
  deliveryId: string;
  deliveryLabel: string;
  packVersionId: string;
  packName: string;
  packVersion: number;
  engineVersion: string;
  parserVersion: string;
  status: RunStatus;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  passCount: number;
  failCount: number;
  notApplicableCount: number;
  incompleteCount: number;
  /** passCount / (passCount + failCount), null when nothing was applicable. */
  score: number | null;
  findingCount: number;
  failingObjectCount: number;
}

export interface FindingObject {
  objectId: string | null;
  modelId: string;
  discipline: Discipline;
  expressId: number;
  globalId: string | null;
  ifcType: string;
  name: string | null;
  storey: string | null;
  actual: string | null;
  incompleteReason: string | null;
}

export interface Finding {
  id: string;
  findingKey: string;
  specIdentifier: string | null;
  specName: string;
  title: string;
  requirement: string;
  expected: string | null;
  instructions: string | null;
  facet: FacetKind;
  severity: Severity;
  categoryId: string;
  categoryLabel: string;
  objectCount: number;
  /** true when the engine could not decide — "review incomplete", never a pass. */
  incomplete: boolean;
  /** First page of affected objects (max 25); fetch the rest via /api/findings/:id/objects. */
  sampleObjects: FindingObject[];
}

export interface CategoryGroup {
  categoryId: string;
  categoryLabel: string;
  findingCount: number;
  objectCount: number;
  findings: Finding[];
}

export interface SeverityBand {
  severity: Severity;
  findingCount: number;
  objectCount: number;
  categories: CategoryGroup[];
}

export interface SpecResultRow {
  id: string;
  specIdentifier: string | null;
  specName: string;
  outcome: SpecOutcome;
  applicableCount: number;
  passCount: number;
  failCount: number;
  incompleteCount: number;
  notes: string[];
}

export interface RunDetail {
  run: RunSummary;
  models: ModelInfo[];
  /** Severity bands in order critical -> high -> medium -> advisory. */
  scorecard: SeverityBand[];
  specs: SpecResultRow[];
  reviewIncomplete: Finding[];
}

export interface ObjectRow {
  id: string;
  modelId: string;
  expressId: number;
  globalId: string | null;
  ifcType: string;
  name: string | null;
  predefinedType: string | null;
  storey: string | null;
  fingerprints: { properties: string; placement: string; shape: string; combined: string };
}

export interface ObjectPage {
  total: number;
  limit: number;
  offset: number;
  objects: ObjectRow[];
}

export interface ObjectProperty {
  pset: string;
  name: string;
  value: string | null;
  dataType: string | null;
  unit: string | null;
  numeric: number | null;
  inherited: boolean;
}

export interface ObjectDetail extends ObjectRow {
  placement: number[] | null;
  properties: ObjectProperty[];
}

export interface FindingObjectPage {
  findingId: string;
  total: number;
  limit: number;
  offset: number;
  objects: FindingObject[];
}

export type MatchConfidence =
  | { kind: "exact" }
  | { kind: "heuristic"; score: number; basis: string }
  | { kind: "none" };

export interface ObjectChangeRef {
  expressId: number;
  globalId: string | null;
  ifcType: string;
  name: string | null;
  storey: string | null;
}

export interface PropertyChange {
  pset: string;
  name: string;
  base: string | null;
  head: string | null;
}

export interface ObjectChange {
  kind: ChangeKind;
  confidence: MatchConfidence;
  base: ObjectChangeRef | null;
  head: ObjectChangeRef | null;
  propertyChanges: PropertyChange[];
  movedDistanceM: number | null;
  notes: string[];
}

export interface DiffSummary {
  added: number;
  removed: number;
  unchanged: number;
  moved: number;
  shapeChanged: number;
  propertiesChanged: number;
  mixed: number;
  uncertainMatches: number;
}

export interface ModelPairDiff {
  discipline: Discipline;
  baseModelId: string | null;
  headModelId: string | null;
  baseFilename: string | null;
  headFilename: string | null;
  summary: DiffSummary;
  total: number;
  changes: ObjectChange[];
}

export interface ModelDiffResponse {
  base: Delivery;
  head: Delivery;
  pairs: ModelPairDiff[];
}

export type FindingDelta = "resolved" | "introduced" | "persisting";

export interface FindingChange {
  findingKey: string;
  delta: FindingDelta;
  title: string;
  severity: Severity;
  categoryId: string;
  categoryLabel: string;
  baseObjectCount: number;
  headObjectCount: number;
  introducedObjects: string[];
  resolvedObjects: string[];
}

export interface FindingDiffResponse {
  baseRun: RunSummary;
  headRun: RunSummary;
  resolved: number;
  introduced: number;
  persisting: number;
  changes: FindingChange[];
}

export const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "advisory"];

export const CHANGE_KIND_LABEL: Record<ChangeKind, string> = {
  added: "Added",
  removed: "Removed",
  unchanged: "Unchanged",
  moved: "Moved",
  shape_changed: "Shape changed",
  properties_changed: "Properties changed",
  mixed: "Multiple changes",
};
