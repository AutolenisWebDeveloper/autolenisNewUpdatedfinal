import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[#0B5FD1] text-white",
        secondary: "border-transparent bg-slate-100 text-slate-700",
        outline: "border-current text-slate-700",
        green: "border-transparent bg-green-100 text-green-700",
        blue: "border-transparent bg-blue-100 text-blue-700",
        gray: "border-transparent bg-slate-100 text-slate-600",
        destructive: "border-transparent bg-red-100 text-red-700",
        amber: "border-transparent bg-amber-100 text-amber-700",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
