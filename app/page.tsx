import type { Metadata } from "next";
import { Landing } from "@/components/landing";

export const metadata: Metadata = {
  title: "Hermes Agent Benchmark",
  description: "Visual benchmark for testing LLM tool-calling capabilities with Hermes Agent Engine compatibility scoring and hardware detection.",
};

export default function HomePage() {
  return <Landing />;
}
