import { describe, expect, it } from "vitest";

import type { ProviderModelInfo } from "@/core/types";
import {
  isExcludedModelId,
  modelProfilesById,
  modelServiceEntries,
  selectableProviderModels,
} from "./modelCapabilities";

const discoveredModels: ProviderModelInfo[] = [
  {
    id: "opaque-chat",
    capabilities: ["text"],
    model_type: "text",
    capability_source: "provider",
  },
  {
    id: "opaque-asr",
    capabilities: ["speech_to_text"],
    model_type: "speech_to_text",
    capability_source: "provider",
  },
  {
    id: "opaque-image",
    capabilities: [],
    model_type: "image_generation",
    capability_source: "provider",
  },
  {
    id: "deepseek-r1",
    capabilities: ["text"],
    model_type: "text",
    capability_source: "provider",
  },
  {
    id: "proxy/deepseek-r1",
    capabilities: ["text"],
    model_type: "text",
    capability_source: "heuristic",
  },
];

describe("model capability selection", () => {
  it("excludes only the retired deepseek-r1 model id", () => {
    expect(isExcludedModelId("deepseek-r1")).toBe(true);
    expect(isExcludedModelId("proxy/DeepSeek-R1")).toBe(true);
    expect(isExcludedModelId("deepseek-r1-0528")).toBe(false);
  });

  it("excludes provider-declared non-chat models from model service presets", () => {
    expect(selectableProviderModels(discoveredModels).map((model) => model.id)).toEqual([
      "opaque-chat",
      "opaque-asr",
    ]);

    expect(modelServiceEntries(
      "opaque-chat\nopaque-asr\nopaque-image",
      modelProfilesById(discoveredModels),
    )).toEqual([
      {
        model: "opaque-chat",
        capabilities: ["text"],
        capabilitySource: "provider",
      },
      {
        model: "opaque-asr",
        capabilities: ["speech_to_text"],
        capabilitySource: "provider",
      },
    ]);
  });

  it("keeps manually entered ids for backward-compatible gateway inference", () => {
    expect(modelServiceEntries(
      "custom-chat-model\ndeepseek-r1\nproxy/deepseek-r1",
      {},
    )).toEqual([
      {
        model: "custom-chat-model",
        capabilities: undefined,
        capabilitySource: undefined,
      },
    ]);
  });
});
