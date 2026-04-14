import { DashboardClient } from "@/app/dashboard/dashboard-client";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <DashboardClient
      initialUser={
        user
          ? { id: user.id, email: user.email ?? "(no email on account)" }
          : null
      }
    />
  );
}
