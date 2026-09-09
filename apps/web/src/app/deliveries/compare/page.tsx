// Delivery comparison route: /deliveries/compare?base=<id>&head=<id>.
// Client component reading the pair from useSearchParams with a Suspense
// fallback (precedent: delivery-workspace.tsx:84-89, deliveries/[deliveryId]).
"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CompareScreen } from "@/components/compare/compare-screen";

export default function ComparePage(): React.JSX.Element {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-6xl p-6">
          <p className="text-sm text-muted-foreground" role="status">
            比較を読み込み中 / Loading comparison
          </p>
        </div>
      }
    >
      <CompareInner />
    </Suspense>
  );
}

function CompareInner(): React.JSX.Element {
  const searchParams = useSearchParams();
  const base = searchParams.get("base");
  const head = searchParams.get("head");
  if (!base || !head) {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6">
        <div className="max-w-lg border border-border bg-card p-6">
          <h1 className="text-xl font-semibold">比較対象が未指定 / Missing comparison pair</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            基準と比較先のデリバリーを指定してください: /deliveries/compare?base=&lt;id&gt;&head=&lt;id&gt; / Pass both
            deliveries: /deliveries/compare?base=&lt;id&gt;&head=&lt;id&gt;
          </p>
        </div>
      </main>
    );
  }
  return <CompareScreen baseDeliveryId={base} headDeliveryId={head} />;
}
