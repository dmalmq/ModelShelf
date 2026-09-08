"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus, RotateCcw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DISCIPLINES,
  createDelivery,
  createSourceModel,
  errorMessage,
  fetchProject,
  listProjects,
  listSourceModels,
  type Remote,
} from "@/lib/shelf-api";
import type { DeliverySummary, Discipline, ProjectDetail, SourceModel } from "@/lib/types";

type ShelfStatus = "draft" | "finalized" | "processing" | "failed" | "checked";

const STATUS_LABEL: Record<ShelfStatus, string> = {
  draft: "Draft / 下書き",
  finalized: "Finalized / 確定",
  processing: "Run in progress / 実行中",
  failed: "Run failed / 実行失敗",
  checked: "Run complete / 実行完了",
};

function shelfDeliveryStatus(summary: DeliverySummary): ShelfStatus {
  if (summary.finalizedAt && summary.finalizedAt.length > 0) return "finalized";
  if (summary.latestRun?.status === "running") return "processing";
  if (summary.latestRun?.status === "failed") return "failed";
  if (summary.latestRun?.status === "completed") return "checked";
  return "draft";
}

type DisciplineFilter = Discipline | "all";

function isDiscipline(value: string | null): value is Discipline {
  return value === "ARCH" || value === "STRUCT" || value === "MEP" || value === "OTHER";
}


function shortHash(hash: string): string {
  return hash.length > 12 ? `${hash.slice(0, 12)}…` : hash;
}

