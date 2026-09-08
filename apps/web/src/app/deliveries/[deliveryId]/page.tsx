import { Suspense } from "react";
import { DeliveryWorkspace } from "@/components/shelf/delivery-workspace";

interface DeliveryPageProps {
  readonly params: Promise<{ deliveryId: string }>;
}

export default async function DeliveryPage({ params }: DeliveryPageProps): Promise<React.JSX.Element> {
  const { deliveryId } = await params;
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-6xl p-6">
          <p className="text-sm text-muted-foreground" role="status">
            Loading delivery / デリバリーを読み込み中
          </p>
        </div>
      }
    >
      <DeliveryWorkspace deliveryId={deliveryId} />
    </Suspense>
  );
}
