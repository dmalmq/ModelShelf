import { CircleDashed, Lock, Printer } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OutcomeBar } from "@/components/domain/outcome-bar";
import { ProvenanceNotice } from "@/components/domain/provenance-notice";
import { SeverityLadder } from "@/components/domain/severity-ladder";
import { OUTCOME_COLOR, SEVERITY_COLOR } from "@/lib/palette";
import {
  DELIVERY,
  FINDINGS,
  INCOMPLETE_FINDING,
  MODELS,
  OUTCOME_LABEL_JA,
  PACK,
  PROJECT,
  RUN,
  SEVERITY_LABEL_JA,
  SPEC_ROWS,
} from "@/lib/mock";
import { SEVERITY_ORDER } from "@/lib/types";
import { formatDateTime, formatDuration } from "@/lib/format";

/**
 * デザインB — レビュー会スコアカード
 * コンサルタント同席のレビュー会・投影向け。ツールを知らない人が
 * スクリーンを見て読めることを最優先: 大きなタイポグラフィ、単一カラム、
 * 判定の根拠(パック版・エンジン版・日時)を常に画面下部に保持する。
 */

const bands = SEVERITY_ORDER.map((severity) => ({
  severity,
  findingCount: FINDINGS.filter((f) => f.severity === severity).length,
  objectCount: FINDINGS.filter((f) => f.severity === severity).reduce((n, f) => n + f.objectCount, 0),
}));

