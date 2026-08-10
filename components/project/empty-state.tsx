import { CreateProjectDialog } from "./create-project-dialog";

function EmptyState({ onNew }: { onNew?: () => void }) {
  return (
    <div className="text-center py-28 px-5">
      <div className="inline-flex items-center justify-center size-24 rounded-full bg-bg-select mb-6">
        <svg
          width="40"
          height="40"
          viewBox="0 0 40 40"
          fill="none"
          className="text-fg-muted"
        >
          <rect
            x="4"
            y="6"
            width="32"
            height="28"
            rx="3"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <line
            x1="14"
            y1="16"
            x2="26"
            y2="16"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <line
            x1="14"
            y1="21"
            x2="22"
            y2="21"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <line
            x1="14"
            y1="26"
            x2="24"
            y2="26"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div className="text-[22px] font-semibold text-fg">Нет проектов</div>
      <div className="text-[15px] text-fg-muted mt-2 mb-6">
        Создайте ваш первый дизайн-проект и начните работу над спецификациями.
      </div>
      <div className="ml-auto">
        <CreateProjectDialog />
      </div>
    </div>
  );
}

export default EmptyState;
