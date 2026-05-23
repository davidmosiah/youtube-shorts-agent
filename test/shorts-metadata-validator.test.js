import test from "node:test";
import assert from "node:assert/strict";

import { validateShortsMetadata } from "../src/services/shorts-metadata-validator.js";

test("returns ok=true for a minimal valid payload", () => {
  const r = validateShortsMetadata({ title: "My Short", duration_seconds: 30 });
  assert.deepEqual(r, { ok: true, errors: [] });
});

test("returns ok=true with all fields populated within limits", () => {
  const r = validateShortsMetadata({
    title: "Hello",
    description: "A description.",
    tags: ["funny", "ai"],
    duration_seconds: 45,
  });
  assert.equal(r.ok, true);
});

test("flags missing title", () => {
  const r = validateShortsMetadata({ duration_seconds: 30 });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("title is required")));
});

test("flags missing duration_seconds", () => {
  const r = validateShortsMetadata({ title: "ok" });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("duration_seconds is required")));
});

test("flags duration > 60s (Shorts limit)", () => {
  const r = validateShortsMetadata({ title: "ok", duration_seconds: 61 });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("exceeds Shorts limit of 60s")));
});

test("accepts duration exactly 60s", () => {
  const r = validateShortsMetadata({ title: "ok", duration_seconds: 60 });
  assert.equal(r.ok, true);
});

test("flags zero and negative duration", () => {
  for (const d of [0, -1, -100]) {
    const r = validateShortsMetadata({ title: "ok", duration_seconds: d });
    assert.equal(r.ok, false, `duration ${d} should fail`);
  }
});

test("flags non-finite duration", () => {
  const r = validateShortsMetadata({
    title: "ok",
    duration_seconds: "thirty",
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("finite number")));
});

test("flags title > 100 chars", () => {
  const r = validateShortsMetadata({
    title: "x".repeat(101),
    duration_seconds: 30,
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("title exceeds 100")));
});

test("flags title with forbidden < or > chars", () => {
  const r = validateShortsMetadata({
    title: "Hello <world>",
    duration_seconds: 30,
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("forbidden characters")));
});

test("flags description > 5000 chars", () => {
  const r = validateShortsMetadata({
    title: "ok",
    description: "x".repeat(5001),
    duration_seconds: 30,
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("description exceeds 5000")));
});

test("flags description with forbidden chars", () => {
  const r = validateShortsMetadata({
    title: "ok",
    description: "see <a>",
    duration_seconds: 30,
  });
  assert.equal(r.ok, false);
});

test("flags too many tags (>500)", () => {
  const tags = Array.from({ length: 501 }, (_, i) => `t${i}`);
  const r = validateShortsMetadata({
    title: "ok",
    tags,
    duration_seconds: 30,
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("tags exceeds 500")));
});

test("flags individual tag > 100 chars", () => {
  const r = validateShortsMetadata({
    title: "ok",
    tags: ["short", "x".repeat(101)],
    duration_seconds: 30,
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("tags[1] exceeds 100")));
});

test("flags non-string tag", () => {
  const r = validateShortsMetadata({
    title: "ok",
    tags: ["ok", 42],
    duration_seconds: 30,
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("tags[1] must be a string")));
});

test("non-object metadata fails fast", () => {
  const r = validateShortsMetadata(null);
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, ["metadata must be an object"]);
});

test("custom limits override defaults", () => {
  const r = validateShortsMetadata(
    { title: "ok", duration_seconds: 90 },
    { maxDurationSeconds: 120 },
  );
  assert.equal(r.ok, true);
});

test("accumulates multiple errors", () => {
  const r = validateShortsMetadata({
    title: "x".repeat(200),
    description: "y".repeat(5001),
    tags: "not an array",
    duration_seconds: 999,
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 4);
});
