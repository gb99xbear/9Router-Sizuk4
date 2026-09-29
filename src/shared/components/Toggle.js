"use client";

import { cn } from "@/shared/utils/cn";

export default function Toggle({
  checked = false,
  onChange,
  label,
  description,
  disabled = false,
  size = "md",
  className,
}) {
  const sizes = {
    sm: { track: "w-9 h-5", thumb: "size-3.5", translate: "translate-x-4" },
    md: { track: "w-11 h-6", thumb: "size-4.5", translate: "translate-x-5" },
    lg: { track: "w-14 h-7", thumb: "size-5.5", translate: "translate-x-7" },
  };

  const handleClick = () => {
    if (!disabled && onChange) onChange(!checked);
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3",
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={handleClick}
        className={cn(
          "relative inline-flex shrink-0 cursor-pointer rounded-full p-[2px]",
          "transition-all duration-200 ease-out active:scale-95",
          "border-2 border-black dark:border-white shadow-sm",
          "focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-white",
          checked
            ? "bg-emerald-500 dark:bg-emerald-400"
            : "bg-neutral-300 dark:bg-neutral-800 hover:bg-neutral-400 dark:hover:bg-neutral-700",
          sizes[size].track,
          disabled && "cursor-not-allowed active:scale-100"
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block rounded-full bg-white shadow-md",
            "border border-black/20 dark:border-black/40",
            "transform transition-transform duration-200 ease-out",
            checked ? sizes[size].translate : "translate-x-0",
            sizes[size].thumb
          )}
        />
      </button>
      {(label || description) && (
        <div className="flex flex-col">
          {label && (
            <span className="text-sm font-semibold text-text-main">{label}</span>
          )}
          {description && (
            <span className="text-xs text-text-muted">{description}</span>
          )}
        </div>
      )}
    </div>
  );
}
