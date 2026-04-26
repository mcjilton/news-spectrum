import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "News Spectrum",
  description:
    "AI-assisted news comparison for agreed facts and political framing differences.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
