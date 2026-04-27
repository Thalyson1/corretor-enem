import { GraderClient } from "@/app/grader-client";
import { NavLinks } from "@/app/nav-links";
import { LogoutButton } from "@/app/logout-button";
import { requireAuth } from "@/lib/auth";
import { getEssayHistory, getMonthlyRanking, getUsageSnapshot } from "@/lib/essays";
import { getDisplayName } from "@/lib/profile-display";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const { profile, session } = await requireAuth();
  const supabase = await createClient();
  const [history, usage, ranking] = await Promise.all([
    getEssayHistory(supabase, profile),
    getUsageSnapshot(supabase, profile),
    getMonthlyRanking(supabase, profile),
  ]);
  const displayName = getDisplayName(profile?.full_name, session.user.email);
  const shouldShowEmailLine =
    !!session.user.email &&
    displayName.toLowerCase() !== session.user.email.toLowerCase();

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-gradient-to-r from-slate-900 to-indigo-900 px-4 py-12 text-white shadow-md sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-4">
              <div className="inline-flex rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-indigo-100">
                Área autenticada
              </div>
              <div>
                <h1 className="text-4xl font-extrabold tracking-tight md:text-5xl">
                  Corretor IA <span className="text-indigo-300">Padrão ENEM</span>
                </h1>
                <p className="mt-4 max-w-3xl text-lg text-indigo-100">
                  Agora a correção não é salva automaticamente: você corrige primeiro
                  e decide depois o que entra no seu histórico.
                </p>
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-white/10 p-5 backdrop-blur">
              <div className="mb-3">
                <NavLinks role={profile.role} />
              </div>
              <div className="text-sm text-indigo-100">Conectado como</div>
              <div className="mt-1 text-lg font-semibold text-white">
                {displayName}
              </div>
              {shouldShowEmailLine ? (
                <div className="mt-1 text-sm text-indigo-100">
                  {session.user.email}
                </div>
              ) : null}
              <div className="mt-3 inline-flex rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-100">
                Perfil: {profile?.role ?? "student"}
              </div>
              <div className="mt-4">
                <LogoutButton />
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="-mt-6 px-4 pb-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <GraderClient
            initialHistory={history}
            initialUsage={usage}
            currentRole={profile.role}
            ranking={ranking}
          />
        </div>
      </section>
    </main>
  );
}
