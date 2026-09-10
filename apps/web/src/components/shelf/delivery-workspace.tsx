"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Lock, Presentation, RotateCcw, Upload } from "lucide-react";
import { LocaleSwitcher } from "@/components/domain/locale-switcher";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ReviewScreen } from "@/components/review/review-screen";
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
import { DELIVERY_COPY, type Locale } from "@/lib/i18n";
import { useLocale } from "@/components/locale-provider";

type UploadAttempt =
  | { kind: "sending"; filename: string }
  | { kind: "processing"; job: IngestionJob }
  | { kind: "completed"; job: IngestionJob }
  | { kind: "failed"; job: IngestionJob | null; message: string };

type DisciplineFilter = Discipline | "all";

const WORKSPACE_COPY = {
  ja: {
    workspace: "デリバリーワークスペース",
    loadingDelivery: "デリバリーを読み込み中",
    unavailable: "デリバリーを開けません",
    retry: "再試行",
    members: (count: number) => `${count}メンバー`,
    draft: "下書き",
    finalized: "確定",
    runLocked: "完了したランによりロック",
    finalizeFailed: "デリバリーを確定できませんでした",
    assembly: "構成",
    assemblyHint: "リビジョンをアップロードした後、明示的に追加してください。アップロードだけでは構成に追加されません。",
    discipline: "分野",
    filterDiscipline: "分野でソースを絞り込み",
    all: "すべて",
    loadingSources: "ソースを読み込み中",
    sourcesUnavailable: "ソースを開けません",
    noMatchingSources: "この絞り込みに一致するソースはありません。分野の絞り込みを解除するか、プロジェクト棚でソースを作成してください。",
    attachFailed: "リビジョンを追加できませんでした",
    runHistory: "ラン履歴",
    noRuns: "ランはまだありません。リビジョンを含むデリバリーではランを作成できます。",
    runSummary: (status: string, pass: number, fail: number, incomplete: number) =>
      `${status} · 合格${pass} · 不合格${fail} · 未判定${incomplete}`,
    viewRun: "ランを表示",
    hideRun: "ランを閉じる",
    combinedView: "結合ビュー",
    noRevisions: "このデリバリーにはまだリビジョンがありません。",
    noRevisionsHint: "上のソース行からファイルをアップロードし、処理完了後にリビジョンを追加してください。最初のリビジョンを追加すると結合ビューが表示されます。",
    findingsReview: "指摘レビュー",
    selectSource: (name: string) => `${name}ソースを選択`,
    revisions: (count: number) => `${count}リビジョン`,
    attached: "追加済み",
    notAttached: "未追加",
    attachedRevision: (name: string) => `${name}に追加されたリビジョン`,
    file: "ファイル",
    hash: "ハッシュ",
    schema: "スキーマ",
    entitiesProducts: "エンティティ / プロダクト",
    noAttached: "リビジョンが追加されていません。下から追加すると、このソースがデリバリーに含まれます。",
    chooseFile: (name: string) => `${name}のIFCファイルを選択`,
    uploadRevision: "リビジョンをアップロード",
    uploadFor: (name: string) => `${name}にリビジョンをアップロード`,
    sending: "送信中…",
    retryUpload: (file: string, name: string) => `${name}の${file}を再アップロード`,
    entities: "エンティティ",
    incompleteProvenance: "来歴未確定",
    isAttached: (file: string) => `${file}は追加済み`,
    replaceWith: (file: string, name: string) => `${name}を${file}で置換`,
    attachFor: (file: string, name: string) => `${file}を${name}に追加`,
    attaching: "追加中…",
    replace: "置換",
    attach: "追加",
    noUploads: "このソースにはまだリビジョンがアップロードされていません。",
    loadingRun: "ランを読み込み中",
    runUnavailable: "ランを開けません",
    runDetail: (id: string) => `ラン${id}の詳細`,
    provenance: "入力来歴",
    complete: "完全",
    incomplete: "未確定",
    clearRun: "選択したランを閉じる",
    clear: "閉じる",
    modelCounts: (entities: number, products: number) => `${entities}エンティティ · ${products}プロダクト`,
    runFacts: "ラン結果",
    pack: "チェックパック",
    status: "状態",
    passFail: "合格 / 不合格",
    notApplicableIncomplete: "対象外 / 未判定",
  },
  en: {
    workspace: "Delivery workspace",
    loadingDelivery: "Loading delivery",
    unavailable: "Delivery unavailable",
    retry: "Retry",
    members: (count: number) => `${count} ${count === 1 ? "member" : "members"}`,
    draft: "Draft",
    finalized: "Finalized",
    runLocked: "Locked by completed run",
    finalizeFailed: "Delivery was not finalized",
    assembly: "Assembly",
    assemblyHint: "Upload a revision, then explicitly attach it. Uploads never attach themselves.",
    discipline: "Discipline",
    filterDiscipline: "Filter sources by discipline",
    all: "All",
    loadingSources: "Loading sources",
    sourcesUnavailable: "Sources unavailable",
    noMatchingSources: "No sources match this filter. Clear the discipline filter or create a source on the shelf.",
    attachFailed: "Revision was not attached",
    runHistory: "Run history",
    noRuns: "No runs yet. A run can be created against this delivery once it holds revisions.",
    runSummary: (status: string, pass: number, fail: number, incomplete: number) =>
      `${status} · pass ${pass} · fail ${fail} · incomplete ${incomplete}`,
    viewRun: "View run",
    hideRun: "Hide run",
    combinedView: "Combined view",
    noRevisions: "This delivery holds no revisions yet.",
    noRevisionsHint: "Upload a file on one of the source rows above, wait for processing to complete, then attach the revision. The combined viewer appears once the first revision is attached.",
    findingsReview: "Findings review",
    selectSource: (name: string) => `Select source ${name}`,
    revisions: (count: number) => `${count} ${count === 1 ? "revision" : "revisions"}`,
    attached: "attached",
    notAttached: "not attached",
    attachedRevision: (name: string) => `Attached revision of ${name}`,
    file: "File",
    hash: "Hash",
    schema: "Schema",
    entitiesProducts: "Entities / products",
    noAttached: "No revision attached. Attach one below to include this source in the delivery.",
    chooseFile: (name: string) => `Choose IFC file for ${name}`,
    uploadRevision: "Upload revision",
    uploadFor: (name: string) => `Upload revision for ${name}`,
    sending: "Sending…",
    retryUpload: (file: string, name: string) => `Retry upload ${file} for ${name}`,
    entities: "entities",
    incompleteProvenance: "incomplete provenance",
    isAttached: (file: string) => `${file} is attached`,
    replaceWith: (file: string, name: string) => `Replace ${name} with ${file}`,
    attachFor: (file: string, name: string) => `Attach ${file} for ${name}`,
    attaching: "Attaching…",
    replace: "Replace",
    attach: "Attach",
    noUploads: "No revisions uploaded for this source yet.",
    loadingRun: "Loading run",
    runUnavailable: "Run unavailable",
    runDetail: (id: string) => `Run ${id} detail`,
    provenance: "Input provenance",
    complete: "complete",
    incomplete: "incomplete",
    clearRun: "Clear selected run",
    clear: "Clear",
    modelCounts: (entities: number, products: number) => `${entities} entities · ${products} products`,
    runFacts: "Run result facts",
    pack: "Pack",
    status: "Status",
    passFail: "Pass / fail",
    notApplicableIncomplete: "Not applicable / incomplete",
  },
} as const;

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

