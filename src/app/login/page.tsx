import { redirect } from "next/navigation";
import { getServerAuth } from "@/lib/supabase/server";
import { LoginForm } from "@/components/auth/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const auth = await getServerAuth();
  if (auth.user) redirect("/plan");
  const { error } = await searchParams;
  return <LoginForm initialError={error ?? (auth.rejectedEmail ? "domain" : auth.mode === "UNCONFIGURED" ? "unconfigured" : undefined)} />;
}
