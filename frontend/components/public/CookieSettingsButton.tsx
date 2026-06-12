"use client";

// Footer "Cookie Settings" control. Clears the `decided` flag in the persisted
// consent so the CookieBanner reappears on reload, letting users revisit their
// choice. Kept as its own client component so PublicFooter stays a server
// component.
export default function CookieSettingsButton({
  className,
  testId,
  children,
}: {
  className?: string;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={() => {
        // Clear the decided flag so banner reappears
        const consent = JSON.parse(
          localStorage.getItem("autolenis_cookie_consent") ?? "{}"
        );
        localStorage.setItem(
          "autolenis_cookie_consent",
          JSON.stringify({ ...consent, decided: false })
        );
        window.location.reload();
      }}
      className={className}
    >
      {children}
    </button>
  );
}
