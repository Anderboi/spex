import { COVER_PALETTE, STATUS_CONFIG, TYPE_COLORS } from '@/lib/constants';
import { Project } from '@/lib/types';
import { fmtDate, fmtRub, plural } from '@/lib/utils';
import Link from 'next/link';

export function ProjectCard({ project, index }: { project: Project; index: number }) {
  const coverBg = COVER_PALETTE[index % COVER_PALETTE.length];
  const st = STATUS_CONFIG[project.status];

  return (
    <Link
      href={`/projects/${project.id}`}
      className="group block bg-bg-card border border-border-muted rounded-[14px] overflow-hidden transition-shadow duration-200 hover:shadow-[0_8px_32px_rgba(27,26,23,.08)]"
    >
      {/* Cover */}
      <div className={`relative h-40 ${coverBg} flex items-end p-5 overflow-hidden`}>
        {/* Decorative geometric pattern */}
        <svg
          className="absolute -top-6 -right-6 size-48 text-bg-white opacity-[.14] pointer-events-none"
          viewBox="0 0 200 200"
          fill="none"
        >
          <circle cx="100" cy="100" r="96" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="100" cy="100" r="68" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="100" cy="100" r="40" stroke="currentColor" strokeWidth="1.5" />
          <line x1="100" y1="0" x2="100" y2="200" stroke="currentColor" strokeWidth="1" />
          <line x1="0" y1="100" x2="200" y2="100" stroke="currentColor" strokeWidth="1" />
        </svg>

        {/* Type badge */}
        <span
          className={`relative z-1 inline-flex items-center rounded-[10px] py-1.5 px-3.5 font-mono text-[11px] font-semibold tracking-[.04em] uppercase ${TYPE_COLORS[project.type]}`}
        >
          {project.type}
        </span>
      </div>

      {/* Body */}
      <div className="p-5 pt-4">
        <h3 className="text-[19px] font-bold text-fg tracking-[-.01em] leading-[1.15] mb-3">
          {project.name}
        </h3>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div>
            <div className="font-mono text-[17px] font-semibold text-fg leading-none">
              {project.items}
            </div>
            <div className="text-[11.5px] text-fg-muted mt-1 leading-tight">
              {plural(project.items, 'позиция', 'позиции', 'позиций')}
            </div>
          </div>
          <div>
            <div className="font-mono text-[17px] font-semibold text-fg leading-none">
              {project.rooms}
            </div>
            <div className="text-[11.5px] text-fg-muted mt-1 leading-tight">
              {plural(project.rooms, 'комната', 'комнаты', 'комнат')}
            </div>
          </div>
          <div>
            <div className="font-mono text-[17px] font-semibold text-fg leading-none truncate">
              {fmtRub(project.budget)}
            </div>
            <div className="text-[11.5px] text-fg-muted mt-1 leading-tight">Бюджет</div>
          </div>
        </div>

        {/* Footer: status + date + actions */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`size-2 rounded-full flex-none ${st.dot}`} />
            <span className="text-[13px] text-fg-secondary font-medium">{st.label}</span>
          </div>
          <span className="font-mono text-[11.5px] text-fg-muted tracking-[.02em]">
            {fmtDate(project.updatedAt)}
          </span>
        </div>

        {/* Hover actions */}
        <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border-subtle opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <button
            onClick={(e) => { e.preventDefault(); }}
            className="flex-1 flex items-center justify-center gap-1.5 bg-bg-toggle text-fg border-none rounded-[10px] py-2.5 px-3 font-sans text-[13px] font-semibold cursor-pointer hover:bg-bg-select transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 10.5V12h1.5l7.37-7.37-1.5-1.5L2 10.5zM12.71 4.04a.5.5 0 000-.71l-.79-.79a.5.5 0 00-.71 0l-.73.73 1.5 1.5.73-.73z" fill="currentColor"/></svg>
            Ред.
          </button>
          <button
            onClick={(e) => { e.preventDefault(); }}
            className="flex items-center justify-center w-9 h-9 rounded-[10px] border-none bg-bg-toggle text-fg-secondary cursor-pointer hover:bg-bg-red-light hover:text-fg-red transition-colors"
            aria-label="Удалить"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4.5 1.5h5M1.5 3.5h11M5.5 5.5v6M8.5 5.5v6M3.5 3.5l.5 9h6l.5-9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>
      </div>
    </Link>
  );
}