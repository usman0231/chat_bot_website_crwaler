import { ImageResponse } from "next/og";  

// ImageResponse is a Next.js feature that lets you generate images 
// using JSX/React instead of designing them manually.

export const size = { width: 32, height: 32 };

// This sets the favicon dimensions

export const contentType = "image/png";

// The generated image should be returned as a PNG file


export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background:
            "linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%)",
          color: "white",
          fontSize: 22,
          fontWeight: 800,
          letterSpacing: -0.5,
          borderRadius: 6,
        }}
      >
        S
      </div>
    ),
    { ...size },

    // Spread Operator (...) use kar rahi hai jo object ki properties
    //  ko copy karke new object mein daal deta hai.
  );
}
