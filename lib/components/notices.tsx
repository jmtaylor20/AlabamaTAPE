import { Alert } from "@/lib/ui";

/** Shows the outcome of the last server action, passed back through the query string. */
export function Notices({ notice, error }: { notice?: string; error?: string }) {
  if (!notice && !error) return null;
  return (
    <div className="mb-4 flex flex-col gap-2">
      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function readNotices(searchParams: SearchParams) {
  const p = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return { notice: one(p.notice), error: one(p.error) };
}
