export function ProjectsSkeleton() {
  return (
    <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-56 animate-pulse rounded-xl bg-bg-card" />
      ))}
    </div>
  );
}
