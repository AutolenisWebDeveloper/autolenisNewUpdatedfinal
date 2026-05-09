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
    </>
  );
}
