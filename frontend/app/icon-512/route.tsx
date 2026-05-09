// Feature 30 — PWA Icon (512×512)
// Route handler that serves the large PWA icon via ImageResponse.
// Referenced by /icon-512 in manifest.json.
import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

export const dynamic = "force-static";

const SIZE = { width: 512, height: 512 };

export function GET(_request: NextRequest) {
  return new ImageResponse(
    (
      <div
        style={{
          width: SIZE.width,
          height: SIZE.height,
          background: "#0B5FD1",
          borderRadius: 80,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          fontSize: 256,
          fontWeight: 700,
          fontFamily: "sans-serif",
        }}
      >
        A
      </div>
    ),
    SIZE
  );
}
