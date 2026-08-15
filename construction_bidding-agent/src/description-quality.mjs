export const DESCRIPTION_QUALITIES = ["missing", "metadata", "summary", "detailed"];

export function classifyDescriptionQuality(value) {
  const text = cleanDescription(value);
  if (!text || /no project description was provided by the source/i.test(text)) return "missing";
  return text.length >= 200 ? "detailed" : "summary";
}

export function hasUsableDescription(bid) {
  const quality = bid?.descriptionQuality || bid?.description_quality;
  return !quality || quality === "unknown" || quality === "summary" || quality === "detailed";
}

export function cleanDescription(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
