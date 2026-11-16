import { Link } from "@tanstack/react-router";

import { PageContainer } from "@/components/ui/page-container";
import { EmptyState } from "@/components/ui/empty-state";

export function NotFoundPage() {
  return (
    <PageContainer className="py-7">
      <EmptyState
        title="Not found"
        description="This paste is gone, expired, or was never here."
        action={
          <Link
            to="/recent"
            className="inline-flex h-8 items-center gap-2 border border-[var(--border-strong)] bg-[var(--surface)] px-4 text-sm text-[var(--foreground)] no-underline hover:bg-[var(--surface-2)]"
          >
            Recent
          </Link>
        }
      />
    </PageContainer>
  );
}
