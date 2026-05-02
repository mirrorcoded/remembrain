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
      className={`inline-flex items-center gap-1.5 rounded-full bg-[#f5f5f5] px-2 py-[3px] text-[11px] font-medium capitalize leading-none text-[#1a1a1a] ring-1 ring-black/[0.06] dark:bg-[#262626] dark:text-[#e5e5e5] dark:ring-white/10 ${className}`}
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
          ? "bg-black text-white shadow-sm ring-1 ring-black/10 dark:bg-white dark:text-black dark:ring-white/20"
          : "bg-[#f5f5f5] text-[#1a1a1a] ring-1 ring-black/[0.05] hover:bg-[#ebebeb] dark:bg-[#262626] dark:text-[#e5e5e5] dark:ring-white/10 dark:hover:bg-[#333]"
      }`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${categoryDotClass(category)}`} aria-hidden />
      <span>{label}</span>
    </button>
  );
}
