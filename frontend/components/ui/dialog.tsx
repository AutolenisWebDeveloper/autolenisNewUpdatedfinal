"use client";

// components/ui/dialog.tsx — the kit's modal primitive (PRIMITIVES tier).
//
// REFERENCE IMPLEMENTATION for the ~46 hand-built `fixed inset-0` modals
// (owner ruling, Dealer batch). Built on @radix-ui/react-dialog, which
// supplies the full pinned accessibility contract:
//   • focus trap while open, and focus RETURN to the trigger on close
//   • Escape closes
//   • role="dialog" + aria-modal, with aria-labelledby / aria-describedby
//     wired automatically via <DialogTitle> / <DialogDescription>
//   • body scroll-lock while open
//   • overlay (outside) click dismissal
// Do NOT hand-roll modals; compose these parts. A visible <DialogTitle> is
// REQUIRED (screen readers announce it); use <DialogClose> for the ✕ button.
//
// `variant="sheet"` renders as a side drawer (same contract, different
// geometry) — the replacement for hand-built mobile nav/detail drawers.

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

type Variant = "center" | "sheet";

interface DialogContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  variant?: Variant;
  /** Side for the sheet variant. */
  side?: "left" | "right";
  showClose?: boolean;
  "data-testid"?: string;
}

export const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, variant = "center", side = "left", showClose = true, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay
      className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0"
    />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed z-50 bg-white shadow-[var(--shadow-al-3)] focus:outline-none",
        variant === "center" &&
          "left-1/2 top-1/2 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-al-lg)] p-6",
        variant === "sheet" && "inset-y-0 h-full w-72 max-w-[85vw] overflow-y-auto",
        variant === "sheet" && (side === "left" ? "left-0" : "right-0"),
        className,
      )}
      {...props}
    >
      {children}
      {showClose && (
        <DialogPrimitive.Close
          aria-label="Close"
          className="absolute right-4 top-4 rounded-[var(--radius-al-sm)] p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus"
        >
          <X size={16} />
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = "DialogContent";
