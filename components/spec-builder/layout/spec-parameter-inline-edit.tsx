interface Props {
  label: string;
  children?: React.ReactNode;
}
function SpecParameterInlineEdit({ label, children }: Props) {
  return (
    <div className="flex flex-col md:flex-row md:items-center md:gap-4 group py-1">
      <label
        htmlFor={label}
        className="w-36 text-xs shrink-0 font-mono tracking-tighter text-fg-muted px-2 md:px-0"
      >
        {label}
      </label>
      {children}
    </div>
  );
}
export default SpecParameterInlineEdit;
