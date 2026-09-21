import { cn } from "@/lib/utils";

const PageTitle = ({
  children,
  className,
}: {
  children?: string;
  className?: string;
}) => {
  return (
    <h1
      className={cn(
        className,
        "text-[clamp(32px,6vw,45px)] leading-none tracking-tight text-balans font-serif m-0 mt-3 text-fg",
      )}
    >
      {children}
    </h1>
  );
};

export default PageTitle;
