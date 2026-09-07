import Link from "next/link";
import { ArrowRight, Monitor, Presentation, GitCompareArrows, LayoutDashboard } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * デザイン案の索引。3案は同一データセット(実際のBLCJ S1000評価結果)を
 * 異なる局面向けに提示する。事実は共通、表現だけが違う。
 */

const designs = [
  {
    href: "/design/a",
    icon: Monitor,
    name: "デザインA — デスクコンソール",
    audience: "机での集中レビュー",
    summary:
      "3ペインの高密度ワークステーション。指摘ツリー・3Dビューア・オブジェクトインスペクタを一画面に置き、指摘からプロパティまで画面遷移なしで辿れる。密度を武器にする案。",
  },
  {
    href: "/design/b",
    icon: Presentation,
    name: "デザインB — レビュー会スコアカード",
    audience: "コンサルタント同席のレビュー会・投影",
    summary:
      "ツールを知らない人がスクリーン越しに読めることを最優先。大きなタイポグラフィ、単一カラム、判定の根拠(パック版・エンジン版・IDSハッシュ)を常備する。未判定は合格に折り畳まない。",
  },
  {
    href: "/design/c",
    icon: GitCompareArrows,
    name: "デザインC — 納品棚と差分",
    audience: "納品の経時管理・前回との比較",
    summary:
      "プロジェクトを時間軸で見る案。納品タイムライン、実行履歴の積み上げカラム、2納品間のオブジェクト差分を一つの流れで示す。不確実な照合は自動承認せず明示する。",
  },
  {
    href: "/design/d",
    icon: LayoutDashboard,
    name: "デザインD — レビューダッシュボード",
    audience: "Speckleの言語をModelShelfに翻訳",
    summary:
      "大きな白いビューアを主役に、チェックカードのウィジェットグリッドを並べる。カードの「色付け」トグルでモデルをチェック結果で塗り分ける(SpeckleのColor By Results相当)。合格は塗らず、同時に1チェックまで、未判定は常に残る。",
  },
] as const;

export default function DesignIndex() {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="text-2xl font-semibold">ModelShelf — デザイン案</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          3案とも同一のデータ(実際のBLCJ S1000デモパック評価結果)を表示します。
          データ色(重大度・合否・変更種別)はすべて palette.ts 由来で共通、
          差があるのはレイアウトと密度だけです。
        </p>
        <div className="mt-8 space-y-4">
          {designs.map((d) => (
            <Link key={d.href} href={d.href} className="block">
              <Card className="transition-colors hover:border-primary/40">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <d.icon className="size-5 text-muted-foreground" />
                    <CardTitle className="text-base">{d.name}</CardTitle>
                    <ArrowRight className="ml-auto size-4 text-muted-foreground" />
                  </div>
                  <CardDescription>{d.audience}</CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {d.summary}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
