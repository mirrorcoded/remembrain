import { categoryDotClass } from "@/lib/categories";

export function CategoryBadge({
  category,
  label,
  className = "",
}: {
  category: string;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full bg-[#1f1f1f] px-2 py-[3px] text-[11px] font-medium capitalize leading-none text-[#a3a3a3] ring-1 ring-white/10 ${className}`}
      data-entry-longpress-ignore
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${categoryDotClass(category)}`} aria-hidden />
      <span>{label}</span>
    </span>
  );
}

export function CategoryFilterChip({
  category,
  label,
  selected,
  onClick,
}: {
  category: string;
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rb-btn-press inline-flex items-center gap-1.5 rounded-full px-2.5 py-[5px] text-[11px] font-medium capitalize transition-[transform,background-color,color,box-shadow] duration-150 ${
        selected
          ? "bg-white text-black shadow-sm ring-1 ring-white/20"
          : "border border-[#1f1f1f] bg-[#0a0a0a] text-white ring-0 hover:bg-[#111111]"
      }`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${categoryDotClass(category)}`} aria-hidden />
      <span>{label}</span>
    </button>
  );
}
