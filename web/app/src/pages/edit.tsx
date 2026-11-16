import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";

import { api } from "@/api";
import { ComposerScreen } from "./composer";

export function EditPage() {
  const { slug } = useParams({ from: "/$slug/edit" });
  const { data } = useQuery({ queryKey: ["paste", slug], queryFn: () => api.get(slug) });

  if (!data) {
    return (
      <div className="mx-auto w-full max-w-[var(--shell)] px-4 py-7 md:px-8">
        <div className="h-[538px] border border-[var(--border)] bg-[var(--surface-2)]" />
      </div>
    );
  }

  return <ComposerScreen mode="edit" slug={slug} initial={data} />;
}