const topFindings = [...FINDINGS].sort(
  (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
);

export default function DesignB() {
  return (
    <div className="min-h-screen bg-background">
      {/* ── ヘッダ: 何を・どれに対して・いつ ────────────────── */}
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-5">
          <div>
            <p className="text-sm text-muted-foreground">{PROJECT.client}</p>
            <h1 className="text-2xl font-semibold">
              {PROJECT.name} — {DELIVERY.label} チェック結果
            </h1>
            <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <Lock className="size-3.5" />
              {DELIVERY.date} 確定 · {PACK.name} v{PACK.version}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm">
              日本語 / EN
            </Button>
            <Button variant="outline" size="sm">
              <Printer data-icon="inline-start" />
              議事録用に印刷
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-6 py-8">
        {/* ── 判定サマリ: スコアではなく構造 ────────────────── */}
        <section aria-label="結果の構造">
          <div className="grid gap-4 sm:grid-cols-4">
            <Card>
              <CardHeader>
                <CardDescription>合格</CardDescription>
                <CardTitle className="tnum text-3xl">{RUN.passCount.toLocaleString()}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>不合格</CardDescription>
                <CardTitle className="tnum text-3xl" style={{ color: OUTCOME_COLOR.fail }}>
                  {RUN.failCount}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>未判定(要確認)</CardDescription>
                <CardTitle className="tnum text-3xl" style={{ color: OUTCOME_COLOR.review_incomplete }}>
                  {RUN.incompleteCount}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>対象外</CardDescription>
                <CardTitle className="tnum text-3xl text-muted-foreground">
                  {RUN.notApplicableCount}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            未判定は合格ではありません。エンジンが評価できなかったチェックは、全項目が合格でもこの画面に残ります。
          </p>
          <div className="mt-3">
            <OutcomeBar
              counts={{
                pass: RUN.passCount,
                fail: RUN.failCount,
                notApplicable: RUN.notApplicableCount,
                incomplete: RUN.incompleteCount,
              }}
            />
          </div>
        </section>

        <ProvenanceNotice />

        {/* ── 重大度ラダー ─────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">重大度別の指摘</CardTitle>
            <CardDescription>
              棒の長さは指摘の件数。件数が多くても重大度の高い指摘が常に先に来ます。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SeverityLadder bands={bands} />
          </CardContent>
        </Card>

        {/* ── 主要指摘カード ───────────────────────────────── */}
        <section aria-label="主要な指摘">
          <h2 className="mb-3 text-lg font-semibold">指摘の内訳</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {topFindings.map((f) => (
              <Card key={f.id} size="sm">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="gap-1.5">
                      <span
                        aria-hidden
                        className="inline-block size-2 rounded-full"
                        style={{ backgroundColor: SEVERITY_COLOR[f.severity] }}
                      />
                      {SEVERITY_LABEL_JA[f.severity]}
                    </Badge>
                    <Badge variant="secondary">{f.category}</Badge>
                    <span className="tnum ml-auto text-sm text-muted-foreground">
                      {f.objectCount}オブジェクト
                    </span>
                  </div>
                  <CardTitle className="text-base leading-snug">{f.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <Accordion type="single" collapsible>
                    <AccordionItem value="detail">
                      <AccordionTrigger className="py-1.5 text-sm">
                        要件の根拠
                      </AccordionTrigger>
                      <AccordionContent className="text-sm">
                        <dl className="space-y-1">
                          <div className="flex gap-2">
                            <dt className="w-14 shrink-0 text-muted-foreground">要件</dt>
                            <dd className="font-mono text-xs leading-relaxed">{f.requirement}</dd>
                          </div>
                          <div className="flex gap-2">
                            <dt className="w-14 shrink-0 text-muted-foreground">期待値</dt>
                            <dd>{f.expected}</dd>
                          </div>
                          <div className="flex gap-2">
                            <dt className="w-14 shrink-0 text-muted-foreground">結果</dt>
                            <dd className="tnum">
                              適用{f.applicableCount} / 合格{f.passCount} / 不合格{f.objectCount}
                            </dd>
                          </div>
                        </dl>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </CardContent>
              </Card>
            ))}

            {/* 未判定カード — 常に表示 */}
            <Card size="sm" className="border-dashed">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CircleDashed className="size-4" style={{ color: OUTCOME_COLOR.review_incomplete }} />
                  <CardTitle className="text-base leading-snug">
                    {INCOMPLETE_FINDING.title}
                  </CardTitle>
                  <span className="tnum ml-auto text-sm text-muted-foreground">
                    {INCOMPLETE_FINDING.objectCount}オブジェクト
                  </span>
                </div>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                データ型を解決できず、エンジンが合否を判定できませんでした。目視確認が必要です。
              </CardContent>
            </Card>
          </div>
        </section>

        {/* ── 全チェック一覧 ───────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">全{PACK.specCount}チェックの結果</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>チェック</TableHead>
                  <TableHead>結果</TableHead>
                  <TableHead className="tnum text-right">適用</TableHead>
                  <TableHead className="tnum text-right">合格</TableHead>
                  <TableHead className="tnum text-right">不合格</TableHead>
                  <TableHead className="tnum text-right">未判定</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {SPEC_ROWS.map((row) => (
                  <TableRow key={row.name}>
                    <TableCell>{row.name}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className="inline-block size-2 rounded-full"
                          style={{ backgroundColor: OUTCOME_COLOR[row.outcome] }}
                        />
                        {OUTCOME_LABEL_JA[row.outcome]}
                      </span>
                    </TableCell>
                    <TableCell className="tnum text-right">{row.applicable.toLocaleString()}</TableCell>
                    <TableCell className="tnum text-right">{row.pass.toLocaleString()}</TableCell>
                    <TableCell className="tnum text-right">{row.fail || "—"}</TableCell>
                    <TableCell className="tnum text-right">{row.incomplete || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* ── 証跡フッタ: 異議申し立てに答えるための情報 ────── */}
        <footer className="rounded-lg border bg-card p-4 text-sm">
          <h2 className="font-medium">この結果の根拠</h2>
          <Separator className="my-3" />
          <dl className="grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-muted-foreground">チェックパック</dt>
              <dd>
                {PACK.name} v{PACK.version}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-muted-foreground">IDSハッシュ</dt>
              <dd className="tnum font-mono text-xs leading-relaxed">{PACK.idsSha256.slice(0, 16)}…</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-muted-foreground">エンジン</dt>
              <dd>{RUN.engineVersion}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-muted-foreground">実行日時</dt>
              <dd className="tnum">
                {formatDateTime(RUN.startedAt)}({formatDuration(RUN.durationMs)})
              </dd>
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <dt className="w-28 shrink-0 text-muted-foreground">入力モデル</dt>
              <dd className="tnum">
                {MODELS.map((m) => `${m.name} rev${m.revision}(${m.authoringTool})`).join(" · ")}
              </dd>
            </div>
          </dl>
        </footer>
      </main>
    </div>
  );
}
