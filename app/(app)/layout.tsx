import { requireUser } from "@/lib/auth/session";
import { Shell } from "@/lib/components/shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return <Shell user={user}>{children}</Shell>;
}
