export const CLAUDIAN_STORAGE_PATH = '.claudian';

export const LEGACY_CLAUDIAN_SETTINGS_PATH = '.claude/claudian-settings.json';
export const CLAUDIAN_SETTINGS_PATH = `${CLAUDIAN_STORAGE_PATH}/claudian-settings.json`;

export const LEGACY_SESSIONS_PATH = '.claude/sessions';
export const SESSIONS_PATH = `${CLAUDIAN_STORAGE_PATH}/sessions`;
export const SESSIONS_INDEX_PATH = `${CLAUDIAN_STORAGE_PATH}/sessions-index.json`;
export const MISSIONS_PATH = `${CLAUDIAN_STORAGE_PATH}/missions`;
/** Deleted chats wait here, restorable, until the retention runs out. */
export const TRASH_PATH = `${CLAUDIAN_STORAGE_PATH}/trash`;
export const TRASH_INDEX_PATH = `${TRASH_PATH}/trash-index.json`;
/** Byte-exact copies of session files that failed to parse, taken before any save could replace them. */
export const CORRUPT_SESSIONS_PATH = `${CLAUDIAN_STORAGE_PATH}/recovery`;
