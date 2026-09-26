import { siteConfig } from "../../site.config.ts";

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
/** The display title is provisional until the publication name is approved. */
export const GAME_TITLE = siteConfig.title;
export const GAME_DESCRIPTION = siteConfig.description;
export const PUBLIC_GAME_URL = siteConfig.publicUrl;
export const LAB_URL = siteConfig.labUrl;
/** A publication image is intentionally unset until its source is approved. */
export const SHARE_IMAGE_URL: string | null = siteConfig.shareImageUrl;
export const RUN_ORDER = ["easy", "easy", "normal", "normal", "hard"] as const;
