import { notFound } from 'next/navigation';
import { isAdmin } from '@/lib/admin';

// The admin page itself is a client component, so it cannot gate on auth() — it would
// ship the check to the browser. This server layout runs first and 404s non-admins, so
// the admin UI is never sent to someone who cannot use it. The routes under
// /api/admin/* check isAdmin() independently; this is the shell, not the boundary.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { admin } = await isAdmin();
  if (!admin) notFound();
  return <>{children}</>;
}
