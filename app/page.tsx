import { SCENARIO_DISPLAY_DETAILS, SCENARIOS } from "@/lib/benchmark";
import { ENTERPRISE_SCENARIOS, ENTERPRISE_DISPLAY_DETAILS } from "@/lib/benchmark-enterprise";
import { getPublicModelConfigGroups, type PublicModelConfig } from "@/lib/models";

import { Dashboard } from "@/components/dashboard";

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

  const basicScenarios = SCENARIOS.map((scenario) => ({
    id: scenario.id,
    title: scenario.title,
    category: scenario.category,
    description: scenario.description,
    userMessage: scenario.userMessage,
    successCase: SCENARIO_DISPLAY_DETAILS[scenario.id]?.successCase ?? "See benchmark definition.",
    failureCase: SCENARIO_DISPLAY_DETAILS[scenario.id]?.failureCase ?? "See benchmark definition."
  }));

  const enterpriseScenarios = ENTERPRISE_SCENARIOS.map((scenario) => ({
    id: scenario.id,
    title: scenario.title,
    category: scenario.category,
    description: scenario.description,
    userMessage: scenario.userMessage,
    successCase: ENTERPRISE_DISPLAY_DETAILS[scenario.id]?.successCase ?? "See benchmark definition.",
    failureCase: ENTERPRISE_DISPLAY_DETAILS[scenario.id]?.failureCase ?? "See benchmark definition."
  }));

  return (
    <main className="page-shell">
      <Dashboard
        primaryModels={primaryModels}
        secondaryModels={secondaryModels}
        scenarios={basicScenarios}
        enterpriseScenarios={enterpriseScenarios}
        configError={configError}
      />
    </main>
  );
}