export function ProjectShelf(): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const projectParam = searchParams.get("project");
  const rawDiscipline = searchParams.get("discipline");
  const discipline: DisciplineFilter = isDiscipline(rawDiscipline) ? rawDiscipline : "all";

  const [projects, setProjects] = useState<Remote<readonly { id: string; name: string; tenantName: string }[]>>({
    kind: "loading",
  });
  const [detail, setDetail] = useState<Remote<ProjectDetail>>({ kind: "loading" });
  const [sources, setSources] = useState<Remote<readonly SourceModel[]>>({ kind: "loading" });
  const [deliveryLabel, setDeliveryLabel] = useState("");
  const [deliveryBusy, setDeliveryBusy] = useState(false);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [sourceDiscipline, setSourceDiscipline] = useState<Discipline>("MEP");
  const [sourceBusy, setSourceBusy] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    setProjects({ kind: "loading" });
    void listProjects(abortController.signal)
      .then((value) => {
        if (!abortController.signal.aborted) setProjects({ kind: "ready", value });
      })
      .catch((reason: unknown) => {
        if (!abortController.signal.aborted) setProjects({ kind: "failed", error: reason });
      });
    return () => abortController.abort();
  }, []);

  const projectList = projects.kind === "ready" ? projects.value : null;
  const resolvedProjectId = useMemo(() => {
    if (!projectList) return null;
    if (projectParam && projectList.some((project) => project.id === projectParam)) return projectParam;
    return projectList[0]?.id ?? null;
  }, [projectList, projectParam]);

  useEffect(() => {
    if (!projectList) return;
    const projectIsValid = Boolean(projectParam && projectList.some((project) => project.id === projectParam));
    const disciplineIsValid = rawDiscipline === null || isDiscipline(rawDiscipline);
    if (projectIsValid && disciplineIsValid) return;
    const params = new URLSearchParams(searchParams.toString());
    if (!projectIsValid) {
      const first = projectList[0]?.id;
      if (first) {
        params.set("project", first);
      } else {
        params.delete("project");
      }
    }
    if (!disciplineIsValid) params.delete("discipline");
    const query = params.toString();
    router.replace(query.length > 0 ? `${pathname}?${query}` : pathname);
  }, [projectList, projectParam, rawDiscipline, pathname, router, searchParams]);

  const reloadProject = useCallback(
    (projectId: string, signal?: AbortSignal) => {
      setDetail({ kind: "loading" });
      setSources({ kind: "loading" });
      void fetchProject(projectId, signal)
        .then((value) => {
          if (!signal?.aborted) setDetail({ kind: "ready", value });
        })
        .catch((reason: unknown) => {
          if (!signal?.aborted) setDetail({ kind: "failed", error: reason });
        });
      void listSourceModels(projectId, signal)
        .then((value) => {
          if (!signal?.aborted) setSources({ kind: "ready", value });
        })
        .catch((reason: unknown) => {
          if (!signal?.aborted) setSources({ kind: "failed", error: reason });
        });
    },
    [],
  );

  useEffect(() => {
    if (!resolvedProjectId) return;
    const abortController = new AbortController();
    reloadProject(resolvedProjectId, abortController.signal);
    return () => abortController.abort();
  }, [resolvedProjectId, reloadProject]);

  const setParam = useCallback(
    (name: "project" | "discipline", value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === null) {
        params.delete(name);
      } else {
        params.set(name, value);
      }
      const query = params.toString();
      router.replace(query.length > 0 ? `${pathname}?${query}` : pathname);
    },
    [pathname, router, searchParams],
  );

  const deliveries = useMemo(() => {
    if (detail.kind !== "ready") return [];
    return [...detail.value.deliveries].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [detail]);

  const visibleSources = useMemo(() => {
    if (sources.kind !== "ready") return [];
    if (discipline === "all") return [...sources.value];
    return sources.value.filter((source) => source.discipline === discipline);
  }, [sources, discipline]);

  const deliveryHref = useCallback(
    (deliveryId: string) => {
      const params = new URLSearchParams();
      if (resolvedProjectId) params.set("project", resolvedProjectId);
      if (discipline !== "all") params.set("discipline", discipline);
      const query = params.toString();
      return `/deliveries/${encodeURIComponent(deliveryId)}${query.length > 0 ? `?${query}` : ""}`;
    },
    [resolvedProjectId, discipline],
  );

  async function submitDelivery(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!resolvedProjectId || deliveryBusy) return;
    setDeliveryBusy(true);
    setDeliveryError(null);
    try {
      await createDelivery(resolvedProjectId, { label: deliveryLabel.trim() });
      setDeliveryLabel("");
      reloadProject(resolvedProjectId);
    } catch (reason: unknown) {
      setDeliveryError(errorMessage(reason));
    } finally {
      setDeliveryBusy(false);
    }
  }

  async function submitSource(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!resolvedProjectId || sourceBusy) return;
    setSourceBusy(true);
    setSourceError(null);
    try {
      await createSourceModel(resolvedProjectId, { name: sourceName.trim(), discipline: sourceDiscipline });
      setSourceName("");
      const fresh = await listSourceModels(resolvedProjectId);
      setSources({ kind: "ready", value: fresh });
    } catch (reason: unknown) {
      setSourceError(errorMessage(reason));
    } finally {
      setSourceBusy(false);
    }
  }

  if (projects.kind === "loading") {
    return (
      <main className="mx-auto w-full max-w-5xl space-y-4 p-6" aria-label="Project shelf">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <p className="text-sm text-muted-foreground" role="status">
          Loading projects / プロジェクトを読み込み中
        </p>
      </main>
    );
  }

  if (projects.kind === "failed") {
    return (
      <main className="mx-auto grid w-full max-w-5xl place-items-center p-6">
        <Alert variant="destructive" className="max-w-lg">
          <AlertTitle>Projects unavailable / プロジェクトを開けません</AlertTitle>
          <AlertDescription>{errorMessage(projects.error)}</AlertDescription>
          <Button className="mt-4" variant="outline" size="sm" onClick={() => window.location.reload()}>
            <RotateCcw />
            Retry / 再試行
          </Button>
        </Alert>
      </main>
    );
  }

  if (!projectList || projectList.length === 0) {
    return (
      <main className="mx-auto grid w-full max-w-5xl place-items-center p-6">
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle>No projects yet / プロジェクトがありません</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Seed the checker service to create the demo project, then reload this page.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  const selectedName = projectList.find((project) => project.id === resolvedProjectId)?.name ?? "";

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 p-6" aria-label="Project shelf">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-sm font-semibold">ModelShelf</span>
        <span aria-hidden className="h-5 w-px bg-border" />
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">Project shelf / プロジェクト棚</h1>
          <p className="truncate text-xs text-muted-foreground">
            {selectedName} · deliveries, sources, and assembly context
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Label htmlFor="project-select" className="text-xs text-muted-foreground">
            Project
          </Label>
          <Select
            value={resolvedProjectId ?? ""}
            onValueChange={(value) => setParam("project", value)}
            disabled={projectList.length < 2}
          >
            <SelectTrigger id="project-select" className="w-48" aria-label="Select project">
              <SelectValue placeholder="Select project" />
            </SelectTrigger>
            <SelectContent>
              {projectList.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      <section aria-label="Deliveries">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Deliveries / デリバリー</h2>
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {detail.kind === "ready" ? `${deliveries.length} deliveries` : ""}
          </span>
        </div>
        <Card>
          <CardContent className="space-y-4 pt-4">
            <form onSubmit={submitDelivery} className="flex flex-wrap items-end gap-2">
              <div className="min-w-48 flex-1 space-y-1">
                <Label htmlFor="delivery-label">New delivery label</Label>
                <Input
                  id="delivery-label"
                  value={deliveryLabel}
                  onChange={(event) => setDeliveryLabel(event.target.value)}
                  placeholder="e.g. drop-3"
                  maxLength={120}
                  disabled={deliveryBusy}
                />
              </div>
              <Button type="submit" disabled={deliveryBusy || deliveryLabel.trim().length === 0}>
                <Plus />
                Create delivery
              </Button>
            </form>
            {deliveryError ? (
              <Alert variant="destructive">
                <AlertTitle>Delivery was not created</AlertTitle>
                <AlertDescription>{deliveryError}</AlertDescription>
              </Alert>
            ) : null}
            {detail.kind === "loading" ? (
              <p className="text-sm text-muted-foreground" role="status">
                Loading deliveries / デリバリーを読み込み中
              </p>
            ) : null}
            {detail.kind === "failed" ? (
              <Alert variant="destructive">
                <AlertTitle>Deliveries unavailable</AlertTitle>
                <AlertDescription>{errorMessage(detail.error)}</AlertDescription>
                <Button
                  className="mt-3"
                  variant="outline"
                  size="sm"
                  onClick={() => resolvedProjectId && reloadProject(resolvedProjectId)}
                >
                  <RotateCcw />
                  Retry / 再試行
                </Button>
              </Alert>
            ) : null}
            {detail.kind === "ready" && deliveries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No deliveries yet. Name one above to start the first drop.
              </p>
            ) : null}
            {detail.kind === "ready" && deliveries.length > 0 ? (
              <ol className="divide-y divide-border-soft">
                {deliveries.map((summary) => {
                  const status = shelfDeliveryStatus(summary);
                  return (
                    <li key={summary.id} data-delivery-id={summary.id} data-status={status}>
                      <Link
                        href={deliveryHref(summary.id)}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{summary.label}</span>
                          <span className="tnum block truncate text-xs text-muted-foreground">
                            {summary.modelCount} sources · {summary.productCount} products
                            {summary.latestRun
                              ? ` · ${summary.latestRun.packName} v${summary.latestRun.packVersion}`
                              : ""}
                          </span>
                        </span>
                        <Badge variant="secondary">{STATUS_LABEL[status]}</Badge>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <section aria-label="Sources">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold">Sources / ソース</h2>
          <div className="ml-auto flex items-center gap-2">
            <Label htmlFor="discipline-filter" className="text-xs text-muted-foreground">
              Discipline
            </Label>
            <Select
              value={discipline}
              onValueChange={(value) =>
                setParam("discipline", value === "all" ? null : value)
              }
            >
              <SelectTrigger id="discipline-filter" className="w-32" aria-label="Filter sources by discipline">
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
        <Card>
          <CardContent className="space-y-4 pt-4">
            <form onSubmit={submitSource} className="flex flex-wrap items-end gap-2">
              <div className="min-w-48 flex-1 space-y-1">
                <Label htmlFor="source-name">New source name</Label>
                <Input
                  id="source-name"
                  value={sourceName}
                  onChange={(event) => setSourceName(event.target.value)}
                  placeholder="e.g. MEP North"
                  maxLength={120}
                  disabled={sourceBusy}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="source-discipline">Discipline</Label>
                <Select
                  value={sourceDiscipline}
                  onValueChange={(value) => {
                    if (isDiscipline(value)) setSourceDiscipline(value);
                  }}
                  disabled={sourceBusy}
                >
                  <SelectTrigger id="source-discipline" className="w-32" aria-label="New source discipline">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DISCIPLINES.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={sourceBusy || sourceName.trim().length === 0}>
                <Plus />
                Create source
              </Button>
            </form>
            {sourceError ? (
              <Alert variant="destructive">
                <AlertTitle>Source was not created</AlertTitle>
                <AlertDescription>{sourceError}</AlertDescription>
              </Alert>
            ) : null}
            {sources.kind === "loading" ? (
              <p className="text-sm text-muted-foreground" role="status">
                Loading sources / ソースを読み込み中
              </p>
            ) : null}
            {sources.kind === "failed" ? (
              <Alert variant="destructive">
                <AlertTitle>Sources unavailable</AlertTitle>
                <AlertDescription>{errorMessage(sources.error)}</AlertDescription>
                <Button
                  className="mt-3"
                  variant="outline"
                  size="sm"
                  onClick={() => resolvedProjectId && reloadProject(resolvedProjectId)}
                >
                  <RotateCcw />
                  Retry / 再試行
                </Button>
              </Alert>
            ) : null}
            {sources.kind === "ready" && visibleSources.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {sources.value.length === 0
                  ? "No sources yet. Name one above. Two sources may share a discipline."
                  : `No ${discipline} sources. Clear the filter to see every source.`}
              </p>
            ) : null}
            {sources.kind === "ready" && visibleSources.length > 0 ? (
              <ol className="divide-y divide-border-soft">
                {visibleSources.map((source) => {
                  const latest = source.revisions[0] ?? null;
                  return (
                    <li key={source.id} data-source-id={source.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{source.name}</span>
                        <span className="tnum block truncate text-xs text-muted-foreground">
                          {source.revisions.length} revisions
                          {latest ? ` · latest ${latest.filename} · ${shortHash(latest.contentSha256)}` : " · no revisions yet"}
                        </span>
                      </span>
                      <Badge variant="outline">{source.discipline}</Badge>
                    </li>
                  );
                })}
              </ol>
            ) : null}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
