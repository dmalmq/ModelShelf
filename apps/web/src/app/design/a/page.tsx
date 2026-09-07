import {
  ChevronRight,
  CircleDashed,
  Download,
  Eye,
  Lock,
  Maximize2,
  RotateCcw,
} from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { OutcomeBar } from "@/components/domain/outcome-bar";
import { ProvenanceNotice } from "@/components/domain/provenance-notice";
import { SEVERITY_COLOR, REVIEW_INCOMPLETE_COLOR, VIEWER_HIGHLIGHT } from "@/lib/palette";
import {
  DELIVERY,
  FINDINGS,
  INCOMPLETE_FINDING,
  MODELS,
  PACK,
  PROJECT,
  RUN,
  SEVERITY_LABEL_JA,
} from "@/lib/mock";
import { SEVERITY_ORDER } from "@/lib/types";
import { formatDuration } from "@/lib/format";

/**
 * デザインA — デスクコンソール
 * 机での長時間レビュー向け。3ペインの高密度ワークステーション:
 * 指摘ツリー(左)/ 3Dビューア(中央)/ インスペクタ(右)。
 * 1画面で「指摘 → オブジェクト → プロパティ」まで辿れることを優先する。
 */

const bands = SEVERITY_ORDER.map((severity) => ({
  severity,
  findings: FINDINGS.filter((f) => f.severity === severity),
})).filter((b) => b.findings.length > 0);

const selected = FINDINGS[0]; // 防火性能の指摘を選択中とする

