import type { ChangeKind, Severity } from "@/lib/types";

/** Severity colours shared by the findings list and the 3D highlights. */
export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: "#dc2626",
  high: "#ea580c",
  medium: "#ca8a04",
  advisory: "#0284c7",
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  advisory: "Advisory",
};

/** Objects the engine could not decide on. Never green, never counted as a pass. */
export const REVIEW_INCOMPLETE_COLOR = "#7c3aed";

export const CHANGE_COLOR: Record<ChangeKind, string> = {
  added: "#16a34a",
  removed: "#dc2626",
  unchanged: "#94a3b8",
  moved: "#2563eb",
  shape_changed: "#9333ea",
  properties_changed: "#ca8a04",
  mixed: "#db2777",
};
