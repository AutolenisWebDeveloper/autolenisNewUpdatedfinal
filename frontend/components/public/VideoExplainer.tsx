// Phase 1 — Video Explainer section.
// Renders an embedded video ONLY if NEXT_PUBLIC_EXPLAINER_VIDEO_URL is configured.
// If the env var is not set or empty, the section is not rendered at all.

const VIDEO_URL = process.env.NEXT_PUBLIC_EXPLAINER_VIDEO_URL ?? "";

export default function VideoExplainer() {
  if (!VIDEO_URL) return null;

  // Build a safe embed URL. Supports YouTube (youtu.be / youtube.com) and
  // Vimeo; other URLs are treated as direct <video> src.
  function buildEmbedUrl(raw: string): { type: "iframe" | "video"; url: string } {
    try {
      const u = new URL(raw);
      const host = u.hostname.toLowerCase();
      // YouTube — only accept exact known YouTube hostnames
      if (host === "youtube.com" || host === "www.youtube.com" || host === "youtu.be") {
        let videoId = u.searchParams.get("v") ?? "";
        if (!videoId && host === "youtu.be") {
          videoId = u.pathname.slice(1).split("/")[0];
        }
        if (videoId && /^[a-zA-Z0-9_-]{5,20}$/.test(videoId)) {
          return {
            type: "iframe",
            url: `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1`,
          };
        }
      }
      // Vimeo — only accept exact known Vimeo hostname
      if (host === "vimeo.com" || host === "www.vimeo.com") {
        // Extract the first all-digit path segment
        const vimeoId = u.pathname.split("/").find((seg) => /^\d+$/.test(seg)) ?? "";
        if (vimeoId) {
          return { type: "iframe", url: `https://player.vimeo.com/video/${vimeoId}` };
        }
      }
      // Default: direct video file
      return { type: "video", url: raw };
    } catch {
      return { type: "video", url: raw };
    }
  }

  const embed = buildEmbedUrl(VIDEO_URL);

  return (
    <section
      className="py-24 bg-white"
      data-testid="video-explainer-section"
      id="explainer"
    >
      <div className="mx-auto max-w-7xl px-6 md:px-12">
        <div className="text-center mb-10">
          <span className="text-xs font-bold uppercase tracking-[0.15em] text-[#0B5FD1]">See It In Action</span>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#111827] mt-3">
            Watch how AutoLenis works
          </h2>
          <p className="text-sm text-[#4B5563] mt-3 max-w-lg mx-auto">
            A quick walkthrough of the car buying experience — from pre-qualification to picking up your vehicle.
          </p>
        </div>

        <div className="max-w-4xl mx-auto">
          <div className="relative rounded-2xl overflow-hidden shadow-2xl shadow-[#0B5FD1]/15 bg-[#111827] aspect-video">
            {embed.type === "iframe" ? (
              <iframe
                src={embed.url}
                title="AutoLenis — How It Works"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 w-full h-full border-0"
                data-testid="video-explainer-iframe"
              />
            ) : (
              <video
                src={embed.url}
                controls
                className="absolute inset-0 w-full h-full object-cover"
                data-testid="video-explainer-video"
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
