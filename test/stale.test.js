import { test } from "node:test";
import assert from "node:assert/strict";
import { staleness } from "../src/worker.js";

const now = Date.parse("2026-11-12T08:00:00Z");
const iso = (ms) => new Date(now + ms).toISOString();

test("fresh and in-grace requests are accepted", () => {
  assert.equal(staleness({ deadline_at: iso(30_000), issued_at: iso(-30_000) }, now), null);
  assert.equal(staleness({ deadlineAt: iso(-60_000), issuedAt: iso(-90_000) }, now), null); // late retry, within grace
  assert.equal(staleness({ type: "agent-games.preflight.v1", issued_at: iso(-60_000) }, now), null);
  assert.equal(staleness({ type: "agent-games.preflight.v1" }, now), null); // no timestamps: not stale
});

test("requests well past their deadline or very old are refused", () => {
  assert.ok(staleness({ deadline_at: iso(-3 * 60_000) }, now)?.past_deadline_ms);
  assert.ok(staleness({ deadlineAt: iso(-10 * 60_000) }, now)?.past_deadline_ms);
  assert.ok(staleness({ type: "agent-games.preflight.v1", issued_at: iso(-20 * 60_000) }, now)?.age_ms);
});
