// style-system: Tailwind
export default function ControleLigacoesHomePage() {
  return (
    <div className="min-h-screen bg-[var(--bg)] p-4 sm:p-6 text-[var(--text)]">
      <div className="mx-auto max-w-[820px]">
        <div className="mb-[22px] border-b border-[var(--border)] pb-[18px]">
          <div className="text-[11px] font-semibold uppercase tracking-[.14em] text-[var(--violet)]">Controle de Ligações</div>
          <h1 className="font-display mt-0.5 text-[26px] sm:text-[34px] font-extrabold leading-tight sm:leading-none">Início</h1>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-4 py-6 sm:px-5">
          <p className="text-sm text-[var(--muted)]">Módulo em construção.</p>
        </div>
      </div>
    </div>
  );
}
