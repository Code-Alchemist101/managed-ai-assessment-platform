export type SupportedProvider = "openai" | "anthropic" | "google";
export type BrowserAiEventType = "browser.ai.prompt" | "browser.ai.response";

export type AssessmentEmitMessage = {
  type: "assessment.emit";
  eventType: BrowserAiEventType;
  artifactRef: string;
  payload: Record<string, unknown>;
};

export type ForwardedAssessmentEmit = {
  eventType: BrowserAiEventType;
  artifactRef: string;
  payload: Record<string, unknown>;
};

export type ProviderCaptureConfig = {
  promptSelectors: string[];
  responseSelectors: string[];
  submitSelectors: string[];
};

const maxCapturedTextLength = 4_000;

export const providerCaptureConfigs: Record<SupportedProvider, ProviderCaptureConfig> = {
  openai: {
    promptSelectors: [
      "textarea[data-id]",
      "textarea[placeholder*='Message']",
      "textarea"
    ],
    responseSelectors: [
      "[data-message-author-role='assistant']",
      "article [data-message-author-role='assistant']"
    ],
    submitSelectors: [
      "button[data-testid='send-button']",
      "button[aria-label*='Send']",
      "button[type='submit']"
    ]
  },
  anthropic: {
    promptSelectors: [
      "div[contenteditable='true'][data-testid*='input']",
      "div[contenteditable='true'].ProseMirror",
      "div[contenteditable='true'][role='textbox']",
      "textarea"
    ],
    responseSelectors: [
      "[data-testid='assistant-message']",
      "[data-is-streaming='true']",
      "main .prose"
    ],
    submitSelectors: [
      "button[aria-label*='Send']",
      "button[data-testid*='send']",
      "button[type='submit']"
    ]
  },
  google: {
    promptSelectors: [
      "rich-textarea div[contenteditable='true']",
      "div[contenteditable='true'][role='textbox']",
      "textarea"
    ],
    responseSelectors: [
      "model-response",
      "message-content",
      "[data-response-id]",
      "main .markdown"
    ],
    submitSelectors: [
      "button[aria-label*='Send']",
      "button[data-testid*='send']",
      "button[type='submit']"
    ]
  }
};

export function detectProviderFromHostname(hostname: string): SupportedProvider | null {
  const normalizedHostname = hostname.toLowerCase();
  if (normalizedHostname === "chat.openai.com" || normalizedHostname.endsWith(".chat.openai.com")) {
    return "openai";
  }
  if (normalizedHostname === "claude.ai" || normalizedHostname.endsWith(".claude.ai")) {
    return "anthropic";
  }
  if (normalizedHostname === "gemini.google.com" || normalizedHostname.endsWith(".gemini.google.com")) {
    return "google";
  }
  return null;
}

export function normalizeCapturedText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxCapturedTextLength);
}

export function isAllowedSite(hostname: string, allowedSites: string[]): boolean {
  const normalizedHostname = hostname.toLowerCase();
  return allowedSites.some((allowedSite) => {
    const normalizedAllowedSite = allowedSite.toLowerCase();
    return normalizedHostname === normalizedAllowedSite || normalizedHostname.endsWith(`.${normalizedAllowedSite}`);
  });
}

export function isAssessmentEmitMessage(message: unknown): message is AssessmentEmitMessage {
  if (!message || typeof message !== "object") {
    return false;
  }

  const candidate = message as Partial<AssessmentEmitMessage>;
  return candidate.type === "assessment.emit"
    && (candidate.eventType === "browser.ai.prompt" || candidate.eventType === "browser.ai.response")
    && typeof candidate.artifactRef === "string"
    && Boolean(candidate.artifactRef)
    && !!candidate.payload
    && typeof candidate.payload === "object";
}

export function buildAssessmentEmitMessage(
  provider: SupportedProvider,
  eventType: BrowserAiEventType,
  text: string,
  pageUrl: string
): AssessmentEmitMessage | null {
  const normalizedText = normalizeCapturedText(text);
  if (!normalizedText) {
    return null;
  }

  const textKey = eventType === "browser.ai.prompt" ? "prompt_text" : "response_text";
  const lengthKey = eventType === "browser.ai.prompt" ? "prompt_length" : "response_length";
  const idKey = eventType === "browser.ai.prompt" ? "prompt_id" : "response_id";

  return {
    type: "assessment.emit",
    eventType,
    artifactRef: `provider:${provider}`,
    payload: {
      provider,
      page_url: pageUrl,
      [idKey]: crypto.randomUUID(),
      [textKey]: normalizedText,
      [lengthKey]: normalizedText.length,
      captured_via: "content_script"
    }
  };
}

export function prepareAssessmentEmitForForwarding(
  message: AssessmentEmitMessage,
  senderTabUrl: string | undefined,
  allowedSites: string[]
): ForwardedAssessmentEmit | null {
  if (!senderTabUrl) {
    return null;
  }

  let senderUrl: URL;
  try {
    senderUrl = new URL(senderTabUrl);
  } catch {
    return null;
  }

  if (!isAllowedSite(senderUrl.hostname, allowedSites)) {
    return null;
  }

  const payload = {
    ...message.payload,
    page_url: senderUrl.toString(),
    domain: senderUrl.hostname.toLowerCase(),
    allowed_site: true
  };

  return {
    eventType: message.eventType,
    artifactRef: message.artifactRef,
    payload
  };
}
