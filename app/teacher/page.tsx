import { LogoutButton } from "@/app/logout-button";
import { NavLinks } from "@/app/nav-links";
import { requireRole } from "@/lib/auth";
import { getTeacherEssayFeed, getUserRoster } from "@/lib/essays";
import { createClient } from "@/lib/supabase/server";

type TeacherPageProps = {
  searchParams?: Promise<{
    class_group?: string;
  }>;
};

function getCacheSourceLabel(cacheSource: string) {
  if (cacheSource === "duplicate_student") {
    return "Reaproveitada do próprio aluno";
  }

  if (cacheSource === "duplicate_global") {
    return "Reaproveitada do cache global";
  }

  return "Correção inédita";
}

export default async function TeacherPage({ searchParams }: TeacherPageProps) {
  const { profile } = await requireRole(["teacher", "admin"]);
  const params = await searchParams;
  const classGroup = params?.class_group?.trim() || undefined;
  const supabase = await createClient();
  const [students, feed] = await Promise.all([
    getUserRoster(supabase, { role: "student", classGroup }),
    getTeacherEssayFeed(supabase, { classGroup }),
  ]);

  const availableGroups = Array.from(
    new Set(students.map((student) => student.classGroup).filter(Boolean)),
  ) as string[];
  const activeSchools = Array.from(
    new Set(students.map((student) => student.schoolName).filter(Boolean)),
  ) as string[];

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-gradient-to-r from-indigo-950 to-slate-900 px-4 py-10 text-white sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-300">
                Painel da professora
              </div>
              <h1 className="mt-2 text-4xl font-black tracking-tight">
                Turmas, progresso e redações recentes
              </h1>
              <p className="mt-3 max-w-3xl text-slate-300">
                Veja a evolução dos alunos, filtre por turma e acompanhe quais
                redações foram corrigidas recentemente.
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
          <form className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-bold text-slate-900">Filtro de turma</h2>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="text-sm font-medium text-slate-700">
                Turma
                <select
                  name="class_group"
                  defaultValue={classGroup ?? ""}
                  className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 sm:min-w-64"
                >
                  <option value="">Todas as turmas</option>
                  {availableGroups.map((group) => (
                    <option key={group} value={group}>
                      {group}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
              >
                Aplicar filtro
              </button>
            </div>
            <p className="mt-3 text-sm text-slate-500">
              Escolas presentes no filtro atual:{" "}
              {activeSchools.length > 0 ? activeSchools.join(", ") : "nenhuma informada"}
            </p>
          </form>

          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-sm font-semibold text-slate-500">Alunos visíveis</div>
              <div className="mt-2 text-3xl font-black text-slate-900">{students.length}</div>
            </div>
            <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-sm font-semibold text-slate-500">Redações recentes</div>
              <div className="mt-2 text-3xl font-black text-slate-900">{feed.length}</div>
            </div>
            <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-sm font-semibold text-slate-500">Média geral</div>
              <div className="mt-2 text-3xl font-black text-slate-900">
                {students.length > 0
                  ? Math.round(
                      students
                        .map((student) => student.averageScore)
                        .filter((score): score is number => score !== null)
                        .reduce((sum, score) => sum + score, 0) /
                        Math.max(
                          students.filter((student) => student.averageScore !== null).length,
                          1,
                        ),
                    )
                  : "--"}
              </div>
            </div>
            <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-sm font-semibold text-slate-500">Escolas mapeadas</div>
              <div className="mt-2 text-3xl font-black text-slate-900">{activeSchools.length}</div>
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-bold text-slate-900">Resumo dos alunos</h2>
            <div className="mt-5 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="pb-3 pr-4">Aluno</th>
                    <th className="pb-3 pr-4">Escola</th>
                    <th className="pb-3 pr-4">Turma</th>
                    <th className="pb-3 pr-4">Redações</th>
                    <th className="pb-3 pr-4">Média</th>
                    <th className="pb-3 pr-4">Melhor</th>
                    <th className="pb-3 pr-4">Última</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {students.map((student) => (
                    <tr key={student.id}>
                      <td className="py-3 pr-4">
                        <div className="font-semibold text-slate-900">{student.fullName}</div>
                        <div className="text-slate-500">{student.email}</div>
                      </td>
                      <td className="py-3 pr-4">{student.schoolName ?? "--"}</td>
                      <td className="py-3 pr-4">{student.classGroup ?? "--"}</td>
                      <td className="py-3 pr-4">{student.essayCount}</td>
                      <td className="py-3 pr-4">{student.averageScore ?? "--"}</td>
                      <td className="py-3 pr-4">{student.bestScore ?? "--"}</td>
                      <td className="py-3 pr-4">{student.latestScore ?? "--"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-bold text-slate-900">Redações recentes</h2>
            <div className="mt-5 space-y-4">
              {feed.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                  Nenhuma redação encontrada para o filtro atual.
                </div>
              ) : null}

              {feed.map((essay) => (
                <article
                  key={essay.id}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="text-lg font-semibold text-slate-900">
                        {essay.student.fullName}
                      </div>
                      <div className="text-sm text-slate-500">
                        {essay.student.schoolName ?? "Escola não informada"} •{" "}
                        {essay.student.classGroup ?? "Sem turma"} • {essay.student.email}
                      </div>
                      <div className="mt-2 font-medium text-slate-800">{essay.theme}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full bg-indigo-100 px-3 py-1 text-sm font-semibold text-indigo-800">
                        {essay.finalScore ?? "--"} pts
                      </span>
                      <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-700">
                        {essay.aiModel ?? "Modelo não informado"}
                      </span>
                      <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                        {getCacheSourceLabel(essay.cacheSource)}
                      </span>
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{essay.summary}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
