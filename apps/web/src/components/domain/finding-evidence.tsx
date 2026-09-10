"use client";

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
import type { Finding } from "@/lib/types";
import { UI } from "@/lib/i18n";
import { useLocale } from "../locale-provider";

interface EvidenceObject {
  expressId: number;
  ifcType: string;
  name: string | null;
  storey: string | null;
  model: string;
  actual: string | null;
}

interface FixtureFindingEvidence {
  readonly requirement: string;
  readonly expected: string | null;
  readonly objectCount: number;
  readonly objects: readonly EvidenceObject[];
}

type FindingEvidenceSource = Finding | FixtureFindingEvidence;

/** Real findings use `sampleObjects`; the design fixture uses `objects`. */
function normalize(finding: FindingEvidenceSource): { objects: readonly EvidenceObject[]; expected: string | null } {
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
export function FindingEvidence({ finding }: { finding: FindingEvidenceSource }) {
  const { locale } = useLocale();
  const copy =
    locale === "ja"
      ? { evidence: "根拠と対象オブジェクト", requirement: "要件", expected: "期待値", objects: "対象オブジェクト", name: "名称", storey: "階", model: "モデル", actual: "実測値", other: "ほか" }
      : { evidence: "Evidence and affected objects", requirement: "Requirement", expected: "Expected", objects: "Affected objects", name: "Name", storey: "Storey", model: "Model", actual: "Actual", other: "Other" };
  const { objects, expected } = normalize(finding);
  const otherObjectCount = finding.objectCount - objects.length;
  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="evidence" className="border-b-0">
        <AccordionTrigger className="py-1.5 text-xs">
          {copy.evidence}
        </AccordionTrigger>
        <AccordionContent>
          <dl className="space-y-1 text-xs">
            <div className="flex gap-2">
              <dt className="w-10 shrink-0 text-muted-foreground">{copy.requirement}</dt>
              <dd className="break-all font-mono">{finding.requirement}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-10 shrink-0 text-muted-foreground">{copy.expected}</dt>
              <dd>{expected ?? UI[locale].expectedAbsent}</dd>
            </div>
          </dl>

          <div className="mt-3">
            <h3 className="mb-1.5 text-xs font-medium">{copy.objects}</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="h-7 px-2 text-xs">{copy.name}</TableHead>
                  <TableHead className="h-7 px-2 text-xs">{copy.storey}</TableHead>
                  <TableHead className="h-7 px-2 text-xs">{copy.model}</TableHead>
                  <TableHead className="h-7 px-2 text-xs">{copy.actual}</TableHead>
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
                {copy.other} {otherObjectCount}
              </p>
            )}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
