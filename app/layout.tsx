import type { Metadata } from "next";

import "./globals.css";
import { ErrorBoundary } from "@/components/error-boundary";

export const metadata: Metadata = {
  title: "Hermes Agent Benchmark",
  description: "Visual tool-calling benchmark for testing LLMs with Hermes agent — scoring tool-call accuracy, latency, cost, and context window.",
  openGraph: {
    title: "Hermes Agent Benchmark",
    description: "15 scenarios. Every LLM. One score. Find the best model for Hermes agent tool-calling.",
    type: "website",
  },
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚗️</text></svg>",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ErrorBoundary>{children}</ErrorBoundary>
      </body>
    </html>
  );
}
