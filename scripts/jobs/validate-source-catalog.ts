import { sourceCatalog } from "../../lib/source-catalog.ts";

const enabledSources = sourceCatalog.filter((source) => source.enabled);
const errors: string[] = [];

function duplicates(values: string[]) {
  const seen = new Set<string>();
  const duplicateValues = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      duplicateValues.add(value);
    }

    seen.add(value);
  }

  return [...duplicateValues];
}

for (const source of sourceCatalog) {
  if (!source.accessProfile) {
    errors.push(`${source.name} is missing accessProfile.`);
  }

  if (source.enabled && source.accessProfile === "hard_paywall") {
    errors.push(`${source.name} is enabled but marked hard_paywall.`);
  }

  if (source.ratingSource !== "starter-catalog" && !source.ratingUrl) {
    errors.push(`${source.name} has ratingSource ${source.ratingSource} without ratingUrl.`);
  }
}

for (const name of duplicates(sourceCatalog.map((source) => source.name))) {
  errors.push(`Duplicate source name: ${name}`);
}

for (const domain of duplicates(sourceCatalog.map((source) => source.gdeltDomain))) {
  errors.push(`Duplicate GDELT domain: ${domain}`);
}

if (enabledSources.length < 60) {
  errors.push(`Expected at least 60 enabled sources, found ${enabledSources.length}.`);
}

if (errors.length > 0) {
  throw new Error(errors.join("\n"));
}

const byAccessProfile = Object.groupBy(enabledSources, (source) => source.accessProfile);
const bySourceType = Object.groupBy(enabledSources, (source) => source.sourceType);
const bySpectrum = Object.groupBy(enabledSources, (source) => source.spectrum);
const withRatingUrls = enabledSources.filter((source) => source.ratingUrl).length;

console.log("Source catalog validated.");
console.log(`- enabled sources: ${enabledSources.length}`);
console.log(`- with third-party rating URLs: ${withRatingUrls}`);
console.log(
  `- by access: ${JSON.stringify(
    Object.fromEntries(Object.entries(byAccessProfile).map(([key, values]) => [key, values?.length ?? 0])),
  )}`,
);
console.log(
  `- by type: ${JSON.stringify(
    Object.fromEntries(Object.entries(bySourceType).map(([key, values]) => [key, values?.length ?? 0])),
  )}`,
);
console.log(
  `- by spectrum: ${JSON.stringify(
    Object.fromEntries(Object.entries(bySpectrum).map(([key, values]) => [key, values?.length ?? 0])),
  )}`,
);
