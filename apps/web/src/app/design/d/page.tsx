import {
  CircleDashed,
  Expand,
  Eye,
  Lock,
  Palette,
  Pencil,
  RotateCcw,
  X,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ProvenanceNotice } from "@/components/domain/provenance-notice";
import { SeverityLadder } from "@/components/domain/severity-ladder";
import { FindingEvidence } from "@/components/domain/finding-evidence";
import {
  OUTCOME_COLOR,
  REVIEW_INCOMPLETE_COLOR,
  SEVERITY_COLOR,
  VIEWER_HIGHLIGHT,
} from "@/lib/palette";
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
 * デザインD — レビューダッシュボード(Speckleの言語をModelShelfに翻訳)
 *
 * 大きな白いビューアを主役に、ウィジェットグリッドのチェックカードを並べる。
 * カードの「色付け」トグルでモデルをチェック結果で塗り分ける(Speckleの
 * "Color By Results" に相当)。ただしModelShelfの約束は守る:
 *   - 合格は塗らない(ハイライトの不在が合格)
 *   - 一度に色付けできるのは1チェックまで(ビューアの3クラス上限の既定)
 *   - 未判定は合格に折り畳まず、常にカードとして残る
 *   - 色は必ずラベル付き — 指標には件数と語を併記する
 */

const evaluatedTotal = RUN.passCount + RUN.failCount + RUN.incompleteCount;

const severityBands = SEVERITY_ORDER.map((severity) => {
  const findings = FINDINGS.filter((finding) => finding.severity === severity);
  return {
    severity,
    findingCount: findings.length,
    objectCount: findings.reduce((sum, finding) => sum + finding.objectCount, 0),
  };
});

const outcomeSummary = [
  { key: "pass", label: "合格", count: RUN.passCount },
  { key: "fail", label: "不合格", count: RUN.failCount },
  { key: "review_incomplete", label: "未判定", count: RUN.incompleteCount },
  { key: "not_applicable", label: "対象外", count: RUN.notApplicableCount },
] as const;

/** 選択中のチェック(色付けON) — 防火性能の指摘 */
const colored = FINDINGS[0];

