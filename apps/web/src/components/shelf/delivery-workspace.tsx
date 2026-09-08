"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Lock, RotateCcw, Upload } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { CombinedDeliveryViewer } from "@/components/viewer/combined-delivery-viewer";
import {
  DISCIPLINES,
  addDeliveryMember,
  deriveDeliveryLock,
  errorMessage,
  fetchDelivery,
  fetchRunDetail,
  finalizeDelivery,
  listSourceModels,
  memberRevisionBySource,
  pollJob,
  retryJob,
  uploadRevision,
  type Remote,
} from "@/lib/shelf-api";
import type {
  DeliveryDetail,
  Discipline,
  IngestionJob,
  ModelInfo,
  ModelRevisionSummary,
  RunDetail,
  RunSummary,
  SourceModel,
} from "@/lib/types";

type UploadAttempt =
  | { kind: "sending"; filename: string }
  | { kind: "processing"; job: IngestionJob }
  | { kind: "completed"; job: IngestionJob }
  | { kind: "failed"; job: IngestionJob | null; message: string };

type DisciplineFilter = Discipline | "all";

function isDiscipline(value: string | null): value is Discipline {
  return value === "ARCH" || value === "STRUCT" || value === "MEP" || value === "OTHER";
}

function shortHash(hash: string): string {
  return hash.length > 12 ? `${hash.slice(0, 12)}…` : hash;
}

function attemptStatus(attempt: UploadAttempt | undefined): string | null {
  if (!attempt) return null;
  if (attempt.kind === "sending") return "sending";
  if (attempt.kind === "processing") return attempt.job.status;
  if (attempt.kind === "completed") return "completed";
  return "failed";
}

function attemptMessage(attempt: UploadAttempt): string {
  if (attempt.kind === "sending") return `Sending ${attempt.filename}…`;
  if (attempt.kind === "processing") {
    return `${attempt.job.status === "queued" ? "Queued" : "Processing"} ${attempt.job.filename}…`;
  }
  if (attempt.kind === "completed") return `Ready: ${attempt.job.filename}`;
  return `Failed: ${attempt.message}`;
}

