import { ArrowRight, Lock, PackagePlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CHANGE_COLOR, OUTCOME_COLOR } from "@/lib/palette";
import {
  CHANGE_LABEL_JA,
  DELIVERIES,
  DIFF,
  MODELS,
  OBJECT_CHANGES,
  PROJECT,
} from "@/lib/mock";
import type { ChangeKind } from "@/lib/types";
import { formatDate } from "@/lib/format";

/**
 * デザインC — 納品棚と差分
 * プロジェクト全体を時間軸で見る画面。納品の棚(タイムライン)、
 * 実行履歴の積み上げカラム、2納品間の差分(変更種別ごとの色分け)を
 * 一つの流れで示す。「前回から何が変わったか」が主役。
 */

const diffEntries = (Object.entries(DIFF.counts) as [ChangeKind, number][]).filter(
  ([, n]) => n > 0,
);
const diffTotal = diffEntries.reduce((n, [, c]) => n + c, 0);

export default function DesignC() {
  return (
    <div className="min-h-screen bg-background">
      {/* ── ヘッダ ─────────────────────────────────────────── */}
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-4">
          <span className="text-sm font-semibold">ModelShelf</span>
          <Separator orientation="vertical" className="h-5" />
          <div>
            <h1 className="text-lg font-semibold leading-tight">{PROJECT.name}</h1>
            <p className="text-xs text-muted-foreground">納品棚 — 全{DELIVERIES.length}回の納品</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm">
              日本語 / EN
            </Button>
            <Button size="sm">
              <PackagePlus data-icon="inline-start" />
              新しい納品を登録
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-6 py-6">
        {/* ── ソースモデル ─────────────────────────────────── */}
        <section aria-label="ソースモデル" className="flex flex-wrap gap-3">
          {MODELS.map((m) => (
            <Card key={m.id} size="sm" className="w-64">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-sm">{m.name}</CardTitle>
                  <Badge variant="secondary">{m.discipline}</Badge>
                </div>
                <CardDescription>
                  {m.authoringTool} · 最新 rev{m.revision} ·{" "}
                  <span className="tnum">{m.objectCount.toLocaleString()}</span>オブジェクト
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </section>

        {/* ── 納品タイムライン ─────────────────────────────── */}
        <section aria-label="納品タイムライン">
          <h2 className="mb-3 text-sm font-medium">納品の履歴</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {DELIVERIES.map((d, i) => {
              const total = d.passCount + d.failCount + d.incompleteCount;
              return (
                <Card key={d.label} size="sm">
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-sm">{d.label}</CardTitle>
                      {d.finalized && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Lock className="size-3" />
                          確定
                        </span>
                      )}
                      <span className="tnum ml-auto text-xs text-muted-foreground">
                        {formatDate(d.date)}
                      </span>
                    </div>
                    <CardDescription>
                      パック v{d.packVersion}
                      {d.reusedModels.length > 0 && ` · ${d.reusedModels.join("・")}は前回リビジョンを再利用`}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {/* 実行ごとの積み上げカラム — 合格/不合格/未判定 */}
                    <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-sm">
                      <div style={{ width: `${(d.passCount / total) * 100}%`, backgroundColor: OUTCOME_COLOR.pass }} />
                      <div style={{ width: `${(d.failCount / total) * 100}%`, backgroundColor: OUTCOME_COLOR.fail }} />
                      {d.incompleteCount > 0 && (
                        <div style={{ width: `${(d.incompleteCount / total) * 100}%`, backgroundColor: OUTCOME_COLOR.review_incomplete }} />
                      )}
                    </div>
                    <p className="tnum mt-2 text-xs text-muted-foreground">
                      合格{d.passCount.toLocaleString()} · 不合格{d.failCount} · 未判定{d.incompleteCount} · 指摘{d.findingCount}件
                    </p>
                    {i < DELIVERIES.length - 1 && (
                      <p className="mt-1 hidden items-center gap-1 text-xs text-muted-foreground md:flex">
                        <ArrowRight className="size-3" />
                        次の納品と比較可能
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        {/* ── 差分ビュー ───────────────────────────────────── */}
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-3">
              <CardTitle className="text-base">納品間の差分</CardTitle>
              <div className="ml-auto flex items-center gap-2">
                <Select defaultValue="d2">
                  <SelectTrigger size="sm" className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="d1">第1回納品</SelectItem>
                    <SelectItem value="d2">第2回納品</SelectItem>
                  </SelectContent>
                </Select>
                <ArrowRight className="size-4 text-muted-foreground" />
                <Select defaultValue="d3">
                  <SelectTrigger size="sm" className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="d2">第2回納品</SelectItem>
                    <SelectItem value="d3">第3回納品</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <CardDescription>
              フィンガープリントによる照合。不確実な照合は自動承認せず、明示して表示します。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* 変更種別サマリバー */}
            <div>
              <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-sm">
                {diffEntries.map(([kind, count]) => (
                  <div
                    key={kind}
                    style={{
                      width: `${(count / diffTotal) * 100}%`,
                      backgroundColor: CHANGE_COLOR[kind],
                    }}
                  />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {diffEntries.map(([kind, count]) => (
                  <span key={kind} className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="inline-block size-2 rounded-full"
                      style={{ backgroundColor: CHANGE_COLOR[kind] }}
                    />
                    {CHANGE_LABEL_JA[kind]} <span className="tnum">{count.toLocaleString()}</span>
                  </span>
                ))}
              </div>
            </div>

            <Tabs defaultValue="objects">
              <TabsList>
                <TabsTrigger value="objects">オブジェクト変更</TabsTrigger>
                <TabsTrigger value="findings">指摘の増減</TabsTrigger>
              </TabsList>
              <TabsContent value="objects">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>変更種別</TableHead>
                      <TableHead>名称</TableHead>
                      <TableHead>モデル</TableHead>
                      <TableHead>階</TableHead>
                      <TableHead>内容</TableHead>
                      <TableHead>照合</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {OBJECT_CHANGES.map((c, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <span className="inline-flex items-center gap-1.5 text-xs">
                            <span
                              aria-hidden
                              className="inline-block size-2 rounded-full"
                              style={{ backgroundColor: CHANGE_COLOR[c.kind] }}
                            />
                            {CHANGE_LABEL_JA[c.kind]}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs">
                          <span className="block">{c.name}</span>
                          <span className="text-muted-foreground">{c.ifcType}</span>
                        </TableCell>
                        <TableCell className="text-xs">{c.model}</TableCell>
                        <TableCell className="text-xs">{c.storey}</TableCell>
                        <TableCell className="text-xs">{c.detail}</TableCell>
                        <TableCell>
                          {c.confidence === "uncertain" ? (
                            <Badge variant="outline" className="text-xs">
                              不確実 — 要確認
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">確認済</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="tnum mt-2 text-xs text-muted-foreground">
                  不確実な照合 {DIFF.uncertainMatches}件 — いずれも自動承認されていません
                </p>
              </TabsContent>
              <TabsContent value="findings">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>指摘</TableHead>
                      <TableHead>変化</TableHead>
                      <TableHead className="text-right">第2回</TableHead>
                      <TableHead className="text-right">第3回</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="text-xs">部屋に参照コードがない</TableCell>
                      <TableCell className="text-xs">継続(一部解消)</TableCell>
                      <TableCell className="tnum text-right text-xs">38</TableCell>
                      <TableCell className="tnum text-right text-xs">30</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="text-xs">フローセグメントに外径が記録されていない</TableCell>
                      <TableCell className="text-xs">継続 — パックv2でケーブルラック43件が適用外に</TableCell>
                      <TableCell className="tnum text-right text-xs">150</TableCell>
                      <TableCell className="tnum text-right text-xs">107</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="text-xs">建具に防火性能が設定されていない</TableCell>
                      <TableCell className="text-xs">継続(変化なし)</TableCell>
                      <TableCell className="tnum text-right text-xs">78</TableCell>
                      <TableCell className="tnum text-right text-xs">78</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
