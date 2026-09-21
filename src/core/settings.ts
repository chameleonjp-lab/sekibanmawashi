export type UserSettings = {
  audioEnabled: boolean;
};

export const DEFAULT_SETTINGS: Readonly<UserSettings> = Object.freeze({ audioEnabled: true });

export function createDefaultSettings(): UserSettings {
  return { audioEnabled: DEFAULT_SETTINGS.audioEnabled };
}

export function setAudioEnabled(settings: UserSettings, enabled: boolean): UserSettings {
  return { ...settings, audioEnabled: enabled };
}
