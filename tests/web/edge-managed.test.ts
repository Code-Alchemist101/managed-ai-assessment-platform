import test from "node:test";
import assert from "node:assert/strict";
import {
  recoverBootstrapContextFromTabs,
  selectBootstrapTab,
  type BrowserTabSnapshot,
  type ManagedSessionContext
} from "../../extensions/edge-managed/src/bootstrap-recovery";
import {
  buildAssessmentEmitMessage,
  detectProviderFromHostname,
  normalizeCapturedText,
  prepareAssessmentEmitForForwarding
} from "../../extensions/edge-managed/src/provider-capture";
import {
  nextBrowserSequenceNumber,
  reconcileBrowserSequenceState,
  type BrowserSequenceState
} from "../../extensions/edge-managed/src/sequence-state";

const bootstrapUrl = "http://127.0.0.1:4010/browser-bootstrap?sessionId=session-123";

function isBootstrapUrl(candidateUrl: string): boolean {
  return candidateUrl.startsWith("http://127.0.0.1:4010/browser-bootstrap?sessionId=");
}

test("edge bootstrap recovery prefers the active bootstrap tab", () => {
  const tabs: BrowserTabSnapshot[] = [
    { id: 1, url: "https://developer.mozilla.org/", active: false },
    { id: 2, url: bootstrapUrl, active: false },
    { id: 3, url: `${bootstrapUrl}-active`, active: true }
  ];

  assert.deepEqual(selectBootstrapTab(tabs, isBootstrapUrl), {
    id: 3,
    url: `${bootstrapUrl}-active`,
    active: true
  });
});

test("edge bootstrap recovery hydrates context and emits bootstrap navigation events", async () => {
  const context: ManagedSessionContext = {
    sessionId: "session-123",
    controlPlaneUrl: "http://127.0.0.1:4010",
    eventEndpoint: "http://127.0.0.1:4020/api/events",
    allowedSites: ["developer.mozilla.org"],
    requiredStreams: ["desktop", "ide", "browser"],
    loadedAt: 1
  };
  const calls: Array<{
    eventType: string;
    artifactRef: string;
    payload: Record<string, unknown>;
    contextOverride: ManagedSessionContext | null | undefined;
  }> = [];

  const recovered = await recoverBootstrapContextFromTabs(
    {
      tabs: [{ id: 7, url: bootstrapUrl, active: true }],
      hydrateBootstrapContext: async (candidateUrl) => {
        assert.equal(candidateUrl, bootstrapUrl);
        return context;
      },
      sendEvent: async (eventType, artifactRef, payload, contextOverride) => {
        calls.push({ eventType, artifactRef, payload, contextOverride });
      }
    },
    isBootstrapUrl
  );

  assert.equal(recovered, context);
  assert.deepEqual(calls.map((call) => call.eventType), ["browser.navigation", "browser.tab.activated"]);
  assert.deepEqual(calls[0]?.payload, {
    url: bootstrapUrl,
    domain: "127.0.0.1",
    app_category: "browser",
    managed_bootstrap: true,
    allowed_site: true,
    policy_flag: null
  });
  assert.deepEqual(calls[1]?.payload, { tab_id: 7 });
  assert.equal(calls[0]?.contextOverride, context);
  assert.equal(calls[1]?.contextOverride, context);
});

test("edge bootstrap recovery returns null when no bootstrap tab is open", async () => {
  const recovered = await recoverBootstrapContextFromTabs(
    {
      tabs: [{ id: 1, url: "https://example.com/", active: true }],
      hydrateBootstrapContext: async () => {
        assert.fail("hydrateBootstrapContext should not be called without a bootstrap tab");
      },
      sendEvent: async () => {
        assert.fail("sendEvent should not be called without a bootstrap tab");
      }
    },
    isBootstrapUrl
  );

  assert.equal(recovered, null);
});

test("edge provider helpers detect supported providers and normalize captured text", () => {
  assert.equal(detectProviderFromHostname("chat.openai.com"), "openai");
  assert.equal(detectProviderFromHostname("claude.ai"), "anthropic");
  assert.equal(detectProviderFromHostname("gemini.google.com"), "google");
  assert.equal(detectProviderFromHostname("example.com"), null);
  assert.equal(normalizeCapturedText("  hello\n\nworld  "), "hello world");
});

test("edge provider helpers build additive browser ai events", () => {
  const message = buildAssessmentEmitMessage(
    "openai",
    "browser.ai.prompt",
    "Explain why this test matters",
    "https://chat.openai.com/c/session-123"
  );

  assert.ok(message);
  assert.equal(message?.type, "assessment.emit");
  assert.equal(message?.eventType, "browser.ai.prompt");
  assert.equal(message?.artifactRef, "provider:openai");
  assert.equal(message?.payload.provider, "openai");
  assert.equal(message?.payload.prompt_length, "Explain why this test matters".length);
});

test("edge provider helpers only forward content-script events from allowed sites", () => {
  const message = buildAssessmentEmitMessage(
    "openai",
    "browser.ai.response",
    "Here is the synthesized answer",
    "https://chat.openai.com/c/session-123"
  );
  assert.ok(message);

  const forwarded = prepareAssessmentEmitForForwarding(message!, "https://chat.openai.com/c/session-123", [
    "chat.openai.com",
    "claude.ai"
  ]);

  assert.deepEqual(forwarded, {
    eventType: "browser.ai.response",
    artifactRef: "provider:openai",
    payload: {
      ...message!.payload,
      page_url: "https://chat.openai.com/c/session-123",
      domain: "chat.openai.com",
      allowed_site: true
    }
  });

  assert.equal(
    prepareAssessmentEmitForForwarding(message!, "https://example.com/", ["chat.openai.com"]),
    null
  );
});

test("edge sequence state keeps monotonic values on same-session refresh", () => {
  const state: BrowserSequenceState = {
    sessionId: null,
    sequenceNo: 0
  };

  assert.equal(nextBrowserSequenceNumber(state, "session-123"), 1);
  assert.equal(nextBrowserSequenceNumber(state, "session-123"), 2);

  const reconciled = reconcileBrowserSequenceState(state, "session-123");
  state.sessionId = reconciled.sessionId;
  state.sequenceNo = reconciled.sequenceNo;
  assert.equal(nextBrowserSequenceNumber(state, "session-123"), 3);
});

test("edge sequence state resets only when session id changes", () => {
  const state: BrowserSequenceState = {
    sessionId: "session-123",
    sequenceNo: 5
  };

  const reconciled = reconcileBrowserSequenceState(state, "session-456");
  state.sessionId = reconciled.sessionId;
  state.sequenceNo = reconciled.sequenceNo;

  assert.equal(state.sessionId, "session-456");
  assert.equal(nextBrowserSequenceNumber(state, "session-456"), 1);
});
