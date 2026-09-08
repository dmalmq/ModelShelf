import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { MockFinding } from "@/lib/mock";
import type { Finding } from "@/lib/types";

interface EvidenceObject {
  expressId: number;
  ifcType: string;
  name: string | null;
  storey: string | null;
  model: string;
  actual: string | null;
}

/** Real findings use `sampleObjects`; the design fixture uses `objects`. */
function normalize(finding: Finding | MockFinding): { objects: EvidenceObject[]; expected: string | null } {
  if ("sampleObjects" in finding) {
    return {
      objects: finding.sampleObjects.map((object) => ({
        expressId: object.expressId,
        ifcType: object.ifcType,
        name: object.name,
        storey: object.storey,
        model: object.modelId.slice(0, 8),
        actual: object.actual,
      })),
      expected: finding.expected,
    };
  }
  return {
    objects: finding.objects.map((object) => ({
      expressId: object.expressId,
      ifcType: object.ifcType,
      name: object.name,
      storey: object.storey,
      model: object.model,
      actual: object.actual,
    })),
    expected: finding.expected,
  };
}

/**
 * A finding's review evidence: the rule, result counts, and concrete model
 * objects that a reviewer can inspect in the viewer.
 */
export function FindingEvidence({ finding }: { finding: Finding | MockFinding }) {
  const { objects, expected } = normalize(finding);
  const otherObjectCount = finding.objectCount - objects.length;
  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="evidence" className="border-b-0">
        <AccordionTrigger className="py-1.5 text-xs">
          根拠と対象オブジェクト
        </AccordionTrigger>
        <AccordionContent>
          <dl className="space-y-1 text-xs">
            <div className="flex gap-2">
              <dt className="w-10 shrink-0 text-muted-foreground">要件</dt>
              <dd className="break-all font-mono">{finding.requirement}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-10 shrink-0 text-muted-foreground">期待値</dt>
              <dd>{expected ?? "記載なし / Not stated"}</dd>
            </div>
          </dl>

          <div className="mt-3">
            <h3 className="mb-1.5 text-xs font-medium">対象オブジェクト</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="h-7 px-2 text-xs">名称</TableHead>
                  <TableHead className="h-7 px-2 text-xs">階</TableHead>
                  <TableHead className="h-7 px-2 text-xs">モデル</TableHead>
                  <TableHead className="h-7 px-2 text-xs">実測値</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {objects.map((object) => (
                  <TableRow key={`${object.model}-${object.expressId}`}>
                    <TableCell className="px-2 py-1.5 text-xs">
                      <span className="block">{object.name ?? "Unnamed"}</span>
                      <span className="tnum text-muted-foreground">
                        #{object.expressId} · {object.ifcType}
                      </span>
                    </TableCell>
                    <TableCell className="px-2 py-1.5 text-xs">{object.storey ?? "—"}</TableCell>
                    <TableCell className="px-2 py-1.5 text-xs">{object.model}</TableCell>
                    <TableCell className="px-2 py-1.5 text-xs text-muted-foreground">
                      {object.actual ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {otherObjectCount > 0 && (
              <p className="tnum mt-1.5 text-xs text-muted-foreground">
                他{otherObjectCount}オブジェクト
              </p>
            )}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
