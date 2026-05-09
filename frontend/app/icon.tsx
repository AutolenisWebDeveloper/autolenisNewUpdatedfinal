// Feature 30 — PWA Icon (192×192)
// Next.js image route handler convention: served at /icon
// Used by browsers and manifest.json for the PWA app icon.
import { ImageResponse } from "next/og";

export const size = { width: 192, height: 192 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: size.width,
          height: size.height,
          background: "#0B5FD1",
          borderRadius: 32,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          fontSize: 96,
          fontWeight: 700,
          fontFamily: "sans-serif",
        }}
      >
        A
      </div>
    ),
    size
  );
}
