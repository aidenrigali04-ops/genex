import { redirect } from "next/navigation";

import { DashboardClient } from "@/app/dashboard/dashboard-client";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=%2Fdashboard");
  }

  return (
    <DashboardClient
      initialUser={{
        id: user.id,
        email: user.email ?? "(no email on account)",
      }}
      initialClipPackages={[]}
    />
  );
}