function attemptMessage(attempt: UploadAttempt, locale: Locale): string {
  const copy = WORKSPACE_COPY[locale];
  if (attempt.kind === "sending") return `${copy.sending} ${attempt.filename}`;
  if (attempt.kind === "processing") return `${attempt.job.status} ${attempt.job.filename}…`;
  if (attempt.kind === "completed") return `${copy.attached}: ${attempt.job.filename}`;
  return `${attempt.job?.status ?? "failed"}: ${attempt.message}`;
}

export function DeliveryWorkspace({ deliveryId }: { readonly deliveryId: string }): React.JSX.Element {
  const { locale } = useLocale();
  const deliveryCopy = DELIVERY_COPY[locale];
  const copy = WORKSPACE_COPY[locale];
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const projectParam = searchParams.get("project");
  const rawDiscipline = searchParams.get("discipline");
  const discipline: DisciplineFilter = isDiscipline(rawDiscipline) ? rawDiscipline : "all";
  const sourceParam = searchParams.get("source");
  const runParam = searchParams.get("run");
  const meetingView = searchParams.get("view") === "meeting";

  const [detail, setDetail] = useState<Remote<DeliveryDetail>>({ kind: "loading" });
  const [sources, setSources] = useState<Remote<readonly SourceModel[]>>({ kind: "loading" });
  const [attempts, setAttempts] = useState<Readonly<Record<string, UploadAttempt>>>({});
  const [selectedRun, setSelectedRun] = useState<Remote<RunDetail> | null>(null);
  const [attachBusy, setAttachBusy] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [finalizeBusy, setFinalizeBusy] = useState(false);
  const [finalizeConfirmOpen, setFinalizeConfirmOpen] = useState(false);
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
      <div className="mx-auto w-full max-w-6xl space-y-4 p-6" aria-label={copy.workspace}>
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-48 w-full" />
        <p className="text-sm text-muted-foreground" role="status">
          {copy.loadingDelivery}
        </p>
      </div>
    );
  }

  if (detail.kind === "failed") {
    return (
      <div className="mx-auto grid w-full max-w-6xl place-items-center p-6">
        <Alert variant="destructive" className="max-w-lg">
          <AlertTitle>{copy.unavailable}</AlertTitle>
          <AlertDescription>{errorMessage(detail.error)}</AlertDescription>
          <Button className="mt-4" variant="outline" size="sm" onClick={() => window.location.reload()}>
            <RotateCcw />
            {copy.retry}
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
    <div
      className={`mx-auto w-full space-y-6 p-3 sm:p-6 ${meetingView ? "max-w-[1800px]" : "max-w-6xl"}`}
      data-delivery-id={deliveryId}
      data-view-mode={meetingView ? "meeting" : "desk"}
      aria-label={copy.workspace}
    >
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href={backQuery.length > 0 ? `/?${backQuery}` : "/"} aria-label="Back to project shelf">
            <ArrowLeft />
          </Link>
        </Button>
        <span aria-hidden className="h-5 w-px bg-border" />
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">{readyDetail.delivery.label}</h1>
          <p className="tnum truncate text-xs text-muted-foreground">
            {readyDetail.delivery.id} · {copy.members(readyDetail.models.length)}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
          {lock.kind === "draft" ? <Badge variant="secondary">{copy.draft}</Badge> : null}
          {lock.kind === "finalized" ? (
            <Badge data-delivery-finalized variant="secondary">{copy.finalized} · {lock.finalizedAt}</Badge>
          ) : null}
          {lock.kind === "runLocked" ? (
            <Badge variant="secondary" data-run-locked>
              <Lock />
              {copy.runLocked}
            </Badge>
          ) : null}
          {lock.kind === "draft" ? (
            <Button data-finalize-trigger size="sm" onClick={() => setFinalizeConfirmOpen(true)} disabled={finalizeBusy}>
              <Lock />
              {deliveryCopy.finalizeConfirm}
            </Button>
          ) : null}
          <div className="flex items-center" role="group" aria-label={deliveryCopy.viewMode}>
            <Button
              type="button"
              variant={meetingView ? "outline" : "secondary"}
              size="sm"
              className="min-h-11 sm:min-h-8"
              aria-pressed={!meetingView}
              data-view-mode-toggle="desk"
              onClick={() => setParam({ view: null })}
            >
              {deliveryCopy.deskView}
            </Button>
            <Button
              type="button"
              variant={meetingView ? "secondary" : "outline"}
              size="sm"
              className="min-h-11 sm:min-h-8"
              aria-pressed={meetingView}
              data-view-mode-toggle="meeting"
              onClick={() => setParam({ view: "meeting" })}
            >
              <Presentation />
              {deliveryCopy.meetingView}
            </Button>
          </div>
          <LocaleSwitcher />
        </div>
      </header>
      <Dialog open={finalizeConfirmOpen} onOpenChange={setFinalizeConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{deliveryCopy.finalizeTitle}</DialogTitle>
            <DialogDescription>{deliveryCopy.finalizeDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setFinalizeConfirmOpen(false)}>
              {deliveryCopy.finalizeCancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              data-finalize-confirm
              onClick={() => {
                setFinalizeConfirmOpen(false);
                void finalize();
              }}
            >
              {deliveryCopy.finalizeConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {finalizeError ? (
        <Alert variant="destructive">
          <AlertTitle>{copy.finalizeFailed}</AlertTitle>
          <AlertDescription>{finalizeError}</AlertDescription>
        </Alert>
      ) : null}

      {meetingView ? (
        <section aria-label={deliveryCopy.meetingReview} data-meeting-review>
          <div className="overflow-hidden border border-border">
            <ReviewScreen deliveryId={deliveryId} presentation="meeting" />
          </div>
        </section>
      ) : (
        <>
      <section aria-label={copy.assembly}>
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold">{copy.assembly}</h2>
          <p className="text-xs text-muted-foreground">{copy.assemblyHint}</p>
          <div className="ml-auto flex items-center gap-2">
            <Label htmlFor="workspace-discipline" className="text-xs text-muted-foreground">
              {copy.discipline}
            </Label>
            <Select
              value={discipline}
              onValueChange={(value) => setParam({ discipline: value === "all" ? null : value })}
            >
              <SelectTrigger id="workspace-discipline" className="w-32" aria-label={copy.filterDiscipline}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{copy.all}</SelectItem>
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
            {copy.loadingSources}
          </p>
        ) : null}
        {sources.kind === "failed" ? (
          <Alert variant="destructive">
            <AlertTitle>{copy.sourcesUnavailable}</AlertTitle>
            <AlertDescription>{errorMessage(sources.error)}</AlertDescription>
          </Alert>
        ) : null}
        {sources.kind === "ready" && visibleSources.length === 0 ? (
          <Card>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">{copy.noMatchingSources}</p>
            </CardContent>
          </Card>
        ) : null}
        {attachError ? (
          <Alert variant="destructive">
            <AlertTitle>{copy.attachFailed}</AlertTitle>
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

      <section aria-label={copy.runHistory}>
        <h2 className="mb-2 text-sm font-semibold">{copy.runHistory}</h2>
        {orderedRuns.length === 0 ? (
          <Card>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">{copy.noRuns}</p>
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
                        {copy.runSummary(run.status, run.passCount, run.failCount, run.incompleteCount)}
                      </span>
                    </span>
                    <Button
                      variant={runParam === run.id ? "secondary" : "outline"}
                      size="sm"
                      aria-pressed={runParam === run.id}
                      data-view-run={run.id}
                      aria-label={`${copy.viewRun} ${run.packName} version ${run.packVersion}`}
                      onClick={() => setParam({ run: runParam === run.id ? null : run.id })}
                    >
                      {runParam === run.id ? copy.hideRun : copy.viewRun}
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

      <section
        aria-label={copy.findingsReview}
        data-combined-section
        data-findings-review-section
        data-model-count={readyDetail.models.length}
      >
        <h2 className="mb-2 text-sm font-semibold">{copy.findingsReview}</h2>
        {readyDetail.models.length === 0 ? (
          <Card data-combined-empty>
            <CardContent className="pt-4">
              <p className="text-sm font-medium">{copy.noRevisions}</p>
              <p className="mt-1 text-sm text-muted-foreground">{copy.noRevisionsHint}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <ReviewScreen
              key={`${deliveryId}:${runParam ?? "live"}:${viewerMembershipKey}`}
              deliveryId={deliveryId}
            />
          </div>
        )}
      </section>
        </>
      )}
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
  const { locale } = useLocale();
  const copy = WORKSPACE_COPY[locale];
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
            aria-label={copy.selectSource(source.name)}
            className="min-h-11 min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-ring"
          >
            <CardTitle className="truncate text-sm">{source.name}</CardTitle>
            <span className="tnum block truncate text-xs font-normal text-muted-foreground">
              {copy.revisions(source.revisions.length)}
              {member ? ` · ${copy.attached} ${member.filename} · ${shortHash(member.contentSha256)}` : ` · ${copy.notAttached}`}
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
            aria-label={copy.attachedRevision(source.name)}
          >
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{copy.file}</dt>
              <dd className="truncate font-medium">{member.filename}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{copy.hash}</dt>
              <dd className="truncate font-mono text-xs">{member.contentSha256}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{copy.schema}</dt>
              <dd>{member.schemaLabel}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{copy.entitiesProducts}</dt>
              <dd>
                {member.entityCount} / {member.productCount}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-xs text-muted-foreground">{copy.noAttached}</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor={`file-${source.id}`} className="sr-only">
            {copy.chooseFile(source.name)}
          </Label>
          <input
            ref={onFileRef}
            id={`file-${source.id}`}
            type="file"
            accept=".ifc"
            disabled={uploading}
            className="max-w-64 text-xs text-muted-foreground file:mr-2 file:border file:border-border file:bg-secondary file:px-2 file:py-1 file:text-xs file:font-medium file:text-secondary-foreground hover:file:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
          />
          <Button
            size="sm"
            variant="outline"
            className="min-h-11 sm:min-h-8"
            onClick={onUpload}
            disabled={uploading}
            aria-label={copy.uploadFor(source.name)}
            data-upload-revision
          >
            <Upload />
            {attempt?.kind === "sending" ? copy.sending : copy.uploadRevision}
          </Button>
          {attempt && status ? (
            <span
              className="text-xs text-muted-foreground"
              data-job-status={status}
              data-job-attempts={"job" in attempt && attempt.job ? attempt.job.attemptCount : undefined}
              role="status"
            >
              {attemptMessage(attempt, locale)}
            </span>
          ) : null}
          {attempt?.kind === "failed" && attempt.job ? (
            <Button
              size="sm"
              variant="outline"
              className="min-h-11 sm:min-h-8"
              onClick={() => onRetry(attempt.job?.id ?? "")}
              aria-label={copy.retryUpload(attempt.job.filename, source.name)}
              data-retry-upload
            >
              <RotateCcw />
              {copy.retry}
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
                    <span className="tnum block truncate text-xs text-muted-foreground">
                      {shortHash(revision.contentSha256)} · {revision.schemaLabel} ·{" "}
                      {revision.entityCount} {copy.entities}
                      {revision.provenance === "incomplete" ? ` · ${copy.incompleteProvenance}` : ""}
                    </span>
                  </span>
                  {attached ? (
                    <Badge variant="secondary" aria-label={copy.isAttached(revision.filename)}>
                      {copy.attached}
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="min-h-11 sm:min-h-8"
                      disabled={membershipLocked || attachBusy !== null}
                      onClick={() => onAttach(revision)}
                      aria-label={member ? copy.replaceWith(revision.filename, source.name) : copy.attachFor(revision.filename, source.name)}
                      data-attach-revision
                    >
                      {attachBusy === revision.id ? copy.attaching : member ? copy.replace : copy.attach}
                    </Button>
                  )}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-xs text-muted-foreground">{copy.noUploads}</p>
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
  const { locale } = useLocale();
  const copy = WORKSPACE_COPY[locale];
  if (!selectedRun || selectedRun.kind === "loading") {
    return (
      <p className="mt-3 text-sm text-muted-foreground" role="status">
        {copy.loadingRun}
      </p>
    );
  }
  if (selectedRun.kind === "failed") {
    return (
      <Alert variant="destructive" className="mt-3">
        <AlertTitle>{copy.runUnavailable}</AlertTitle>
        <AlertDescription>{errorMessage(selectedRun.error)}</AlertDescription>
      </Alert>
    );
  }
  const detail = selectedRun.value;
  const provenance = detail.inputProvenance?.status === "complete" ? "complete" : "incomplete";
  return (
    <div className="mt-3 space-y-3 border-t border-border-soft pt-3" data-run-detail={runId} aria-label={copy.runDetail(runId)}>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="text-xs font-medium"
          data-provenance={provenance}
          aria-label={`${copy.provenance} ${provenance}`}
        >
          {copy.provenance}: {provenance === "complete" ? copy.complete : copy.incomplete}
          {provenance === "incomplete" && detail.inputProvenance?.reason
            ? ` — ${detail.inputProvenance.reason}`
            : ""}
        </span>
        <Button variant="ghost" size="sm" className="ml-auto min-h-11 sm:min-h-8" onClick={onClear} aria-label={copy.clearRun}>
          {copy.clear}
        </Button>
      </div>
      <ol className="space-y-2">
        {detail.models.map((model: ModelInfo) => (
          <li key={model.id} data-revision-id={model.id} className="tnum text-xs">
            <span className="block truncate font-medium">
              {model.sourceModelName} · {model.filename}
            </span>
            <span className="block truncate font-mono text-xs text-muted-foreground">
              {model.contentSha256}
            </span>
            <span className="block text-xs text-muted-foreground">
              {model.schemaLabel} · {copy.modelCounts(model.entityCount, model.productCount)}
            </span>
          </li>
        ))}
      </ol>
      <RunFacts run={detail.run} />
    </div>
  );
}

function RunFacts({ run }: { readonly run: RunSummary }): React.JSX.Element {
  const { locale } = useLocale();
  const copy = WORKSPACE_COPY[locale];
  return (
    <dl className="tnum grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2" aria-label={copy.runFacts}>
      <div className="flex justify-between gap-3">
        <dt className="text-muted-foreground">{copy.pack}</dt>
        <dd>
          {run.packName} v{run.packVersion}
        </dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-muted-foreground">{copy.status}</dt>
        <dd>{run.status}</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-muted-foreground">{copy.passFail}</dt>
        <dd>
          {run.passCount} / {run.failCount}
        </dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-muted-foreground">{copy.notApplicableIncomplete}</dt>
        <dd>
          {run.notApplicableCount} / {run.incompleteCount}
        </dd>
      </div>
    </dl>
  );
}
