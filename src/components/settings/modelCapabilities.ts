import type {
  ModelCapability,
  ModelCapabilitySource,
  ProviderModelInfo,
} from "@/core/types";

export type ModelServiceEntry = {
  model: string;
  capabilities?: ModelCapability[];
  capabilitySource?: ModelCapabilitySource;
};

export type ModelProbeSummary = {
  total: number;
  selectable: number;
  providerClassified: number;
};

export function isExcludedModelId(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  return (normalized.split("/").at(-1) ?? normalized) === "deepseek-r1";
}

export function modelProfilesById(
  models: ProviderModelInfo[],
): Record<string, ProviderModelInfo> {
  return Object.fromEntries(models.map((model) => [model.id, model]));
}

export function selectableProviderModels(
  models: ProviderModelInfo[],
): ProviderModelInfo[] {
  return models.filter(
    (model) => !isExcludedModelId(model.id)
      && (model.capabilities === undefined || model.capabilities.length > 0),
  );
}

export function modelServiceEntries(
  value: string,
  profiles: Record<string, ProviderModelInfo>,
): ModelServiceEntry[] {
  const ids = Array.from(new Set(
    value.split(/[，,\n]/).map((item) => item.trim()).filter(Boolean),
  ));
  return ids.flatMap((model) => {
    if (isExcludedModelId(model)) return [];
    const profile = profiles[model];
    if (profile?.capabilities && profile.capabilities.length === 0) return [];
    return [{
      model,
      capabilities: profile?.capabilities,
      capabilitySource: profile?.capability_source,
    }];
  });
}
