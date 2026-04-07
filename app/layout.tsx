import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Hermes Agent Benchmark",
  description: "Visual tool-calling benchmark for testing LLMs with Hermes agent — scoring tool-call accuracy, latency, cost, and context window."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
