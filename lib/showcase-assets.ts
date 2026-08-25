export const SHOWCASE_NAMES = ["script", "repurpose", "ugc"] as const;

export type ShowcaseName = (typeof SHOWCASE_NAMES)[number];

export interface ShowcaseAsset {
  name: ShowcaseName;
  label: string;
  storageKey: string;
  publicPath: string;
}

const FALLBACK_KEYS: Record<ShowcaseName, string> = {
  script: "jobs/cmt6jv25i000jkvvgh9hvyc41/attempts/9a73c847-4c61-49d3-8984-10409a58c271/output.mp4",
  repurpose:
    "jobs/cmt7cquhm000g12izqxtzt1o5/attempts/3787a716-69e5-4014-99fb-092373bdcd01/clip-cmt7cqw670005bf77mteof8ax.mp4",
  ugc: "jobs/cmt7ctbxp000q12iz01r8jdz4/attempts/a329f508-8492-4d27-9944-62bb5bf7b9b4/output.mp4",
};

const LABELS: Record<ShowcaseName, string> = {
  script: "Script to video",
  repurpose: "Repurpose — auto face tracking",
  ugc: "UGC-style ad",
};

const ENV_NAMES: Record<ShowcaseName, string> = {
  script: "SHOWCASE_SCRIPT_STORAGE_KEY",
  repurpose: "SHOWCASE_REPURPOSE_STORAGE_KEY",
  ugc: "SHOWCASE_UGC_STORAGE_KEY",
};

export function isShowcaseName(value: string): value is ShowcaseName {
  return (SHOWCASE_NAMES as readonly string[]).includes(value);
}

function isSafeStorageKey(value: string): boolean {
  const segments = value.split("/");
  return value.length > 0 && !value.startsWith("/") && segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export function getShowcaseAsset(name: ShowcaseName): ShowcaseAsset {
  const configured = process.env[ENV_NAMES[name]]?.trim();
  const storageKey = configured || FALLBACK_KEYS[name];
  if (!isSafeStorageKey(storageKey)) {
    throw new Error(`${ENV_NAMES[name]} is not a safe storage key`);
  }
  return {
    name,
    label: LABELS[name],
    storageKey,
    publicPath: `/api/showcase/${name}`,
  };
}

export function getShowcaseAssets(): ShowcaseAsset[] {
  return SHOWCASE_NAMES.map(getShowcaseAsset);
}
