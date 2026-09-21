export {
  GENERATOR_VERSION,
  POOL_VERSION,
  RING_COUNT,
  RING_IDS,
  RULESET_VERSION,
  SAVE_SCHEMA_VERSION,
  SCHEMA_VERSION,
  SLOT_COUNT,
  SOLVER_VERSION,
  STATE_SPACE,
} from "./types.ts";

export const AUDIO_SETTING_KEY = "audioEnabled" as const;
export const GAME_TITLE = "石板回し" as const;
export const RUN_ORDER = ["easy", "easy", "normal", "normal", "hard"] as const;