export default function DesignA() {
  return (
    <div className="flex h-screen flex-col bg-background">
      {/* ── ヘッダ ─────────────────────────────────────────── */}
      <header className="flex h-12 shrink-0 items-center gap-4 border-b bg-card px-4">
        <span className="text-sm font-semibold">ModelShelf</span>
        <Separator orientation="vertical" className="h-5" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/design/a">{PROJECT.name}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="/design/a">{DELIVERY.label}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>チェック実行</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm">
            日本語 / EN
          </Button>
          <Button variant="outline" size="sm">
            <Download data-icon="inline-start" />
            エクスポート
          </Button>
          <Button size="sm">受入判定を記録</Button>
        </div>
      </header>

      {/* ── 実行メタ情報 ────────────────────────────────────── */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-b bg-card px-4 py-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 text-foreground">
          <Lock className="size-3" />
          {DELIVERY.label} · {DELIVERY.date} · 確定済
        </span>
        <span>
          {PACK.name} <span className="tnum">v{PACK.version}</span>({PACK.specCount}チェック)
        </span>
        <span>{RUN.engineVersion}</span>
        <span className="tnum">{formatDuration(RUN.durationMs)}</span>
        <div className="ml-auto w-72">
          <OutcomeBar
            counts={{
              pass: RUN.passCount,
              fail: RUN.failCount,
              notApplicable: RUN.notApplicableCount,
              incomplete: RUN.incompleteCount,
            }}
          />
        </div>
      </div>

      {/* ── 3ペイン ───────────────────────────────────────── */}
      <div className="grid min-h-0 flex-1 grid-cols-[320px_1fr_380px]">
        {/* 左: 指摘ツリー */}
        <aside className="flex min-h-0 flex-col border-r bg-card">
          <div className="flex h-9 shrink-0 items-center justify-between border-b px-3">
            <span className="text-xs font-medium">指摘(要件ごとにグループ化)</span>
            <span className="tnum text-xs text-muted-foreground">
              {FINDINGS.length + 1}件
            </span>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="p-2">
              {bands.map((band) => (
                <Collapsible key={band.severity} defaultOpen>
                  <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium hover:bg-muted">
                    <ChevronRight className="size-3.5 transition-transform [[data-state=open]>&]:rotate-90" />
                    <span
                      aria-hidden
                      className="inline-block size-2 rounded-full"
                      style={{ backgroundColor: SEVERITY_COLOR[band.severity] }}
                    />
                    {SEVERITY_LABEL_JA[band.severity]}
                    <span className="tnum ml-auto text-muted-foreground">
                      {band.findings.length}
                    </span>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    {band.findings.map((f) => (
                      <button
                        key={f.id}
                        className={`mt-0.5 block w-full rounded-md border-l-2 px-3 py-2 text-left text-xs hover:bg-muted ${
                          f.id === selected.id ? "bg-accent" : ""
                        }`}
                        style={{
                          borderLeftColor: SEVERITY_COLOR[f.severity],
                        }}
                      >
                        <span className="block font-medium leading-snug">{f.title}</span>
                        <span className="mt-0.5 flex items-center gap-2 text-muted-foreground">
                          <span>{f.category}</span>
                          <span className="tnum ml-auto">{f.objectCount}オブジェクト</span>
                        </span>
                      </button>
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              ))}

              {/* 未判定は常に表示 — 合格に折り畳まない */}
              <div
                className="mt-2 rounded-md border-l-2 px-3 py-2 text-xs"
                style={{ borderLeftColor: REVIEW_INCOMPLETE_COLOR }}
              >
                <span className="flex items-center gap-1.5 font-medium">
                  <CircleDashed className="size-3.5" style={{ color: REVIEW_INCOMPLETE_COLOR }} />
                  未判定
                </span>
                <span className="mt-1 block leading-snug">{INCOMPLETE_FINDING.title}</span>
                <span className="tnum mt-0.5 block text-muted-foreground">
                  {INCOMPLETE_FINDING.objectCount}オブジェクト — エンジンが判定不能
                </span>
              </div>
            </div>
          </ScrollArea>
        </aside>

        {/* 中央: ビューア */}
        <section className="flex min-h-0 flex-col bg-viewer">
          <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
            <ToggleGroup type="multiple" defaultValue={["arch", "struct", "mep"]} size="sm">
              <ToggleGroupItem value="arch">建築</ToggleGroupItem>
              <ToggleGroupItem value="struct">構造</ToggleGroupItem>
              <ToggleGroupItem value="mep">設備</ToggleGroupItem>
            </ToggleGroup>
            <Select defaultValue="all">
              <SelectTrigger size="sm" className="w-28">
                <SelectValue placeholder="階" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全階</SelectItem>
                <SelectItem value="1f">1F</SelectItem>
                <SelectItem value="2f">2F</SelectItem>
                <SelectItem value="3f">3F</SelectItem>
              </SelectContent>
            </Select>
            <div className="ml-auto flex items-center gap-1">
              <Button variant="ghost" size="icon-sm">
                <RotateCcw />
              </Button>
              <Button variant="ghost" size="icon-sm">
                <Eye />
              </Button>
              <Button variant="ghost" size="icon-sm">
                <Maximize2 />
              </Button>
            </div>
          </div>

          {/* スキーマ図 — 実装時は web-ifc キャンバスに置き換わる */}
          <div className="relative min-h-0 flex-1">
            <svg viewBox="0 0 640 420" className="absolute inset-0 size-full" role="img" aria-label="結合モデルのスキーマ図">
              <g stroke="#cbd5e1" fill="none" strokeWidth="1">
                {[300, 240, 180].map((y, i) => (
                  <g key={y}>
                    <polygon points={`120,${y} 460,${y - 40} 560,${y} 220,${y + 40}`} fill={i === 0 ? "#f1f5f9" : "#e8edf3"} />
                    <text x="580" y={y + 4} fill="#64748b" fontSize="12">{3 - i}F</text>
                  </g>
                ))}
              </g>
              {/* 選択中指摘のハイライト — ビューアは一度に1クラスが既定 */}
              <g fill={VIEWER_HIGHLIGHT.violation}>
                <rect x="250" y="196" width="14" height="26" rx="1" />
                <rect x="320" y="182" width="14" height="26" rx="1" />
                <rect x="410" y="176" width="20" height="12" rx="1" />
                <rect x="270" y="256" width="14" height="26" rx="1" />
              </g>
              <text x="24" y="396" fill="#64748b" fontSize="11">
                ハイライト: 建具に防火性能が設定されていない(78オブジェクト)
              </text>
            </svg>
          </div>

          <div className="flex h-8 shrink-0 items-center gap-4 border-t px-3 text-xs text-muted-foreground">
            {MODELS.map((m) => (
              <span key={m.id} className="tnum">
                {m.name} rev{m.revision} · {m.objectCount.toLocaleString()}
                {m.reusedFromPrevious ? "(前回から再利用)" : ""}
              </span>
            ))}
          </div>
        </section>

        {/* 右: インスペクタ */}
        <aside className="flex min-h-0 flex-col border-l bg-card">
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-4 p-3">
              <div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="gap-1.5">
                    <span aria-hidden className="inline-block size-2 rounded-full" style={{ backgroundColor: SEVERITY_COLOR[selected.severity] }} />
                    {SEVERITY_LABEL_JA[selected.severity]}
                  </Badge>
                  <Badge variant="secondary">{selected.category}</Badge>
                </div>
                <h2 className="mt-2 text-sm font-semibold leading-snug">{selected.title}</h2>
                <dl className="mt-2 space-y-1 text-xs">
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-muted-foreground">要件</dt>
                    <dd className="font-mono">{selected.requirement}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-muted-foreground">期待値</dt>
                    <dd>{selected.expected}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-muted-foreground">結果</dt>
                    <dd className="tnum">
                      適用{selected.applicableCount} / 合格{selected.passCount} / 不合格{selected.objectCount}
                    </dd>
                  </div>
                </dl>
              </div>

              <Separator />

              <div>
                <h3 className="mb-1.5 text-xs font-medium">影響オブジェクト</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-7 text-xs">名称</TableHead>
                      <TableHead className="h-7 text-xs">階</TableHead>
                      <TableHead className="h-7 text-xs">実測値</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selected.objects.map((o) => (
                      <TableRow key={o.expressId}>
                        <TableCell className="py-1.5 text-xs">
                          <span className="block">{o.name}</span>
                          <span className="tnum text-muted-foreground">#{o.expressId} · {o.ifcType}</span>
                        </TableCell>
                        <TableCell className="py-1.5 text-xs">{o.storey}</TableCell>
                        <TableCell className="py-1.5 text-xs text-muted-foreground">{o.actual}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="tnum mt-1.5 text-xs text-muted-foreground">
                  他{selected.objectCount - selected.objects.length}オブジェクト — 全件表示
                </p>
              </div>

              <ProvenanceNotice />
            </div>
          </ScrollArea>
        </aside>
      </div>
    </div>
  );
}
