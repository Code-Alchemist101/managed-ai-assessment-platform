export type ManagedSessionContext = {
  sessionId: string;
  controlPlaneUrl: string;
  eventEndpoint: string;
  allowedSites: string[];
  requiredStreams: string[];
  loadedAt: number;
};

export type BrowserTabSnapshot = {
  id?: number;
  url?: string;
  active?: boolean;
};

type RecoverBootstrapContextDependencies = {
  tabs: BrowserTabSnapshot[];
  hydrateBootstrapContext: (candidateUrl: string) => Promise<ManagedSessionContext | null>;
  sendEvent: (
    eventType: string,
    artifactRef: string,
    payload: Record<string, unknown>,
    contextOverride?: ManagedSessionContext | null
  ) => Promise<void>;
};

export function selectBootstrapTab(
  tabs: BrowserTabSnapshot[],
  isBootstrapUrl: (candidateUrl: string) => boolean
): Required<Pick<BrowserTabSnapshot, "id" | "url" | "active">> | null {
  const candidates = tabs.filter(
    (tab): tab is Required<Pick<BrowserTabSnapshot, "id" | "url" | "active">> =>
      typeof tab.id === "number" && typeof tab.url === "string" && typeof tab.active === "boolean" && isBootstrapUrl(tab.url)
  );

  return candidates.find((tab) => tab.active) ?? candidates[0] ?? null;
}

export async function recoverBootstrapContextFromTabs(
  dependencies: RecoverBootstrapContextDependencies,
  isBootstrapUrl: (candidateUrl: string) => boolean
): Promise<ManagedSessionContext | null> {
  const bootstrapTab = selectBootstrapTab(dependencies.tabs, isBootstrapUrl);
  if (!bootstrapTab) {
    return null;
  }

  const context = await dependencies.hydrateBootstrapContext(bootstrapTab.url);
  if (!context) {
    return null;
  }

  await dependencies.sendEvent(
    "browser.navigation",
    `tab:${bootstrapTab.id}`,
    {
      url: bootstrapTab.url,
      domain: new URL(bootstrapTab.url).hostname,
      app_category: "browser",
      managed_bootstrap: true,
      allowed_site: true,
      policy_flag: null
    },
    context
  );

  if (bootstrapTab.active) {
    await dependencies.sendEvent(
      "browser.tab.activated",
      `tab:${bootstrapTab.id}`,
      {
        tab_id: bootstrapTab.id
      },
      context
    );
  }

  return context;
}
