// Client-side helper used by BuyerJourneyTab and Journey Map
// to open a buyer page in admin preview mode.

export async function openBuyerPageAsAdmin(params: {
  buyerId: string;
  stageRoute: string;
}): Promise<void> {
  const { buyerId, stageRoute } = params;

  const res = await fetch(`/api/admin/buyers/${buyerId}/preview-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stageRoute }),
  });

  const data = await res.json() as {
    success: boolean;
    data?: { token: string };
    error?: { message: string };
  };

  if (!data.success || !data.data?.token) {
    alert(data.error?.message ?? "Failed to generate preview token");
    return;
  }

  document.cookie = [
    `admin_preview_token=${data.data.token}`,
    "path=/buyer",
    "max-age=300",
    "SameSite=Strict",
  ].join("; ");

  window.open(stageRoute, "_blank", "noopener,noreferrer");
}
