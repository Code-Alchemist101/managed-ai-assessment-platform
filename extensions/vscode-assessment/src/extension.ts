import * as vscode from "vscode";
import crypto from "node:crypto";
import { SessionSequenceManager } from "./sequence-manager";

const defaultControlPlaneUrl =
  process.env.ASSESSMENT_CONTROL_PLANE_URL ?? process.env.CONTROL_PLANE_URL ?? "http://127.0.0.1:4010";

type RuntimeContext = {
  sessionId: string | null;
  eventEndpoint: string;
};

type AssessmentEvent = {
  event_id: string;
  session_id: string;
  timestamp_utc: string;
  source: "ide";
  event_type: string;
  sequence_no: number;
  artifact_ref: string;
  payload: Record<string, unknown>;
  client_version: string;
  integrity_hash: string;
  policy_context: Record<string, unknown>;
};

let sequenceState: vscode.Memento | null = null;
let cachedRuntime:
  | {
      sessionId: string | null;
      eventEndpoint: string;
      loadedAt: number;
    }
  | null = null;
let retryQueue: AssessmentEvent[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let flushInProgress = false;
const sessionSequenceManager = new SessionSequenceManager({
  async load(sessionId: string): Promise<number> {
    if (!sequenceState) {
      return 0;
    }
    return Number(sequenceState.get(getSequenceStateKey(sessionId), 0));
  },
  async save(sessionId: string, value: number): Promise<void> {
    if (!sequenceState) {
      return;
    }
    await sequenceState.update(getSequenceStateKey(sessionId), value);
  }
});

function getSequenceStateKey(sessionId: string): string {
  return `assessment-platform.sequence-no.${sessionId}`;
}

async function resolveRuntime(): Promise<RuntimeContext> {
  if (process.env.ASSESSMENT_SESSION_ID && process.env.ASSESSMENT_EVENT_ENDPOINT) {
    return {
      sessionId: process.env.ASSESSMENT_SESSION_ID,
      eventEndpoint: process.env.ASSESSMENT_EVENT_ENDPOINT
    };
  }

  if (cachedRuntime && Date.now() - cachedRuntime.loadedAt < 10_000) {
    return {
      sessionId: cachedRuntime.sessionId,
      eventEndpoint: cachedRuntime.eventEndpoint
    };
  }

  const response = await fetch(`${defaultControlPlaneUrl}/api/runtime`);
  const runtime = (await response.json()) as {
    ingestion_url: string;
    latest_session_id: string | null;
  };
  cachedRuntime = {
    sessionId: runtime.latest_session_id,
    eventEndpoint: runtime.ingestion_url,
    loadedAt: Date.now()
  };
  return {
    sessionId: runtime.latest_session_id,
    eventEndpoint: runtime.ingestion_url
  };
}

async function sendEventToEndpoint(eventEndpoint: string, event: AssessmentEvent): Promise<void> {
  const response = await fetch(eventEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event })
  });
  if (!response.ok) {
    throw new Error(`Event publish failed with ${response.status} ${response.statusText}`);
  }
}

function ensureFlushLoop(): void {
  if (flushTimer) {
    return;
  }
  flushTimer = setInterval(() => {
    void flushRetryQueue();
  }, 3_000);
}

function stopFlushLoop(): void {
  if (!flushTimer) {
    return;
  }
  clearInterval(flushTimer);
  flushTimer = null;
}

async function flushRetryQueue(): Promise<void> {
  if (flushInProgress || retryQueue.length === 0) {
    if (retryQueue.length === 0) {
      stopFlushLoop();
    }
    return;
  }

  flushInProgress = true;
  try {
    const runtime = await resolveRuntime();
    if (!runtime.sessionId) {
      return;
    }

    while (retryQueue.length > 0) {
      await sendEventToEndpoint(runtime.eventEndpoint, retryQueue[0]);
      retryQueue.shift();
    }
    stopFlushLoop();
  } catch (error) {
    console.error("Assessment telemetry retry flush failed", error);
    ensureFlushLoop();
  } finally {
    flushInProgress = false;
  }
}

function buildEvent(
  sessionId: string,
  eventType: string,
  artifactRef: string,
  payload: Record<string, unknown>,
  nextSequenceNo: number
): AssessmentEvent {
  return {
    event_id: crypto.randomUUID(),
    session_id: sessionId,
    timestamp_utc: new Date().toISOString(),
    source: "ide",
    event_type: eventType,
    sequence_no: nextSequenceNo,
    artifact_ref: artifactRef,
    payload,
    client_version: "0.1.0",
    integrity_hash: crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    policy_context: {
      managed_session: true
    }
  };
}

async function publishEvent(eventType: string, artifactRef: string, payload: Record<string, unknown>): Promise<void> {
  const runtime = await resolveRuntime();
  if (!runtime.sessionId) {
    return;
  }

  const event = buildEvent(
    runtime.sessionId,
    eventType,
    artifactRef,
    payload,
    await sessionSequenceManager.next(runtime.sessionId)
  );
  if (retryQueue.length > 0) {
    retryQueue.push(event);
    ensureFlushLoop();
    return;
  }

  try {
    await sendEventToEndpoint(runtime.eventEndpoint, event);
  } catch (error) {
    retryQueue.push(event);
    ensureFlushLoop();
    console.error("Failed to publish assessment event; queued in memory for retry", error);
  }
}

