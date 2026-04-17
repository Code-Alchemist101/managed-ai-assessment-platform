import test from "node:test";
import assert from "node:assert/strict";
import { resequenceEvents } from "../../services/control-plane-api/src/app";

const makeEvent = (source: string, sequenceNo: number, eventId: string) => ({
  event_id: eventId,
  session_id: "session-test",
  timestamp_utc: "2026-04-12T09:00:00Z",
  source,
  event_type: "session.started",
  sequence_no: sequenceNo,
  artifact_ref: "session",
  payload: {},
  client_version: "0.1.0",
  integrity_hash: "hash-001",
  policy_context: {}
});

test("resequenceEvents default behavior renumbers events per source from 1", () => {
  const events = [
    makeEvent("desktop", 5, "evt-001"),
    makeEvent("desktop", 10, "evt-002"),
    makeEvent("ide", 99, "evt-003")
  ];

  const result = resequenceEvents(events);

  assert.equal(result[0].sequence_no, 1);
  assert.equal(result[1].sequence_no, 2);
  assert.equal(result[2].sequence_no, 1);
});

test("resequenceEvents preserve_sequence_numbers=false renumbers events (explicit default)", () => {
  const events = [
    makeEvent("desktop", 3, "evt-001"),
    makeEvent("desktop", 7, "evt-002")
  ];

  const result = resequenceEvents(events, { preserve_sequence_numbers: false });

  assert.equal(result[0].sequence_no, 1);
  assert.equal(result[1].sequence_no, 2);
});

test("resequenceEvents preserve_sequence_numbers=true preserves original sequence_no", () => {
  const events = [
    makeEvent("desktop", 5, "evt-001"),
    makeEvent("desktop", 10, "evt-002"),
    makeEvent("ide", 99, "evt-003")
  ];

  const result = resequenceEvents(events, { preserve_sequence_numbers: true });

  assert.equal(result[0].sequence_no, 5);
  assert.equal(result[1].sequence_no, 10);
  assert.equal(result[2].sequence_no, 99);
});

test("resequenceEvents preserve_sequence_numbers=true preserves sequence gaps", () => {
  const events = [
    makeEvent("desktop", 1, "evt-001"),
    makeEvent("desktop", 3, "evt-002")
  ];

  const result = resequenceEvents(events, { preserve_sequence_numbers: true });

  assert.equal(result[0].sequence_no, 1);
  assert.equal(result[1].sequence_no, 3);
});

test("resequenceEvents default behavior masks sequence gaps by renumbering", () => {
  const events = [
    makeEvent("desktop", 1, "evt-001"),
    makeEvent("desktop", 3, "evt-002")
  ];

  const result = resequenceEvents(events);

  assert.equal(result[0].sequence_no, 1);
  assert.equal(result[1].sequence_no, 2);
});

test("resequenceEvents preserve_sequence_numbers=true does not modify other fields", () => {
  const events = [makeEvent("desktop", 7, "evt-unique")];
  const result = resequenceEvents(events, { preserve_sequence_numbers: true });

  assert.equal(result[0].event_id, "evt-unique");
  assert.equal(result[0].source, "desktop");
  assert.equal(result[0].session_id, "session-test");
});

test("resequenceEvents returns a new array (does not mutate input)", () => {
  const events = [makeEvent("desktop", 5, "evt-001")];
  const result = resequenceEvents(events, { preserve_sequence_numbers: true });

  assert.notEqual(result, events);
  assert.notEqual(result[0], events[0]);
});

test("resequenceEvents handles empty event array", () => {
  assert.deepEqual(resequenceEvents([]), []);
  assert.deepEqual(resequenceEvents([], { preserve_sequence_numbers: true }), []);
});
