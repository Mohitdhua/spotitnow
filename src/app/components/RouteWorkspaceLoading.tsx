interface RouteWorkspaceLoadingProps {
  eyebrow: string;
  title: string;
  description: string;
  fullHeight?: boolean;
}

export function RouteWorkspaceLoading({
  eyebrow,
  title,
  description,
  fullHeight = false
}: RouteWorkspaceLoadingProps) {
  return (
    <div className={fullHeight ? 'flex min-h-[50vh] items-center justify-center' : ''}>
      <div className="w-full rounded-[28px] border-4 border-black bg-white p-6 text-center shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] sm:p-8">
        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#2563EB]">{eyebrow}</div>
        <h2 className="mt-3 text-2xl font-black uppercase tracking-tight text-slate-900">{title}</h2>
        <p className="mt-3 text-sm font-semibold text-slate-600">{description}</p>
      </div>
    </div>
  );
}
