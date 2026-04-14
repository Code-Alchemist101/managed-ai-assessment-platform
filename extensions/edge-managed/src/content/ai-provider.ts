import {
  buildAssessmentEmitMessage,
  detectProviderFromHostname,
  normalizeCapturedText,
  providerCaptureConfigs
} from "../provider-capture.js";

const provider = detectProviderFromHostname(location.hostname);

function readElementText(element: Element): string {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return element.value ?? "";
  }
  return element.textContent ?? "";
}

function matchesSelectorOrAncestor(target: EventTarget | null, selectors: string[]): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return selectors.some((selector) => target.matches(selector) || target.closest(selector) !== null);
}

if (provider) {
  const activeProvider = provider;
  const config = providerCaptureConfigs[activeProvider];
  let lastPromptText: string | null = null;
  let lastResponseText: string | null = null;
  let responseObserver: MutationObserver | null = null;
  let responseScanTimer: number | null = null;

  function queryLatestText(selectors: string[]): string | null {
    for (const selector of selectors) {
      const matches = Array.from(document.querySelectorAll(selector));
      for (const element of matches.reverse()) {
        const text = normalizeCapturedText(readElementText(element));
        if (text) {
          return text;
        }
      }
    }
    return null;
  }

  function emitPromptCapture(): void {
    const promptText = queryLatestText(config.promptSelectors);
    if (!promptText || promptText === lastPromptText) {
      return;
    }

    const message = buildAssessmentEmitMessage(activeProvider, "browser.ai.prompt", promptText, location.href);
    if (!message) {
      return;
    }

    lastPromptText = promptText;
    chrome.runtime.sendMessage(message);
  }

  function emitResponseCapture(): void {
    const responseText = queryLatestText(config.responseSelectors);
    if (!responseText || responseText === lastResponseText || responseText.length < 20) {
      return;
    }

    const message = buildAssessmentEmitMessage(activeProvider, "browser.ai.response", responseText, location.href);
    if (!message) {
      return;
    }

    lastResponseText = responseText;
    chrome.runtime.sendMessage(message);
  }

  function scheduleResponseCapture(): void {
    if (responseScanTimer !== null) {
      window.clearTimeout(responseScanTimer);
    }
    responseScanTimer = window.setTimeout(() => {
      emitResponseCapture();
    }, 800);
  }

  lastResponseText = queryLatestText(config.responseSelectors);

  document.addEventListener("click", (event) => {
    if (matchesSelectorOrAncestor(event.target, config.submitSelectors)) {
      emitPromptCapture();
    }
  }, true);

  document.addEventListener("submit", () => {
    emitPromptCapture();
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    if (matchesSelectorOrAncestor(event.target, config.promptSelectors)) {
      emitPromptCapture();
    }
  }, true);

  document.addEventListener("input", (event) => {
    if (matchesSelectorOrAncestor(event.target, config.promptSelectors)) {
      const draftText = queryLatestText(config.promptSelectors);
      if (draftText) {
        lastPromptText = null;
      }
    }
  }, true);

  if (document.body) {
    responseObserver = new MutationObserver(() => {
      scheduleResponseCapture();
    });
    responseObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }
}

export {};
