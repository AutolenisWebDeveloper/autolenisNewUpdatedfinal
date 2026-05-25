import Script from "next/script";
import PublicNav from "@/components/public/PublicNav";
import PublicFooter from "@/components/public/PublicFooter";
import AnnouncementBanner from "@/components/public/AnnouncementBanner";
import ChatWidget from "@/components/public/ChatWidget";

const ANNOUNCEMENT_MESSAGE = process.env.NEXT_PUBLIC_ANNOUNCEMENT_MESSAGE ?? "";
const ANNOUNCEMENT_LINK_TEXT = process.env.NEXT_PUBLIC_ANNOUNCEMENT_LINK_TEXT ?? "";
const ANNOUNCEMENT_LINK_HREF = process.env.NEXT_PUBLIC_ANNOUNCEMENT_LINK_HREF ?? "";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {ANNOUNCEMENT_MESSAGE && (
        <AnnouncementBanner
          message={ANNOUNCEMENT_MESSAGE}
          linkText={ANNOUNCEMENT_LINK_TEXT || undefined}
          linkHref={ANNOUNCEMENT_LINK_HREF || undefined}
        />
      )}
      <PublicNav />
      <main>{children}</main>
      <PublicFooter />
      <ChatWidget
        chatEndpoint="/api/public/ai/chat"
        placeholder="Ask me anything about AutoLenis…"
        initialGreeting="Hi! I'm Zura, the AutoLenis concierge. Have questions about how our car-buying process works?"
      />
      <div
        data-chat-widget
        data-widget-id="6a13a127ee7b17216c5e0ed0"
        data-location-id="xvcir6KTLAYlLKV12IdX"
      />
      <Script
        src="https://beta.leadconnectorhq.com/loader.js"
        data-resources-url="https://beta.leadconnectorhq.com/chat-widget/loader.js"
        data-widget-id="6a13a127ee7b17216c5e0ed0"
        strategy="afterInteractive"
      />
    </>
  );
}
