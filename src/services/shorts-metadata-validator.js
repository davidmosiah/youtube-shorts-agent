/**
 * Pure-function YouTube Shorts metadata validator.
 *
 * Validates metadata before submitting to the YouTube Data API so a
 * draft does not get rejected on upload. Shorts-specific limits:
 *   - title:            <= 100 chars, required, no leading/trailing whitespace
 *   - description:      <= 5000 chars
 *   - tags:             <= 500 entries, each <= 100 chars
 *   - duration_seconds: <= 60 (Shorts hard cap), > 0
 *   - title/description must not contain `<` or `>` (YouTube rejects them)
 *
 * Returns `{ ok, errors }` where `errors` is an array of human-readable
 * strings. Empty errors === ok=true.
 *
 * @typedef {{
 *   title?: unknown,
 *   description?: unknown,
 *   tags?: unknown,
 *   duration_seconds?: unknown,
 * }} ShortsMetadata
 * @typedef {{ ok: boolean, errors: string[] }} ValidationResult
 *
 * @param {ShortsMetadata} metadata
 * @param {{
 *   maxTitle?: number,
 *   maxDescription?: number,
 *   maxTags?: number,
 *   maxTagLength?: number,
 *   maxDurationSeconds?: number,
 * }} [options]
 * @returns {ValidationResult}
 */
export function validateShortsMetadata(metadata, options = {}) {
  const errors = [];

  if (metadata === null || typeof metadata !== "object") {
    return { ok: false, errors: ["metadata must be an object"] };
  }

  const maxTitle = numberOr(options.maxTitle, 100);
  const maxDescription = numberOr(options.maxDescription, 5000);
  const maxTags = numberOr(options.maxTags, 500);
  const maxTagLength = numberOr(options.maxTagLength, 100);
  const maxDuration = numberOr(options.maxDurationSeconds, 60);

  const { title, description, tags, duration_seconds } = metadata;

  // title
  if (title == null || (typeof title === "string" && title.trim() === "")) {
    errors.push("title is required");
  } else if (typeof title !== "string") {
    errors.push("title must be a string");
  } else {
    if (title.length > maxTitle) {
      errors.push(`title exceeds ${maxTitle} characters (got ${title.length})`);
    }
    if (/[<>]/.test(title)) {
      errors.push("title contains forbidden characters '<' or '>'");
    }
  }

  // description
  if (description != null) {
    if (typeof description !== "string") {
      errors.push("description must be a string");
    } else {
      if (description.length > maxDescription) {
        errors.push(
          `description exceeds ${maxDescription} characters (got ${description.length})`,
        );
      }
      if (/[<>]/.test(description)) {
        errors.push("description contains forbidden characters '<' or '>'");
      }
    }
  }

  // tags
  if (tags != null) {
    if (!Array.isArray(tags)) {
      errors.push("tags must be an array of strings");
    } else {
      if (tags.length > maxTags) {
        errors.push(`tags exceeds ${maxTags} entries (got ${tags.length})`);
      }
      tags.forEach((tag, i) => {
        if (typeof tag !== "string") {
          errors.push(`tags[${i}] must be a string`);
        } else if (tag.length > maxTagLength) {
          errors.push(
            `tags[${i}] exceeds ${maxTagLength} characters (got ${tag.length})`,
          );
        }
      });
    }
  }

  // duration — required for Shorts
  if (duration_seconds == null) {
    errors.push("duration_seconds is required");
  } else {
    const n = Number(duration_seconds);
    if (!Number.isFinite(n)) {
      errors.push("duration_seconds must be a finite number");
    } else if (n <= 0) {
      errors.push("duration_seconds must be > 0");
    } else if (n > maxDuration) {
      errors.push(
        `duration_seconds exceeds Shorts limit of ${maxDuration}s (got ${n}s)`,
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
