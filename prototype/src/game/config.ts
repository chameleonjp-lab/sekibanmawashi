/** Single place for the display title. Do not hardcode this string in screens. */
export const GAME_TITLE = "石板回し";

export const GAME_SLUG = "sekibanmawashi";
export const GAME_REPOSITORY = "chameleonjp-lab/sekibanmawashi";
export const RULESET_VERSION = "stone-rings-v1";
export const GENERATOR_VERSION = "generator-v1";
export const ACTIVE_POOL_VERSION = "pool-v1";
export const SCHEMA_VERSION = 1;

export const SLOT_COUNT = 12;
export const RING_COUNT = 3;
export const RING_IDS = ["inner", "middle", "outer"] as const;
export const RING_LABELS = ["内環", "中環", "外環"] as const;

export const DIFFICULTY_LABEL = {
  easy: "初級",
  normal: "中級",
  hard: "上級",
} as const;

export const RUN_ORDER = ["easy", "easy", "normal", "normal", "hard"] as const;

export const PLAYER_TAG_MIN = 1;
export const PLAYER_TAG_MAX = 16;

export const ROTATE_ANIM_MS = 120;
export const COUNTDOWN_SECONDS = 3;
export const STAGE_CLEAR_MS = 1000;
export const MAX_MOVES_PER_STAGE = 300;
export const MAX_MOVES_TOTAL = 1500;
export const MAX_RUN_MS = 15 * 60 * 1000;

export const LAB_URL =
  "https://chameleonjp-lab.github.io/chameleonjp_lab/ranking.html?game=sekibanmawashi";
