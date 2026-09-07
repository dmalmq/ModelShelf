import { CombinedDeliveryViewer } from "@/components/viewer/combined-delivery-viewer";

interface DeliveryPageProps {
  readonly params: Promise<{ deliveryId: string }>;
}

export default async function DeliveryPage({
  params,
}: DeliveryPageProps): Promise<React.JSX.Element> {
  const { deliveryId } = await params;
  return <CombinedDeliveryViewer deliveryId={deliveryId} />;
}
