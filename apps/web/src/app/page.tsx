import { Suspense } from "react";
import { ProjectShelf } from "@/components/shelf/project-shelf";

export default function Home(): React.JSX.Element {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-5xl p-6">
          <p className="text-sm text-muted-foreground" role="status">
            Loading projects / プロジェクトを読み込み中
          </p>
        </main>
      }
    >
      <ProjectShelf />
    </Suspense>
  );
}
