import { SCENARIO_DISPLAY_DETAILS, SCENARIOS } from "@/lib/benchmark";
import { ENTERPRISE_SCENARIOS, ENTERPRISE_DISPLAY_DETAILS } from "@/lib/benchmark-enterprise";
import { MEMORY_SCENARIOS, MEMORY_DISPLAY_DETAILS } from "@/lib/benchmark-memory";
import { getPublicModelConfigGroups, type PublicModelConfig } from "@/lib/models";

import { Dashboard } from "@/components/dashboard";

function mapScenarios(scenarios: typeof SCENARIOS, details: Record<string, { successCase: string; failureCase: string }>) {
  return scenarios.map((s) => ({
    id: s.id, title: s.title, category: s.category, description: s.description, userMessage: s.userMessage,
    successCase: details[s.id]?.successCase ?? "See benchmark definition.",
    failureCase: details[s.id]?.failureCase ?? "See benchmark definition.",
  }));
}

export default function HomePage() {
  let primaryModels: PublicModelConfig[] = [];
  let secondaryModels: PublicModelConfig[] = [];
  let configError: string | null = null;

  try {
    const groups = getPublicModelConfigGroups();
    primaryModels = groups.primary;
    secondaryModels = groups.secondary;
  } catch (error) {
    configError = error instanceof Error ? error.message : "Failed to load LLM_MODELS or LLM_MODELS_2.";
  }

  return (
    <main className="page-shell">
      <Dashboard
        primaryModels={primaryModels}
        secondaryModels={secondaryModels}
        scenarios={mapScenarios(SCENARIOS, SCENARIO_DISPLAY_DETAILS)}
        enterpriseScenarios={mapScenarios(ENTERPRISE_SCENARIOS, ENTERPRISE_DISPLAY_DETAILS)}
        memoryScenarios={mapScenarios(MEMORY_SCENARIOS, MEMORY_DISPLAY_DETAILS)}
        configError={configError}
      />
    </main>
  );
}
