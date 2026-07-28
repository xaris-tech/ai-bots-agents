import type { Metadata } from "next";
import "./globals.css";
import { AuthGate } from "./AuthGate";

export const metadata: Metadata = {
  title: "Cortex Bid Desk",
  description: "Construction opportunity operations console",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
