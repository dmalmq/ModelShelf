// Pack history and run creation. Pack versions are immutable: switching packs
// mints a new run via POST /api/runs and never mutates an old one — old results
// stay reachable through the run selector, labelled pack name + version + status.
"use client";

import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import type { DeliveryDetail, Pack, RunDetail, RunSummary } from "@/lib/types";
import { formatDateTime, shortHash } from "@/lib/format";

interface PackSelectionProps {
  readonly delivery: DeliveryDetail;
  readonly selectedRunId: string | null;
  readonly creating: boolean;
  readonly onSelectRun: (runId: string) => void;
  readonly onRunCreated: (detail: RunDetail) => void;
  readonly onCreatingChange: (creating: boolean) => void;
}

export function PackSelection({
  delivery,
  selectedRunId,
  creating,
  onSelectRun,
  onRunCreated,
  onCreatingChange,
}: PackSelectionProps): React.JSX.Element {
  const [packs, setPacks] = useState<Pack[] | null>(null);
  const [packsError, setPacksError] = useState<string | null>(null);
  const [packVersionId, setPackVersionId] = useState<string>("");
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    setPacks(null);
    setPacksError(null);
    void fetch("/api/packs", { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Packs request failed with HTTP ${response.status}`);
        const value: unknown = await response.json();
        if (!Array.isArray(value)) throw new Error("Packs payload must be an array");
        return value as Pack[];
      })
      .then((loaded) => {
        if (abort.signal.aborted) return;
        setPacks(loaded);
        setPackVersionId((current) => {
          if (current) return current;
          const latest = latestPackVersionId(loaded, delivery);
          return latest ?? "";
        });
      })
      .catch((reason: unknown) => {
        if (abort.signal.aborted) return;
        setPacksError(reason instanceof Error ? reason.message : "Packs could not be loaded");
      });
    return () => abort.abort();
  }, [delivery]);

  async function createRun(): Promise<void> {
    if (!packVersionId || creating) return;
    onCreatingChange(true);
    setCreateError(null);
    try {
      const created = await postRun(delivery.delivery.id, packVersionId);
      const settled = await pollRunDetail(created.run.id);
      onRunCreated(settled);
    } catch (reason: unknown) {
      setCreateError(reason instanceof Error ? reason.message : "Run could not be created");
    } finally {
      onCreatingChange(false);
    }
  }

  const runs = [...delivery.runs].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? null;

  return (
    <section aria-label="Pack and run / パックとラン" data-pack-selection>
      <label className="block text-xs">
        <span className="mb-1 block font-medium">ラン / Run</span>
        {runs.length === 0 ? (
          <p className="text-xs text-muted-foreground" data-no-runs>
            このデリバリーにはランがありません / No runs for this delivery yet.
          </p>
        ) : (
          <select
            aria-label="Run"
            className="w-full border border-border bg-card px-2 py-1.5 text-xs"
            value={selectedRunId ?? ""}
            onChange={(event) => {
              if (event.target.value) onSelectRun(event.target.value);
            }}
            data-run-selector
          >
            {runs.map((run) => (
              <option key={run.id} value={run.id} data-run-option={run.id}>
                {runLabel(run)}
              </option>
            ))}
          </select>
        )}
      </label>

      {selectedRun?.status === "failed" && (
        <p className="mt-1.5 border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-xs" data-failed-run>
          <span className="font-medium">ラン失敗 / Run failed:</span> {selectedRun.error ?? "unknown error"}{" "}
          <span className="text-muted-foreground">
            — 失敗したランは残ります。同じパックで再試行するか、別バージョンで新規ランを作成してください。
          </span>
        </p>
      )}

      <div className="mt-2 space-y-1.5 border-t border-border pt-2">
        <p className="text-xs font-medium">新規ラン / New run</p>
        {packsError ? (
          <p className="text-xs text-destructive">{packsError}</p>
        ) : !packs ? (
          <p className="text-xs text-muted-foreground" role="status">
            Loading packs…
          </p>
        ) : (
          <label className="block text-xs">
            <span className="mb-1 block text-muted-foreground">パックバージョン / Pack version</span>
            <select
              aria-label="Pack version"
              className="w-full border border-border bg-card px-2 py-1.5 text-xs"
              value={packVersionId}
              onChange={(event) => setPackVersionId(event.target.value)}
              data-pack-version-selector
            >
              <option value="">Select a pack version…</option>
              {packs.map((pack) => (
                <optgroup key={pack.id} label={pack.name}>
                  {[...pack.versions]
                    .sort((a, b) => b.version - a.version)
                    .map((version) => (
                      <option
                        key={version.id}
                        value={version.id}
                        data-pack-version-option={version.id}
                      >
                        {pack.name} v{version.version} · {version.specCount} specs ·{" "}
                        {formatDateTime(version.createdAt)}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
        )}
        {createError && (
          <p className="text-xs text-destructive" data-create-error>
            {createError}
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant="outline"
            size="sm"
            disabled={!packVersionId || creating}
            onClick={() => void createRun()}
            data-create-run
          >
            {creating ? "実行中… / Running…" : "ラン実行 / Run checks"}
          </Button>
          {selectedRun?.status === "failed" && (
            <Button
              variant="ghost"
              size="sm"
              disabled={creating}
              onClick={() => {
                // Failed-run recovery: retry the exact same pack version as a new run.
                setPackVersionId(selectedRun.packVersionId);
                void createRunWith(delivery.delivery.id, selectedRun.packVersionId, {
                  onRunCreated,
                  onCreatingChange,
                  setCreateError,
                });
                onCreatingChange(true);
              }}
              data-retry-run
            >
              再試行 / Retry same pack
            </Button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          パックを切り替えると新しい不変ランが作成され、過去の結果はラン選択で保持されます / Switching packs
          creates a new immutable run; old results stay in the run selector.
        </p>
      </div>
    </section>
  );
}

export function runLabel(run: RunSummary): string {
  return `${run.packName} v${run.packVersion} · ${run.status} · ${shortHash(run.id)}`;
}

function latestPackVersionId(packs: Pack[], delivery: DeliveryDetail): string | null {
  const latestRun = [...delivery.runs].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0];
  if (latestRun) return latestRun.packVersionId;
  const first = packs[0]?.versions;
  if (!first || first.length === 0) return null;
  return [...first].sort((a, b) => b.version - a.version)[0].id;
}

async function postRun(deliveryId: string, packVersionId: string): Promise<RunDetail> {
  const response = await fetch("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deliveryId, packVersionId }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Run creation failed with HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  return (await response.json()) as RunDetail;
}

/** Poll a fresh run to its terminal status; creation is synchronous but may lag. */
async function pollRunDetail(runId: string): Promise<RunDetail> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`);
    if (!response.ok) throw new Error(`Run request failed with HTTP ${response.status}`);
    const detail = (await response.json()) as RunDetail;
    if (detail.run.status === "completed" || detail.run.status === "failed") return detail;
    if (Date.now() > deadline) throw new Error("Run did not settle within 120 s");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function createRunWith(
  deliveryId: string,
  packVersionId: string,
  hooks: {
    onRunCreated: (detail: RunDetail) => void;
    onCreatingChange: (creating: boolean) => void;
    setCreateError: (error: string | null) => void;
  },
): Promise<void> {
  try {
    const created = await postRun(deliveryId, packVersionId);
    hooks.onRunCreated(await pollRunDetail(created.run.id));
  } catch (reason: unknown) {
    hooks.setCreateError(reason instanceof Error ? reason.message : "Run could not be created");
  } finally {
    hooks.onCreatingChange(false);
  }
}
