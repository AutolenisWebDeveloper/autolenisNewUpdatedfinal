"use client";

import { useEffect } from "react";

// Root global error boundary. Unlike segment error.tsx boundaries, this replaces
// the root layout, so it must render its own <html>/<body>. It only fires when an
// error is thrown in the root layout/template itself (which the segment and root
// error boundaries cannot catch). Styles are inlined since the app layout — and
// therefore its stylesheet — is not guaranteed to have mounted.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global] root layout error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          color: "#0f172a",
          background: "#f8fafc",
          textAlign: "center",
          padding: "2rem",
        }}
      >
        <div data-testid="global-error-boundary">
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.5rem" }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#64748b", maxWidth: 360, marginBottom: "0.25rem" }}>
            We hit an unexpected error. Please try again.
          </p>
          {error.digest && (
            <p style={{ fontSize: "0.75rem", color: "#94a3b8", marginBottom: "1.5rem" }}>
              Error reference: {error.digest}
            </p>
          )}
          <button
            data-testid="global-error-retry-btn"
            onClick={reset}
            style={{
              marginTop: "1rem",
              padding: "0.5rem 1rem",
              borderRadius: "0.5rem",
              border: "none",
              background: "#0f172a",
              color: "#fff",
              fontSize: "0.875rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
