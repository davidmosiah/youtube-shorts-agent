# Changelog

## 0.1.4 - 2026-05-22
- Add `validateShortsMetadata({title, description, tags, duration_seconds})` returning `{ok, errors}`. Defaults enforce Shorts-specific rules: title required and <=100 chars, description <=5000, tags <=500 entries (each <=100 chars), `duration_seconds` required and <=60. Also rejects `<` / `>` in title/description (YouTube API rejection).
- 18 new tests covering required fields, boundary lengths, duration rules, forbidden characters, custom limits and multi-error accumulation.

## 0.1.3
- Previous release.
