"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Square } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  createReviewDecision,
  errorMessage,
  fetchDecisionHistory,
  type Remote,
} from "@/lib/shelf-api";
import {
  DECISION_COPY,
  DECISION_LABEL,
  SEVERITY_LABEL,
  UI,
  type Locale,
} from "@/lib/i18n";
import type { DecisionHistory, DecisionOutcome, Finding, RunDetail, ReviewDecision } from "@/lib/types";
import { useLocale } from "../locale-provider";

const OUTCOMES: readonly DecisionOutcome[] = ["accept", "reject", "conditional_accept"];

export function DecisionPanel({ run, findings }: { readonly run: RunDetail; readonly findings: readonly Finding[] }): React.JSX.Element {
  const { locale } = useLocale();
  const [history, setHistory] = useState<Remote<DecisionHistory>>({ kind: "loading" });
  const [outcome, setOutcome] = useState<DecisionOutcome>("conditional_accept");
  const [rationale, setRationale] = useState("");
  const [citedFindingIds, setCitedFindingIds] = useState<readonly string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const copy = DECISION_COPY[locale];
  const current = history.kind === "ready" ? history.value.current : null;
  const cited = useMemo(() => new Set(citedFindingIds), [citedFindingIds]);

  useEffect(() => {
    const abort = new AbortController();
    setHistory({ kind: "loading" });
    setSubmitError(null);
    void fetchDecisionHistory(run.run.id, abort.signal)
      .then((value) => {
        if (!abort.signal.aborted) setHistory({ kind: "ready", value });
      })
      .catch((reason: unknown) => {
        if (!abort.signal.aborted) setHistory({ kind: "failed", error: reason });
      });
    return () => abort.abort();
  }, [run.run.id]);

  useEffect(() => {
    if (current === null) return;
    setOutcome(current.outcome);
    setRationale(current.rationale);
    setCitedFindingIds(current.citedFindingIds);
  }, [current]);

  function toggleFinding(findingId: string): void {
    setSaved(false);
    setCitedFindingIds((existing) =>
      existing.includes(findingId) ? existing.filter((id) => id !== findingId) : [...existing, findingId],
    );
  }

  async function submit(): Promise<void> {
    setSubmitError(null);
    setSaved(false);
    const trimmed = rationale.trim();
    if (trimmed.length === 0) {
      setSubmitError(copy.rationaleHint);
      return;
    }
    if (outcome === "conditional_accept" && citedFindingIds.length === 0) {
      setSubmitError(copy.requiredCitation);
      return;
    }
    setSubmitting(true);
    try {
      const decision = await createReviewDecision(run.run.id, {
        outcome,
        rationale: trimmed,
        citedFindingIds: [...citedFindingIds],
        ...(current ? { supersedesDecisionId: current.id } : {}),
      });
      const refreshed = await fetchDecisionHistory(run.run.id);
      setHistory({ kind: "ready", value: refreshed });
      setOutcome(decision.outcome);
      setRationale(decision.rationale);
      setCitedFindingIds(decision.citedFindingIds);
    } catch (reason: unknown) {
      setSubmitError(errorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  }

  function downloadCurrent(): void {
    if (current === null) return;
    const blob = new Blob([JSON.stringify(current, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `modelshelf-decision-${current.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setSaved(true);
  }

  return (
    <section className="space-y-3 border-t border-border pt-4" data-decision-panel aria-labelledby="decision-heading">
      <div>
        <h2 id="decision-heading" className="text-base font-semibold">{copy.title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{copy.description}</p>
      </div>
      {history.kind === "failed" ? (
        <Alert variant="destructive" data-decision-load-error>
          <AlertTitle>{copy.title}</AlertTitle>
          <AlertDescription>{errorMessage(history.error)}</AlertDescription>
        </Alert>
      ) : null}
      {current ? <CurrentDecision decision={current} locale={locale} onDownload={downloadCurrent} saved={saved} /> : null}
      <fieldset className="space-y-2" disabled={submitting || history.kind === "loading"}>
        <legend className="text-sm font-medium">{current ? copy.supersede : copy.title}</legend>
        <div className="flex flex-wrap gap-2" role="group" aria-label={copy.title}>
          {OUTCOMES.map((candidate) => (
            <Button
              key={candidate}
              type="button"
              variant={candidate === outcome ? "secondary" : "outline"}
              aria-pressed={candidate === outcome}
              onClick={() => setOutcome(candidate)}
              data-decision-outcome={candidate}
            >
              {DECISION_LABEL[locale][candidate]}
            </Button>
          ))}
        </div>
        <label className="block text-sm font-medium" htmlFor="decision-rationale">{copy.rationale}</label>
        <textarea
          id="decision-rationale"
          value={rationale}
          onChange={(event) => {
            setSaved(false);
            setRationale(event.target.value);
          }}
          rows={4}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-describedby="decision-rationale-hint"
        />
        <p id="decision-rationale-hint" className="text-xs text-muted-foreground">{copy.rationaleHint}</p>
        <div className="space-y-2">
          <p className="text-sm font-medium">{copy.citedFindings}</p>
          {findings.length === 0 ? (
            <p className="text-xs text-muted-foreground">{UI[locale].noFindingsAtAll}</p>
          ) : (
            <ul className="space-y-1.5">
              {findings.map((finding) => {
                const selected = cited.has(finding.id);
                return (
                  <li key={finding.id}>
                    <button
                      type="button"
                      className={`flex min-h-11 w-full items-start gap-2 rounded-md border px-3 py-2 text-left text-sm ${selected ? "border-primary bg-primary/5" : "border-border"}`}
                      aria-pressed={selected}
                      onClick={() => toggleFinding(finding.id)}
                      data-decision-finding={finding.id}
                    >
                      <span
                        aria-hidden
                        className={`mt-0.5 shrink-0 ${selected ? "text-primary" : "text-muted-foreground"}`}
                      >
                        {selected ? <Check className="size-4" /> : <Square className="size-4" />}
                      </span>
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{SEVERITY_LABEL[locale][finding.severity]}</Badge>
                          <span className="font-medium">{finding.title}</span>
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {finding.categoryLabel} · {finding.objectCount.toLocaleString()}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {submitError ? <p className="text-sm text-destructive" role="alert">{submitError}</p> : null}
        <Button data-decision-submit type="button" onClick={() => void submit()} disabled={submitting || history.kind === "loading"}>
          {submitting ? "…" : current ? copy.supersede : copy.submit}
        </Button>
      </fieldset>
      {history.kind === "ready" && history.value.history.length > 1 ? (
        <DecisionHistoryList decisions={history.value.history} locale={locale} />
      ) : null}
    </section>
  );
}

function CurrentDecision({
  decision,
  locale,
  onDownload,
  saved,
}: {
  readonly decision: ReviewDecision;
  readonly locale: Locale;
  readonly onDownload: () => void;
  readonly saved: boolean;
}): React.JSX.Element {
  const copy = DECISION_COPY[locale];
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3" data-current-decision>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{copy.current}</h3>
        <Badge>{DECISION_LABEL[locale][decision.outcome]}</Badge>
        <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={onDownload}>
          {saved ? copy.copied : copy.export}
        </Button>
      </div>
      <p className="whitespace-pre-wrap text-sm">{decision.rationale}</p>
      <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
        <EvidenceItem label={copy.run} value={`${decision.evidence.deliveryLabel} · ${decision.evidence.runId}`} />
        <EvidenceItem label={copy.pack} value={`${decision.evidence.packName} v${decision.evidence.packVersion}`} />
        <EvidenceItem label={copy.engine} value={`${decision.evidence.engineVersion} · ${decision.evidence.parserVersion}`} />
        <EvidenceItem
          label={copy.provenance}
          value={
            decision.evidence.inputProvenance.status === "complete"
              ? UI[locale].provenancePinned
              : UI[locale].provenanceShort
          }
        />
      </dl>
    </div>
  );
}

function EvidenceItem({ label, value }: { readonly label: string; readonly value: string }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}

function DecisionHistoryList({
  decisions,
  locale,
}: {
  readonly decisions: readonly ReviewDecision[];
  readonly locale: Locale;
}): React.JSX.Element {
  const copy = DECISION_COPY[locale];
  return (
    <details className="rounded-md border border-border px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium">{copy.history}</summary>
      <ol className="mt-2 space-y-2">
        {decisions.map((decision) => (
          <li key={decision.id} className="border-t border-border pt-2 text-xs">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{DECISION_LABEL[locale][decision.outcome]}</Badge>
              <time dateTime={decision.createdAt}>{new Date(decision.createdAt).toLocaleString(locale)}</time>
            </div>
            <p className="mt-1 whitespace-pre-wrap">{decision.rationale}</p>
          </li>
        ))}
      </ol>
    </details>
  );
}
