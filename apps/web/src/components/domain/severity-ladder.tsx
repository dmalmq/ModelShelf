import { SEVERITY_COLOR } from "@/lib/palette";
import { SEVERITY_LABEL_JA } from "@/lib/mock";
import { SEVERITY_ORDER, type Severity } from "@/lib/types";

export interface LadderBand {
  severity: Severity;
  findingCount: number;
  objectCount: number;
}

/**
 * Bar length encodes FINDING count so volume can never outrank severity;
 * object counts stay as text. Zero-count bands collapse into a single line —
 * the longest bar on screen must never mean "none".
 */
export function SeverityLadder({ bands }: { bands: LadderBand[] }) {
  const ordered = SEVERITY_ORDER.map(
    (s) => bands.find((b) => b.severity === s) ?? { severity: s, findingCount: 0, objectCount: 0 },
  );
  const max = Math.max(1, ...ordered.map((b) => b.findingCount));
  const zeroBands = ordered.filter((b) => b.findingCount === 0);

  return (
    <div className="space-y-2">
      {zeroBands.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {zeroBands.map((b) => SEVERITY_LABEL_JA[b.severity]).join("・")}の指摘はありません。
        </p>
      )}
      {ordered
        .filter((b) => b.findingCount > 0)
        .map((b) => (
          <div key={b.severity} className="flex items-center gap-3">
            <span className="w-10 shrink-0 text-sm font-medium">{SEVERITY_LABEL_JA[b.severity]}</span>
            <div className="h-5 flex-1">
              <div
                className="h-full rounded-sm"
                style={{
                  width: `${(b.findingCount / max) * 100}%`,
                  backgroundColor: SEVERITY_COLOR[b.severity],
                }}
              />
            </div>
            <span className="tnum w-28 shrink-0 text-right text-sm text-muted-foreground">
              {b.findingCount}件 / {b.objectCount}オブジェクト
            </span>
          </div>
        ))}
    </div>
  );
}
