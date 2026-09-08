import { ReviewScreen } from "@/components/review/review-screen";

interface DeliveryPageProps {
  readonly params: Promise<{ deliveryId: string }>;
}

export default async function DeliveryPage({
  params,
}: DeliveryPageProps): Promise<React.JSX.Element> {
  const { deliveryId } = await params;
  return <ReviewScreen deliveryId={deliveryId} />;
}