function buildAiWebview(panel: vscode.WebviewPanel): void {
  panel.webview.html = `
    <!doctype html>
    <html lang="en">
      <body style="font-family: sans-serif; padding: 12px;">
        <h2>Managed AI Assist</h2>
        <textarea id="prompt" rows="10" style="width: 100%;"></textarea>
        <button id="submit">Submit Prompt</button>
        <pre id="response"></pre>
        <script>
          const vscodeApi = acquireVsCodeApi();
          const button = document.getElementById('submit');
          button.addEventListener('click', () => {
            const promptText = document.getElementById('prompt').value;
            const response = "Bootstrap response: use managed prompts for complete telemetry capture.";
            document.getElementById('response').textContent = response;
            vscodeApi.postMessage({ type: 'prompt', promptText, responseText: response });
          });
        </script>
      </body>
    </html>
  `;
}

export function activate(context: vscode.ExtensionContext): void {
  sequenceState = context.workspaceState;
  void publishEvent("ide.extension.activated", "extension:assessment-platform", {
    mode: process.env.ASSESSMENT_SESSION_ID ? "injected" : "runtime-fallback"
  });

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(async (event) => {
      for (const change of event.contentChanges) {
        await publishEvent("ide.document.changed", `file:${event.document.uri.fsPath}`, {
          inserted_text: change.text,
          inserted_chars: change.text.length,
          deleted_chars: change.rangeLength,
          change_source: change.text.length > 20 ? "paste" : "typing"
        });
      }
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(async (editor) => {
      if (!editor) {
        return;
      }
      await publishEvent("ide.editor.focused", `file:${editor.document.uri.fsPath}`, {
        language_id: editor.document.languageId
      });
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(async (event) => {
      await publishEvent("ide.selection.changed", `file:${event.textEditor.document.uri.fsPath}`, {
        selection_count: event.selections.length
      });
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      await publishEvent("ide.document.saved", `file:${document.uri.fsPath}`, {
        version: document.version
      });
    })
  );

  context.subscriptions.push(
    vscode.languages.onDidChangeDiagnostics(async (event) => {
      for (const uri of event.uris) {
        const diagnostics = vscode.languages.getDiagnostics(uri);
        const errors = diagnostics.filter((diagnostic) => diagnostic.severity === vscode.DiagnosticSeverity.Error).length;
        const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === vscode.DiagnosticSeverity.Warning).length;
        await publishEvent("ide.diagnostics.changed", `file:${uri.fsPath}`, {
          errors,
          warnings
        });
      }
    })
  );

  context.subscriptions.push(
    vscode.tasks.onDidStartTaskProcess(async (event) => {
      await publishEvent("ide.task.started", `task:${event.execution.task.name}`, {
        task_type: event.execution.task.definition.type,
        command: event.execution.task.name
      });
    })
  );

  context.subscriptions.push(
    vscode.debug.onDidStartDebugSession(async (session) => {
      await publishEvent("ide.debug.started", `debug:${session.name}`, {
        name: session.name,
        type: session.type
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("assessmentPlatform.openAiAssist", async () => {
      const panel = vscode.window.createWebviewPanel("assessmentPlatformAi", "Managed AI Assist", vscode.ViewColumn.Beside, {
        enableScripts: true
      });
      buildAiWebview(panel);
      panel.webview.onDidReceiveMessage(async (message) => {
        const promptId = crypto.randomUUID();
        await publishEvent("ide.ai.prompt", "provider:first-party", {
          provider: "first-party",
          prompt_id: promptId,
          prompt_text: message.promptText,
          prompt_length: String(message.promptText ?? "").length
        });
        await publishEvent("ide.ai.response", "provider:first-party", {
          provider: "first-party",
          prompt_id: promptId,
          response_id: crypto.randomUUID(),
          response_text: message.responseText
        });
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("assessmentPlatform.captureCopy", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      const selectedText = editor.document.getText(editor.selection);
      await publishEvent("ide.clipboard.copy", `file:${editor.document.uri.fsPath}`, {
        selected_text: selectedText,
        selected_chars: selectedText.length
      });
    })
  );

  context.subscriptions.push(
    vscode.languages.registerDocumentPasteEditProvider(
      { language: "*" },
      {
        prepareDocumentPaste: async (
          _document: vscode.TextDocument,
          ranges: readonly vscode.Range[],
          dataTransfer: vscode.DataTransfer,
          _token: vscode.CancellationToken
        ) => {
          const textValue = dataTransfer.get("text/plain")?.asString ? await dataTransfer.get("text/plain")?.asString() : "";
          await publishEvent("ide.clipboard.copy", "clipboard", {
            selected_chars: ranges.length,
            selected_text: textValue ?? ""
          });
        },
        provideDocumentPasteEdits: async (
          _document: vscode.TextDocument,
          _ranges: readonly vscode.Range[],
          dataTransfer: vscode.DataTransfer,
          _context: vscode.DocumentPasteEditContext,
          _token: vscode.CancellationToken
        ) => {
          const textValue = dataTransfer.get("text/plain")?.asString ? await dataTransfer.get("text/plain")?.asString() : "";
          await publishEvent("ide.clipboard.paste", "clipboard", {
            pasted_text: textValue ?? "",
            pasted_chars: (textValue ?? "").length
          });
          return [];
        }
      },
      {
        providedPasteEditKinds: [vscode.DocumentDropOrPasteEditKind.Empty],
        copyMimeTypes: ["text/plain"],
        pasteMimeTypes: ["text/plain"]
      }
    )
  );

  context.subscriptions.push({
    dispose() {
      stopFlushLoop();
      retryQueue = [];
    }
  });
}

export async function deactivate(): Promise<void> {
  await publishEvent("ide.extension.deactivated", "extension:assessment-platform", {});
  await flushRetryQueue();
  stopFlushLoop();
}
