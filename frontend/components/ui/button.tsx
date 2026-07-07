import * as React from "react";
import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B5FD1] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
  {
    variants: {
      variant: {
        default: "bg-[#0B5FD1] text-white hover:bg-[#0A4DB8] shadow-sm",
        secondary: "bg-white text-[#0B5FD1] border-2 border-[#0B5FD1] hover:bg-[#0B5FD1] hover:text-white",
        outline: "border border-slate-200 bg-white text-slate-900 hover:bg-slate-50",
        ghost: "text-slate-700 hover:bg-slate-100",
        destructive: "bg-red-500 text-white hover:bg-red-600",
        link: "text-[#0B5FD1] underline-offset-4 hover:underline p-0 h-auto",
        green: "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        default: "h-10 px-5 py-2",
        lg: "h-12 px-8 text-base",
        xl: "h-14 px-10 text-lg",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  href?: string;
  asChild?: boolean; // kept for prop compatibility but resolved via href
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, href, asChild, children, ...props }, ref) => {
    const classes = cn(buttonVariants({ variant, size, className }));

    // When href is provided, render as a Next.js Link
    if (href) {
      return (
        <Link href={href} className={classes}>
          {children}
        </Link>
      );
    }

    // When asChild is used with a child Link, render children directly styled
    if (asChild && children) {
      const child = React.Children.only(children) as React.ReactElement<{ className?: string }>;
      return React.cloneElement(child, {
        className: cn(classes, child.props.className),
      });
    }

    return (
      <button className={classes} ref={ref} {...props}>
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
