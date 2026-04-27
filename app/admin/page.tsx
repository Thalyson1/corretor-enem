import { LogoutButton } from "@/app/logout-button";
import { NavLinks } from "@/app/nav-links";
import {
  updateGlobalLimitsAction,
  updateUserAccessAction,
} from "@/app/admin/actions";
import { requireRole } from "@/lib/auth";
import { getUserRoster } from "@/lib/essays";
import { createClient } from "@/lib/supabase/server";

export default async function AdminPage() {
  const { profile } = await requireRole(["admin"]);
  const supabase = await createClient();
  const [users, { data: usageLimits }] = await Promise.all([
    getUserRoster(supabase),
    supabase
      .from("usage_limits")
      .select("role, weekly_saved_essays, weekly_corrections")
      .order("role"),
  ]);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-gradient-to-r from-slate-950 to-slate-800 px-4 py-10 text-white sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.25em] text-amber-300">
                Administração
              </div>
              <h1 className="mt-2 text-4xl font-black tracking-tight">
                Gestão de usuários e limites
              </h1>
              <p className="mt-3 max-w-3xl text-slate-300">
                Promova alunos, ative ou desative contas e ajuste os limites globais
                ou individuais de uso semanal.
              </p>
            </div>
            <div className="flex flex-col items-start gap-3 lg:items-end">
              <NavLinks role={profile.role} />
              <LogoutButton />
            </div>
          </div>
        </div>
      </header>

      <section className="px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl space-y-8">
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Limites globais por perfil</h2>
                <p className="mt-1 text-sm text-slate-500">
                  A conta de estudante agora começa com 10 redações e 10 correções por semana.
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-4 lg:grid-cols-3">
              {(usageLimits ?? []).map((limit) => (
                <form
                  key={limit.role}
                  action={updateGlobalLimitsAction}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                >
                  <input type="hidden" name="role" value={limit.role} />
                  <div className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
                    {limit.role}
                  </div>
                  <label className="mt-4 block text-sm font-medium text-slate-700">
                    Redações salvas por semana
                    <input
                      name="weekly_saved_essays"
                      type="number"
                      min="0"
                      defaultValue={limit.weekly_saved_essays}
                      className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                    />
                  </label>
                  <label className="mt-3 block text-sm font-medium text-slate-700">
                    Correções por semana
                    <input
                      name="weekly_corrections"
                      type="number"
                      min="0"
                      defaultValue={limit.weekly_corrections}
                      className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                    />
                  </label>
                  <button
                    type="submit"
                    className="mt-4 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
                  >
                    Salvar limites
                  </button>
                </form>
              ))}
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-bold text-slate-900">Usuários cadastrados</h2>
            <div className="mt-5 space-y-4">
              {users.map((user) => (
                <form
                  key={user.id}
                  action={updateUserAccessAction}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                >
                  <input type="hidden" name="profile_id" value={user.id} />
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="lg:max-w-sm">
                      <div className="text-lg font-semibold text-slate-900">
                        {user.fullName}
                      </div>
                      <div className="text-sm text-slate-500">{user.email}</div>
                      <div className="mt-2 text-sm text-slate-600">
                        Média: {user.averageScore ?? "--"} • Melhor nota: {user.bestScore ?? "--"} •
                        Redações: {user.essayCount}
                      </div>
                      <div className="mt-1 text-sm text-slate-500">
                        Escola: {user.schoolName ?? "--"} • Turma: {user.classGroup ?? "--"}
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                      <label className="text-sm font-medium text-slate-700">
                        Nome
                        <input
                          name="full_name"
                          defaultValue={user.fullName === "Usuário" ? "" : user.fullName}
                          className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                        />
                      </label>
                      <label className="text-sm font-medium text-slate-700">
                        Perfil
                        <select
                          name="role"
                          defaultValue={user.role}
                          className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                        >
                          <option value="student">student</option>
                          <option value="teacher">teacher</option>
                          <option value="admin">admin</option>
                        </select>
                      </label>
                      <label className="text-sm font-medium text-slate-700">
                        Status
                        <select
                          name="is_active"
                          defaultValue={String(user.isActive)}
                          className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                        >
                          <option value="true">Ativo</option>
                          <option value="false">Inativo</option>
                        </select>
                      </label>
                      <label className="text-sm font-medium text-slate-700">
                        Turma
                        <input
                          name="class_group"
                          defaultValue={user.classGroup ?? ""}
                          className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                        />
                      </label>
                      <label className="text-sm font-medium text-slate-700">
                        Override salvas
                        <input
                          name="weekly_saved_essays_override"
                          type="number"
                          min="0"
                          defaultValue={user.weeklySavedEssaysOverride ?? ""}
                          className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                        />
                      </label>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-medium text-slate-700">
                      Escola ou unidade
                      <input
                        name="school_name"
                        defaultValue={user.schoolName ?? ""}
                        className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                      />
                    </label>
                    <label className="text-sm font-medium text-slate-700">
                      Override correções
                      <input
                        name="weekly_corrections_override"
                        type="number"
                        min="0"
                        defaultValue={user.weeklyCorrectionsOverride ?? ""}
                        className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                      />
                    </label>
                  </div>
                  <button
                    type="submit"
                    className="mt-4 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
                  >
                    Atualizar usuário
                  </button>
                </form>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
