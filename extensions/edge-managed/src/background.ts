import { recoverBootstrapContextFromTabs, type BrowserTabSnapshot, type ManagedSessionContext } from "./bootstrap-recovery.js";
import {
  isAllowedSite,
  isAssessmentEmitMessage,
  prepareAssessmentEmitForForwarding
} from "./provider-capture.js";
import {
  nextBrowserSequenceNumber,
  reconcileBrowserSequenceState,
  type BrowserSequenceState
} from "./sequence-state.js";

const defaultControlPlaneUrl = "http://127.0.0.1:4010";
const bootstrapStorageKey = "managedSessionContext";

type SessionBootstrap = {
  session_id: string;
  manifest_id: string;
  control_plane_url: string;
  ingestion_event_endpoint: string;
  reviewer_url: string;
  allowed_ai_providers: string[];
  allowed_sites: string[];
  required_streams: string[];
};

const browserSequenceState: BrowserSequenceState = {
  sessionId: null,
  sequenceNo: 0
};
let cachedSessionContext: ManagedSessionContext | null = null;

function storageGet<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (values) => {
      resolve(values[key] as T | undefined);
    });
  });
}

function storageSet(key: string, value: unknown): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, () => resolve());
  });
}

function isBootstrapUrl(candidateUrl: string): boolean {
  try {
    const parsed = new URL(candidateUrl);
    return parsed.origin === defaultControlPlaneUrl && parsed.pathname === "/browser-bootstrap" && parsed.searchParams.has("sessionId");
  } catch {
    return false;
  }
}

function getBootstrapSessionId(candidateUrl: string): string | null {
  try {
    return new URL(candidateUrl).searchParams.get("sessionId");
  } catch {
    return null;
  }
}

async function persistSessionContext(context: ManagedSessionContext): Promise<void> {
  const reconciledState = reconcileBrowserSequenceState(browserSequenceState, context.sessionId);
  browserSequenceState.sessionId = reconciledState.sessionId;
  browserSequenceState.sequenceNo = reconciledState.sequenceNo;
  cachedSessionContext = context;
  await storageSet(bootstrapStorageKey, context);
}

async function loadSessionContext(): Promise<ManagedSessionContext | null> {
  if (cachedSessionContext) {
    return cachedSessionContext;
  }
  cachedSessionContext = (await storageGet<ManagedSessionContext>(bootstrapStorageKey)) ?? null;
  return cachedSessionContext;
}

async function fetchSessionBootstrap(sessionId: string): Promise<ManagedSessionContext> {
  const response = await fetch(`${defaultControlPlaneUrl}/api/sessions/${sessionId}/bootstrap`);
  if (!response.ok) {
    throw new Error(`Bootstrap fetch failed with ${response.status} ${response.statusText}`);
  }

  const bootstrap = (await response.json()) as SessionBootstrap;
  return {
    sessionId: bootstrap.session_id,
    controlPlaneUrl: bootstrap.control_plane_url,
    eventEndpoint: bootstrap.ingestion_event_endpoint,
    allowedSites: bootstrap.allowed_sites,
    requiredStreams: bootstrap.required_streams,
    loadedAt: Date.now()
  };
}

async function hydrateBootstrapContext(candidateUrl: string): Promise<ManagedSessionContext | null> {
  if (!isBootstrapUrl(candidateUrl)) {
    return null;
  }

  const sessionId = getBootstrapSessionId(candidateUrl);
  if (!sessionId) {
    return null;
  }

  const context = await fetchSessionBootstrap(sessionId);
  await persistSessionContext(context);
  return context;
}

function queryTabs(): Promise<BrowserTabSnapshot[]> {
  return new Promise((resolve) => {
    chrome.tabs.query({}, (tabs) => {
      resolve(tabs.map((tab) => ({
        id: tab.id,
        url: tab.url,
        active: tab.active
      })));
    });
  });
}

async function recoverBootstrapContextOnStartup(): Promise<void> {
  const existingContext = await loadSessionContext();
  if (existingContext) {
    return;
  }

  await recoverBootstrapContextFromTabs(
    {
      tabs: await queryTabs(),
      hydrateBootstrapContext,
      sendEvent
    },
    isBootstrapUrl
  );
}

async function sendEvent(
  eventType: string,
  artifactRef: string,
  payload: Record<string, unknown>,
  contextOverride?: ManagedSessionContext | null
): Promise<void> {
  const context = contextOverride ?? await loadSessionContext();
  if (!context) {
    return;
  }

  const event = {
    event_id: crypto.randomUUID(),
    session_id: context.sessionId,
    timestamp_utc: new Date().toISOString(),
    source: "browser",
    event_type: eventType,
    sequence_no: nextBrowserSequenceNumber(browserSequenceState, context.sessionId),
    artifact_ref: artifactRef,
    payload,
    client_version: "0.1.0",
    integrity_hash: "",
    policy_context: {
      managed_session: true
    }
  };

  await fetch(context.eventEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ event })
  }).catch(() => undefined);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const tabUrl = tab.url;
  if (changeInfo.status !== "complete" || !tabUrl) {
    return;
  }

  void (async () => {
    const bootstrapContext = await hydrateBootstrapContext(tabUrl);
    const context = bootstrapContext ?? await loadSessionContext();
    if (!context) {
      return;
    }

    const url = new URL(tabUrl);
    const managedBootstrap = isBootstrapUrl(tabUrl);
    const allowedSite = managedBootstrap ? true : isAllowedSite(url.hostname, context.allowedSites);

    await sendEvent(
      "browser.navigation",
      `tab:${tabId}`,
      {
        url: tabUrl,
        domain: url.hostname,
        app_category: "browser",
        managed_bootstrap: managedBootstrap,
        allowed_site: allowedSite,
        policy_flag: allowedSite ? null : "unsupported_site"
      },
      context
    );
  })();
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void sendEvent("browser.tab.activated", `tab:${tabId}`, {
    tab_id: tabId
  });
});

chrome.runtime.onMessage.addListener((message, sender) => {
  void (async () => {
    if (!isAssessmentEmitMessage(message)) {
      return;
    }

    const context = await loadSessionContext();
    if (!context) {
      return;
    }

    const forwardedEvent = prepareAssessmentEmitForForwarding(message, sender.tab?.url, context.allowedSites);
    if (!forwardedEvent) {
      return;
    }

    await sendEvent(forwardedEvent.eventType, forwardedEvent.artifactRef, forwardedEvent.payload, context);
  })().catch(() => undefined);
});

void recoverBootstrapContextOnStartup().catch(() => undefined);

export {};