export function DeliveryWorkspace({ deliveryId }: { readonly deliveryId: string }): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const projectParam = searchParams.get("project");
  const rawDiscipline = searchParams.get("discipline");
  const discipline: DisciplineFilter = isDiscipline(rawDiscipline) ? rawDiscipline : "all";
  const sourceParam = searchParams.get("source");
  const runParam = searchParams.get("run");

  const [detail, setDetail] = useState<Remote<DeliveryDetail>>({ kind: "loading" });
  const [sources, setSources] = useState<Remote<readonly SourceModel[]>>({ kind: "loading" });
  const [attempts, setAttempts] = useState<Readonly<Record<string, UploadAttempt>>>({});
  const [selectedRun, setSelectedRun] = useState<Remote<RunDetail> | null>(null);
  const [attachBusy, setAttachBusy] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [finalizeBusy, setFinalizeBusy] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const fileRefs = useRef(new Map<string, HTMLInputElement | null>());
  const pollControllers = useRef(new Map<string, AbortController>());

  const detailValue = detail.kind === "ready" ? detail.value : null;
  const projectId = detailValue?.delivery.projectId ?? projectParam;
  const members = useMemo(
    () => (detailValue ? memberRevisionBySource(detailValue) : new Map<string, string>()),
    [detailValue],
  );
  const viewerMembershipKey = useMemo(
    () => detailValue?.models.map((model) => model.id).sort().join(":") ?? "empty",
    [detailValue],
  );

  useEffect(() => {
    const abortController = new AbortController();
    setDetail({ kind: "loading" });
    void fetchDelivery(deliveryId, abortController.signal)
      .then((value) => {
        if (!abortController.signal.aborted) setDetail({ kind: "ready", value });
      })
      .catch((reason: unknown) => {
        if (!abortController.signal.aborted) setDetail({ kind: "failed", error: reason });
      });
    return () => abortController.abort();
  }, [deliveryId]);

  useEffect(() => {
    if (!projectId) return;
    const abortController = new AbortController();
    setSources({ kind: "loading" });
    void listSourceModels(projectId, abortController.signal)
      .then((value) => {
        if (!abortController.signal.aborted) setSources({ kind: "ready", value });
      })
      .catch((reason: unknown) => {
        if (!abortController.signal.aborted) setSources({ kind: "failed", error: reason });
      });
    return () => abortController.abort();
  }, [projectId]);

  useEffect(() => {
    for (const controller of pollControllers.current.values()) controller.abort();
    pollControllers.current.clear();
  }, [deliveryId]);

  useEffect(
    () => () => {
      for (const controller of pollControllers.current.values()) controller.abort();
    },
    [],
  );

  const setParam = useCallback(
    (updates: Readonly<Record<string, string | null>>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [name, value] of Object.entries(updates)) {
        if (value === null) {
          params.delete(name);
        } else {
          params.set(name, value);
        }
      }
      const query = params.toString();
      router.replace(query.length > 0 ? `${pathname}?${query}` : pathname);
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    if (detail.kind !== "ready" || sources.kind !== "ready") return;
    const fixes: Record<string, string | null> = {};
    if (sourceParam && !sources.value.some((source) => source.id === sourceParam)) {
      fixes.source = null;
    }
    if (runParam && !detail.value.runs.some((run) => run.id === runParam)) {
      fixes.run = null;
    }
    if (rawDiscipline !== null && !isDiscipline(rawDiscipline)) {
      fixes.discipline = null;
    }
    if (projectParam && projectParam !== detail.value.delivery.projectId) {
      fixes.project = detail.value.delivery.projectId;
    }
    if (Object.keys(fixes).length > 0) setParam(fixes);
  }, [detail, sources, sourceParam, runParam, rawDiscipline, projectParam, setParam]);

  useEffect(() => {
    if (!runParam || detail.kind !== "ready") {
      setSelectedRun(null);
      return;
    }
    if (!detail.value.runs.some((run) => run.id === runParam)) {
      setSelectedRun(null);
      return;
    }
    const abortController = new AbortController();
    setSelectedRun({ kind: "loading" });
    void fetchRunDetail(runParam, abortController.signal)
      .then((value) => {
        if (!abortController.signal.aborted) setSelectedRun({ kind: "ready", value });
      })
      .catch((reason: unknown) => {
        if (!abortController.signal.aborted) setSelectedRun({ kind: "failed", error: reason });
      });
    return () => abortController.abort();
  }, [runParam, detail]);

  const refreshSources = useCallback(
    async (id: string) => {
      const fresh = await listSourceModels(id);
      setSources({ kind: "ready", value: fresh });
    },
    [],
  );

  async function trackJob(sourceModelId: string, job: IngestionJob): Promise<void> {
    const controller = new AbortController();
    pollControllers.current.get(sourceModelId)?.abort();
    pollControllers.current.set(sourceModelId, controller);
    try {
      const terminal = await pollJob(job.id, {
        signal: controller.signal,
        onJob: (current) => {
          if (current.status === "queued" || current.status === "running") {
            setAttempts((attemptsNow) => ({
              ...attemptsNow,
              [sourceModelId]: { kind: "processing", job: current },
            }));
          }
        },
      });
      if (terminal.status === "completed") {
        if (projectId) {
          try {
            await refreshSources(projectId);
          } catch (reason: unknown) {
            setAttempts((current) => ({
              ...current,
              [sourceModelId]: {
                kind: "failed",
                job: null,
                message: `Upload completed, but sources could not refresh. ${errorMessage(reason)}`,
              },
            }));
            return;
          }
        }
        setAttempts((current) => ({ ...current, [sourceModelId]: { kind: "completed", job: terminal } }));
        const input = fileRefs.current.get(sourceModelId);
        if (input) input.value = "";
      } else {
        setAttempts((current) => ({
          ...current,
          [sourceModelId]: {
            kind: "failed",
            job: terminal,
            message: terminal.error ?? "Processing failed",
          },
        }));
      }
    } catch (reason: unknown) {
      if (controller.signal.aborted) return;
      setAttempts((current) => {
        const previous = current[sourceModelId];
        const jobOfRecord = previous && "job" in previous ? previous.job : job;
        return {
          ...current,
          [sourceModelId]: { kind: "failed", job: jobOfRecord, message: errorMessage(reason) },
        };
      });
    } finally {
      if (pollControllers.current.get(sourceModelId) === controller) {
        pollControllers.current.delete(sourceModelId);
      }
    }
  }
  async function startUpload(sourceModelId: string): Promise<void> {
    const file = fileRefs.current.get(sourceModelId)?.files?.[0];
    if (!file || attempts[sourceModelId]?.kind === "sending") return;
    const controller = new AbortController();
    pollControllers.current.get(sourceModelId)?.abort();
    pollControllers.current.set(sourceModelId, controller);
    setAttempts((current) => ({ ...current, [sourceModelId]: { kind: "sending", filename: file.name } }));
    try {
      const job = await uploadRevision(sourceModelId, file, controller.signal);
      setAttempts((current) => ({ ...current, [sourceModelId]: { kind: "processing", job } }));
      pollControllers.current.delete(sourceModelId);
      await trackJob(sourceModelId, job);
    } catch (reason: unknown) {
      pollControllers.current.delete(sourceModelId);
      if (controller.signal.aborted) return;
      setAttempts((current) => ({
        ...current,
        [sourceModelId]: { kind: "failed", job: null, message: errorMessage(reason) },
      }));
    }
  }

  async function retryUpload(sourceModelId: string, jobId: string): Promise<void> {
    setAttempts((current) => {
      const previous = current[sourceModelId];
      const job = previous && "job" in previous ? previous.job : null;
      if (!job) return current;
      return { ...current, [sourceModelId]: { kind: "processing", job } };
    });
    try {
      const job = await retryJob(jobId);
      await trackJob(sourceModelId, job);
    } catch (reason: unknown) {
      setAttempts((current) => {
        const previous = current[sourceModelId];
        const job = previous && "job" in previous ? previous.job : null;
        return { ...current, [sourceModelId]: { kind: "failed", job, message: errorMessage(reason) } };
      });
    }
  }

  async function attachRevision(sourceModelId: string, revision: ModelRevisionSummary): Promise<void> {
    if (attachBusy) return;
    setAttachBusy(revision.id);
    setAttachError(null);
    try {
      const updated = await addDeliveryMember(deliveryId, {
        sourceModelId,
        modelRevisionId: revision.id,
      });
      setDetail({ kind: "ready", value: updated });
    } catch (reason: unknown) {
      setAttachError(errorMessage(reason));
    } finally {
      setAttachBusy(null);
    }
  }

  async function finalize(): Promise<void> {
    if (finalizeBusy) return;
    setFinalizeBusy(true);
    setFinalizeError(null);
    try {
      const updated = await finalizeDelivery(deliveryId);
      setDetail({ kind: "ready", value: updated });
    } catch (reason: unknown) {
      setFinalizeError(errorMessage(reason));
    } finally {
      setFinalizeBusy(false);
    }
  }

  const visibleSources = useMemo(() => {
    if (sources.kind !== "ready") return [];
    if (discipline === "all") return [...sources.value];
    return sources.value.filter((source) => source.discipline === discipline);
  }, [sources, discipline]);

  const orderedRuns = useMemo(() => {
    if (!detailValue) return [];
    return [...detailValue.runs].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  }, [detailValue]);

  if (detail.kind === "loading") {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-4 p-6" aria-label="Delivery workspace">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-48 w-full" />
        <p className="text-sm text-muted-foreground" role="status">
          Loading delivery / デリバリーを読み込み中
        </p>
      </div>
    );
  }

  if (detail.kind === "failed") {
    return (
      <div className="mx-auto grid w-full max-w-6xl place-items-center p-6">
        <Alert variant="destructive" className="max-w-lg">
          <AlertTitle>Delivery unavailable / デリバリーを開けません</AlertTitle>
          <AlertDescription>{errorMessage(detail.error)}</AlertDescription>
          <Button className="mt-4" variant="outline" size="sm" onClick={() => window.location.reload()}>
            <RotateCcw />
            Retry / 再試行
          </Button>
        </Alert>
      </div>
    );
  }

  const readyDetail = detail.value;
  const lock = deriveDeliveryLock(readyDetail);
  const backParams = new URLSearchParams();
  if (projectId) backParams.set("project", projectId);
  if (discipline !== "all") backParams.set("discipline", discipline);
  const backQuery = backParams.toString();

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-6" data-delivery-id={deliveryId} aria-label="Delivery workspace">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href={backQuery.length > 0 ? `/?${backQuery}` : "/"} aria-label="Back to project shelf">
            <ArrowLeft />
            Shelf
          </Link>
        </Button>
        <span aria-hidden className="h-5 w-px bg-border" />
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">{readyDetail.delivery.label}</h1>
          <p className="tnum truncate text-xs text-muted-foreground">
            {readyDetail.delivery.id} · {readyDetail.models.length} members
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {lock.kind === "draft" ? <Badge variant="secondary">Draft / 下書き</Badge> : null}
          {lock.kind === "finalized" ? (
            <Badge variant="secondary">Finalized / 確定 · {lock.finalizedAt}</Badge>
          ) : null}
          {lock.kind === "runLocked" ? (
            <Badge variant="secondary">
              <Lock />
              Locked by completed run / 実行によりロック
            </Badge>
          ) : null}
          {lock.kind === "draft" ? (
            <Button size="sm" onClick={finalize} disabled={finalizeBusy}>
              <Lock />
              {finalizeBusy ? "Finalizing…" : "Finalize delivery"}
            </Button>
          ) : null}
        </div>
      </header>
      {finalizeError ? (
        <Alert variant="destructive">
          <AlertTitle>Delivery was not finalized</AlertTitle>
          <AlertDescription>{finalizeError}</AlertDescription>
        </Alert>
      ) : null}

      <section aria-label="Source assembly">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold">Assembly / 構成</h2>
          <p className="text-xs text-muted-foreground">
            Upload a revision, then explicitly attach it. Uploads never attach themselves.
          </p>
          <div className="ml-auto flex items-center gap-2">
            <Label htmlFor="workspace-discipline" className="text-xs text-muted-foreground">
              Discipline
            </Label>
            <Select
              value={discipline}
              onValueChange={(value) => setParam({ discipline: value === "all" ? null : value })}
            >
              <SelectTrigger id="workspace-discipline" className="w-32" aria-label="Filter sources by discipline">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {DISCIPLINES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {sources.kind === "loading" ? (
          <p className="text-sm text-muted-foreground" role="status">
            Loading sources / ソースを読み込み中
          </p>
        ) : null}
        {sources.kind === "failed" ? (
          <Alert variant="destructive">
            <AlertTitle>Sources unavailable</AlertTitle>
            <AlertDescription>{errorMessage(sources.error)}</AlertDescription>
          </Alert>
        ) : null}
        {sources.kind === "ready" && visibleSources.length === 0 ? (
          <Card>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">
                No sources match this filter. Clear the discipline filter or create a source on the shelf.
              </p>
            </CardContent>
          </Card>
        ) : null}
        {attachError ? (
          <Alert variant="destructive">
            <AlertTitle>Revision was not attached</AlertTitle>
            <AlertDescription>{attachError}</AlertDescription>
          </Alert>
        ) : null}
        <div className="space-y-3">
          {sources.kind === "ready"
            ? visibleSources.map((source) => (
                <SourceRow
                  key={source.id}
                  source={source}
                  member={readyDetail.models.find((model) => model.id === members.get(source.id)) ?? null}
                  attempt={attempts[source.id]}
                  selected={sourceParam === source.id}
                  attachBusy={attachBusy}
                  membershipLocked={lock.kind !== "draft"}
                  onSelect={() => setParam({ source: sourceParam === source.id ? null : source.id })}
                  onFileRef={(input) => {
                    if (input) {
                      fileRefs.current.set(source.id, input);
                    } else {
                      fileRefs.current.delete(source.id);
                    }
                  }}
                  onUpload={() => startUpload(source.id)}
                  onRetry={(jobId) => retryUpload(source.id, jobId)}
                  onAttach={(revision) => attachRevision(source.id, revision)}
                />
              ))
            : null}
        </div>
      </section>

      <section aria-label="Run history">
        <h2 className="mb-2 text-sm font-semibold">Run history / 実行履歴</h2>
        {orderedRuns.length === 0 ? (
          <Card>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">
                No runs yet. A run can be created against this delivery once it holds revisions.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="pt-4">
              <ol className="divide-y divide-border-soft">
                {orderedRuns.map((run) => (
                  <li
                    key={run.id}
                    data-run-id={run.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {run.packName} v{run.packVersion}
                      </span>
                      <span className="tnum block truncate text-xs text-muted-foreground">
                        {run.status} · pass {run.passCount} · fail {run.failCount} · incomplete{" "}
                        {run.incompleteCount}
                      </span>
                    </span>
                    <Button
                      variant={runParam === run.id ? "secondary" : "outline"}
                      size="sm"
                      aria-pressed={runParam === run.id}
                      aria-label={`View run ${run.packName} version ${run.packVersion}`}
                      onClick={() => setParam({ run: runParam === run.id ? null : run.id })}
                    >
                      {runParam === run.id ? "Hide run" : "View run"}
                    </Button>
                  </li>
                ))}
              </ol>
              {runParam ? (
                <RunPanel
                  runId={runParam}
                  selectedRun={selectedRun}
                  onClear={() => setParam({ run: null })}
                />
              ) : null}
            </CardContent>
          </Card>
        )}
      </section>

      <section aria-label="Combined view">
        <h2 className="mb-2 text-sm font-semibold">Combined view / 結合ビュー</h2>
        {readyDetail.models.length === 0 ? (
          <Card>
            <CardContent className="pt-4">
              <p className="text-sm font-medium">This delivery holds no revisions yet.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Upload a file on one of the source rows above, wait for processing to complete, then
                attach the revision. The combined viewer appears once the first revision is attached.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <CombinedDeliveryViewer
              key={`${deliveryId}:${runParam ?? "live"}:${viewerMembershipKey}`}
              deliveryId={deliveryId}
            />
          </div>
        )}
      </section>
    </div>
  );
}

