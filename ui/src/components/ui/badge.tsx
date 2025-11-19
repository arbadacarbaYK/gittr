import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

const badgeVariants = cva(
  "rounded px-2 py-1 text-xs font-medium inline-flex items-center justify-center text-center",
  {
    variants: {
      variant: {
        default: "bg-zinc-500/40 text-white",
        outline: "border border-gray-600 text-gray-300 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps extends VariantProps<typeof badgeVariants> {
  children: React.ReactNode;
  className?: string;
}

export const Badge = ({
  children,
  className,
  variant,
}: BadgeProps) => (
  <span
    className={cn(
      badgeVariants({ variant }),
      className
    )}
  >
    {children}
  </span>
);
