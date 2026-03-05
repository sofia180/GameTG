export default function Button({
  children,
  onClick,
  variant = "primary",
  type = "button",
  disabled = false,
  className
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
}) {
  const base =
    "rounded-xl px-4 py-2 text-sm font-semibold transition relative overflow-hidden isolate inline-flex items-center justify-center gap-2";
  const styles: Record<string, string> = {
    primary:
      "bg-gradient-to-r from-neonPurple via-neon to-neonCyan text-ink shadow-neon hover:shadow-cyan hover:scale-[1.01]",
    ghost:
      "border border-white/20 text-white hover:border-white/40 hover:bg-white/5",
    danger: "bg-ember text-ink hover:opacity-90"
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${styles[variant]} ${className ?? ""} ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
    >
      <span className="absolute inset-0 -z-10 bg-gradient-to-r from-neonPurple/30 via-neon/30 to-neonCyan/30 blur-xl" />
      <span className={variant === "primary" ? "pulse-soft" : ""}>{children}</span>
    </button>
  );
}
