import { Onboarding } from "@/components/onboarding/Onboarding";

/**
 * First run after sign-in: paste the schedule, pick a home. `/plan` sends anyone without a
 * schedule here. `?replace=1`, from Settings, pastes a new schedule over the current one.
 */
export default async function SetupPage({ searchParams }: { searchParams: Promise<{ replace?: string }> }) {
  const { replace } = await searchParams;
  return <Onboarding replace={replace === "1"} />;
}