export default function DesignD() {
  return (
    <div className="flex h-screen flex-col bg-background">
      {/* ── トップバー(Speckleのワークスペースバー相当) ─────── */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-card px-4">
        <span className="text-sm font-semibold">ModelShelf</span>
        <Separator orientation="vertical" className="h-5" />
        <span className="text-sm">{PROJECT.name}</span>
        <div className="mx-auto flex items-center gap-2 text-sm font-medium">
          レビューダッシュボード
          <Pencil className="size-3.5 text-muted-foreground" />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm">
            日本語 / EN
          </Button>
          <Button variant="outline" size="sm">
            共有
          </Button>
          <Badge
            variant="outline"
            className="gap-1.5"
            style={{ color: REVIEW_INCOMPLETE_COLOR }}
          >
            <CircleDashed className="size-3.5" aria-hidden="true" />
            未判定3 · 入力来歴 未確定
          </Badge>
          <Dialog>
            <DialogTrigger asChild>
              <Button size="sm">受入判定を記録</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[540px]">
              <DialogHeader>
                <DialogTitle>受入判定を記録</DialogTitle>
                <DialogDescription>
                  判定時点の証跡と判断理由を記録します。
                </DialogDescription>
              </DialogHeader>

              <dl className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
                <div className="grid grid-cols-[100px_1fr] gap-2">
                  <dt className="text-muted-foreground">納品</dt>
                  <dd>{DELIVERY.label} · {DELIVERY.date} · {DELIVERY.finalized ? "確定済" : "未確定"}</dd>
                </div>
                <div className="grid grid-cols-[100px_1fr] gap-2">
                  <dt className="text-muted-foreground">チェックパック</dt>
                  <dd>{PACK.name} v{PACK.version}</dd>
                </div>
                <div className="grid grid-cols-[100px_1fr] gap-2">
                  <dt className="text-muted-foreground">エンジン</dt>
                  <dd>{RUN.engineVersion}</dd>
                </div>
                <div className="grid grid-cols-[100px_1fr] gap-2">
                  <dt className="text-muted-foreground">IDSハッシュ</dt>
                  <dd className="tnum font-mono">{PACK.idsSha256.slice(0, 16)}…</dd>
                </div>
              </dl>

              <Alert>
                <CircleDashed style={{ color: REVIEW_INCOMPLETE_COLOR }} aria-hidden="true" />
                <AlertTitle>未確定の状態</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc space-y-1 pl-4">
                    <li>未判定の指摘が3オブジェクト残っています</li>
                    <li>入力モデルの来歴が未確定です(現在の納品メンバーシップから再構成)</li>
                  </ul>
                </AlertDescription>
              </Alert>

              <div className="space-y-2">
                <span className="text-sm font-medium">判定</span>
                <ToggleGroup type="single" aria-label="受入判定" className="w-full">
                  <ToggleGroupItem value="accept" className="flex-1">受入</ToggleGroupItem>
                  <ToggleGroupItem value="return" className="flex-1">差戻し</ToggleGroupItem>
                  <ToggleGroupItem value="conditional" className="flex-1">条件付き受入</ToggleGroupItem>
                </ToggleGroup>
              </div>

              <div className="space-y-2">
                <label htmlFor="acceptance-rationale" className="text-sm font-medium">
                  判定理由(記録されます)
                </label>
                <textarea
                  id="acceptance-rationale"
                  rows={3}
                  className="border-input bg-background rounded-md border px-2.5 py-2 text-sm w-full"
                />
              </div>

              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">キャンセル</Button>
                </DialogClose>
                <Button>記録する</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      {/* ── フィルタチップ(ビューアに浮かぶSpeckle式バー) ────── */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b bg-card px-4">
        <Badge variant="secondary" className="gap-1.5">
          <Palette className="size-3" />
          チェック結果で色付け: {colored.title}
          <button type="button" aria-label="色付けを解除" className="ml-0.5 rounded-sm hover:text-foreground">
            <X className="size-3" />
          </button>
        </Badge>
        <Badge variant="outline" className="gap-1.5">
          {DELIVERY.label} · {DELIVERY.date}
          <Lock className="size-3" />
        </Badge>
        <Badge variant="outline">
          {PACK.name} v{PACK.version}
        </Badge>
        <span className="tnum ml-auto text-xs text-muted-foreground">
          {RUN.engineVersion} · {formatDuration(RUN.durationMs)}
        </span>
      </div>
      <div className="shrink-0 border-b bg-background px-4 py-2">
        <ProvenanceNotice />
      </div>

      {/* ── ビューア + ウィジェットグリッド ────────────────── */}
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_560px]">
        {/* ビューア: 白、大きく、ソフトな影のモデル */}
        <section className="relative min-h-0 bg-viewer">
          <div className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-lg border bg-card/95 p-1 shadow-sm">
            <Button variant="ghost" size="icon-sm">
              <RotateCcw />
            </Button>
            <Button variant="ghost" size="icon-sm">
              <Eye />
            </Button>
            <Button variant="ghost" size="icon-sm">
              <Expand />
            </Button>
          </div>
          <div className="absolute right-3 top-3 z-10">
            <ToggleGroup type="single" defaultValue="results" size="sm" className="rounded-lg border bg-card/95 p-1 shadow-sm">
              <ToggleGroupItem value="results">結果で色付け</ToggleGroupItem>
              <ToggleGroupItem value="none">素のモデル</ToggleGroupItem>
            </ToggleGroup>
          </div>

          {/* スキーマ図 — 色付けON: 不合格オブジェクトのみ塗る(合格は塗らない) */}
          <svg viewBox="0 0 640 460" className="absolute inset-0 size-full" role="img" aria-label="チェック結果で色付けされた結合モデルのスキーマ図">
            <defs>
              <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="6" stdDeviation="10" floodColor="#0f172a" floodOpacity="0.08" />
              </filter>
            </defs>
            <g filter="url(#soft)">
              <g stroke="#cbd5e1" fill="none" strokeWidth="1">
                {[330, 260, 190].map((y, i) => (
                  <g key={y}>
                    <polygon points={`110,${y} 450,${y - 46} 570,${y} 230,${y + 46}`} fill={i === 0 ? "#f8fafc" : "#eef2f6"} />
                    <text x="586" y={y + 4} fill="#64748b" fontSize="12">{3 - i}F</text>
                  </g>
                ))}
              </g>
              {/* 建具(開口部) — 不合格のみ violation 色で塗る */}
              <g fill={VIEWER_HIGHLIGHT.violation}>
                <rect x="238" y="206" width="16" height="30" rx="1.5" />
                <rect x="318" y="190" width="16" height="30" rx="1.5" />
                <rect x="424" y="184" width="24" height="14" rx="1.5" />
                <rect x="262" y="278" width="16" height="30" rx="1.5" />
                <rect x="380" y="262" width="16" height="30" rx="1.5" />
                <rect x="300" y="344" width="16" height="30" rx="1.5" />
              </g>
            </g>
            <text x="20" y="440" fill="#64748b" fontSize="11">
              色付け中: {colored.title} — 不合格 {colored.objectCount}オブジェクトを表示(合格は塗りません)
            </text>
          </svg>

          <div className="absolute inset-x-0 bottom-0 flex h-8 items-center gap-4 border-t bg-card/95 px-3 text-xs text-muted-foreground">
            {MODELS.map((m) => (
              <span key={m.id} className="tnum">
                {m.name} rev{m.revision} · {m.objectCount.toLocaleString()}
                {m.reusedFromPrevious ? "(再利用)" : ""}
              </span>
            ))}
          </div>
        </section>

        {/* ウィジェットグリッド */}
        <aside className="min-h-0 overflow-y-auto border-l bg-background p-3">
          <div className="space-y-3">
            {/* 全体サマリ — 重大度を最初に伝える */}
            <Card size="sm">
              <CardHeader>
                <CardTitle className="text-sm">チェック全体</CardTitle>
                <CardDescription>
                  {PACK.specCount}チェック · {evaluatedTotal.toLocaleString()}件を評価(対象外{RUN.notApplicableCount.toLocaleString()}件を除く)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <SeverityLadder bands={severityBands} />
                <ul className="flex flex-wrap gap-x-4 gap-y-2 border-t pt-3 text-xs">
                  {outcomeSummary.map(({ key, label, count }) => (
                    <li key={key} className="inline-flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className="inline-block size-2 rounded-full"
                        style={{ backgroundColor: OUTCOME_COLOR[key] }}
                      />
                      {label} <span className="tnum">{count.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            {/* チェックカード — SpeckleのFire Checkカード相当 */}
            {FINDINGS.map((f) => {
              const isColored = f.id === colored.id;
              return (
                <Card key={f.id} size="sm" className={isColored ? "ring-2 ring-primary/40" : ""}>
                  <CardHeader>
                    <div className="flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className="inline-block size-2 rounded-full"
                        style={{ backgroundColor: SEVERITY_COLOR[f.severity] }}
                      />
                      <CardDescription>{SEVERITY_LABEL_JA[f.severity]} · {f.category}</CardDescription>
                    </div>
                    <CardTitle className="text-sm leading-snug">{f.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <span className="tnum">適用{f.applicableCount}</span>
                      <span aria-hidden className="text-muted-foreground">/</span>
                      <span className="tnum">合格{f.passCount}</span>
                      <span aria-hidden className="text-muted-foreground">/</span>
                      <span className="tnum" style={{ color: OUTCOME_COLOR.fail }}>
                        不合格{f.objectCount}
                      </span>
                    </div>
                    <FindingEvidence finding={f} />
                    <div className="flex items-center justify-between">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="xs"
                          >
                            <Palette data-icon="inline-start" />
                            {isColored ? "色付け中" : "色付け"}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          この指摘の対象オブジェクトをビューアでハイライトします(同時に1チェックまで)
                        </TooltipContent>
                      </Tooltip>
                      <span className="tnum text-xs text-muted-foreground">
                        {f.objectCount}オブジェクト
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {/* 未判定カード — 常に表示、破線で区別 */}
            <Card size="sm" className="border-dashed">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CircleDashed className="size-4" style={{ color: REVIEW_INCOMPLETE_COLOR }} />
                  <CardTitle className="text-sm leading-snug">{INCOMPLETE_FINDING.title}</CardTitle>
                  <span className="tnum ml-auto text-xs text-muted-foreground">
                    {INCOMPLETE_FINDING.objectCount}オブジェクト
                  </span>
                </div>
                <CardDescription>
                  エンジンが判定不能 — 合格にも不合格にもカウントしません。目視確認が必要です。
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </aside>
      </div>
    </div>
  );
}