function SourceRow({
  source,
  member,
  attempt,
  selected,
  attachBusy,
  membershipLocked,
  onSelect,
  onFileRef,
  onUpload,
  onRetry,
  onAttach,
}: {
  readonly source: SourceModel;
  readonly member: ModelInfo | null;
  readonly attempt: UploadAttempt | undefined;
  readonly selected: boolean;
  readonly attachBusy: string | null;
  readonly membershipLocked: boolean;
  readonly onSelect: () => void;
  readonly onFileRef: (input: HTMLInputElement | null) => void;
  readonly onUpload: () => void;
  readonly onRetry: (jobId: string) => void;
  readonly onAttach: (revision: ModelRevisionSummary) => void;
}): React.JSX.Element {
  const status = attemptStatus(attempt);
  const uploading = attempt?.kind === "sending" || attempt?.kind === "processing";
  return (
    <Card data-source-id={source.id} className={selected ? "border-primary" : undefined}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <button
            type="button"
            onClick={onSelect}
            aria-pressed={selected}
            aria-label={`Select source ${source.name}`}
            className="min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-ring"
          >
            <CardTitle className="truncate text-sm">{source.name}</CardTitle>
            <span className="tnum block truncate text-xs font-normal text-muted-foreground">
              {source.revisions.length} revisions
              {member ? ` · attached ${member.filename} · ${shortHash(member.contentSha256)}` : " · not attached"}
            </span>
          </button>
          <Badge variant="outline">{source.discipline}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {member ? (
          <dl
            className="tnum grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2"
            data-revision-id={member.id}
            aria-label={`Attached revision of ${source.name}`}
          >
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">File</dt>
              <dd className="truncate font-medium">{member.filename}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Hash</dt>
              <dd className="truncate font-mono text-[11px]">{member.contentSha256}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Schema</dt>
              <dd>{member.schemaLabel}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Entities / products</dt>
              <dd>
                {member.entityCount} / {member.productCount}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-xs text-muted-foreground">
            No revision attached. Attach one below to include this source in the delivery.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor={`file-${source.id}`} className="sr-only">
            Choose IFC file for {source.name}
          </Label>
          <input
            ref={onFileRef}
            id={`file-${source.id}`}
            type="file"
            accept=".ifc"
            disabled={uploading}
            className="max-w-64 text-xs text-muted-foreground file:mr-2 file:border file:border-border file:bg-secondary file:px-2 file:py-1 file:text-xs file:font-medium file:text-secondary-foreground hover:file:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
          />
          <Button size="sm" variant="outline" onClick={onUpload} disabled={uploading} aria-label={`Upload revision for ${source.name}`}>
            <Upload />
            {attempt?.kind === "sending" ? "Sending…" : "Upload revision"}
          </Button>
          {attempt && status ? (
            <span
              className="text-xs text-muted-foreground"
              data-job-status={status}
              data-job-attempts={"job" in attempt && attempt.job ? attempt.job.attemptCount : undefined}
              role="status"
            >
              {attemptMessage(attempt)}
            </span>
          ) : null}
          {attempt?.kind === "failed" && attempt.job ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onRetry(attempt.job?.id ?? "")}
              aria-label={`Retry upload ${attempt.job.filename} for ${source.name}`}
            >
              <RotateCcw />
              Retry
            </Button>
          ) : null}
        </div>

        {source.revisions.length > 0 ? (
          <ol className="divide-y divide-border-soft border-t border-border-soft">
            {source.revisions.map((revision) => {
              const attached = member?.id === revision.id;
              return (
                <li
                  key={revision.id}
                  data-revision-id={revision.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{revision.filename}</span>
                    <span className="tnum block truncate text-[11px] text-muted-foreground">
                      {shortHash(revision.contentSha256)} · {revision.schemaLabel} ·{" "}
                      {revision.entityCount} entities
                      {revision.provenance === "incomplete" ? " · incomplete provenance" : ""}
                    </span>
                  </span>
                  {attached ? (
                    <Badge variant="secondary" aria-label={`${revision.filename} is attached`}>
                      Attached
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={membershipLocked || attachBusy !== null}
                      onClick={() => onAttach(revision)}
                      aria-label={`${member ? "Replace with" : "Attach"} ${revision.filename} for ${source.name}`}
                    >
                      {attachBusy === revision.id ? "Attaching…" : member ? "Replace" : "Attach"}
                    </Button>
                  )}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-xs text-muted-foreground">No revisions uploaded for this source yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

function RunPanel({
  runId,
  selectedRun,
  onClear,
}: {
  readonly runId: string;
  readonly selectedRun: Remote<RunDetail> | null;
  readonly onClear: () => void;
}): React.JSX.Element {
  if (!selectedRun || selectedRun.kind === "loading") {
    return (
      <p className="mt-3 text-sm text-muted-foreground" role="status">
        Loading run / 実行を読み込み中
      </p>
    );
  }
  if (selectedRun.kind === "failed") {
    return (
      <Alert variant="destructive" className="mt-3">
        <AlertTitle>Run unavailable</AlertTitle>
        <AlertDescription>{errorMessage(selectedRun.error)}</AlertDescription>
      </Alert>
    );
  }
  const detail = selectedRun.value;
  const provenance = detail.inputProvenance?.status === "complete" ? "complete" : "incomplete";
  return (
    <div className="mt-3 space-y-3 border-t border-border-soft pt-3" aria-label={`Run ${runId} detail`}>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="text-xs font-medium"
          data-provenance={provenance}
          aria-label={`Input provenance ${provenance}`}
        >
          Provenance: {provenance}
          {provenance === "incomplete" && detail.inputProvenance?.reason
            ? ` — ${detail.inputProvenance.reason}`
            : ""}
        </span>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onClear} aria-label="Clear selected run">
          Clear
        </Button>
      </div>
      <ol className="space-y-2">
        {detail.models.map((model: ModelInfo) => (
          <li key={model.id} data-revision-id={model.id} className="tnum text-xs">
            <span className="block truncate font-medium">
              {model.sourceModelName} · {model.filename}
            </span>
            <span className="block truncate font-mono text-[11px] text-muted-foreground">
              {model.contentSha256}
            </span>
            <span className="block text-[11px] text-muted-foreground">
              {model.schemaLabel} · {model.entityCount} entities · {model.productCount} products
            </span>
          </li>
        ))}
      </ol>
      <RunFacts run={detail.run} />
    </div>
  );
}

function RunFacts({ run }: { readonly run: RunSummary }): React.JSX.Element {
  return (
    <dl className="tnum grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2" aria-label="Run result facts">
      <div className="flex justify-between gap-3">
        <dt className="text-muted-foreground">Pack</dt>
        <dd>
          {run.packName} v{run.packVersion}
        </dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-muted-foreground">Status</dt>
        <dd>{run.status}</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-muted-foreground">Pass / fail</dt>
        <dd>
          {run.passCount} / {run.failCount}
        </dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-muted-foreground">Not applicable / incomplete</dt>
        <dd>
          {run.notApplicableCount} / {run.incompleteCount}
        </dd>
      </div>
    </dl>
  );
}
