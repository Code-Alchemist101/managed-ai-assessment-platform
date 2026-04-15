export type BrowserSequenceState = {
  sessionId: string | null;
  sequenceNo: number;
};

export function reconcileBrowserSequenceState(
  state: BrowserSequenceState,
  nextSessionId: string
): BrowserSequenceState {
  if (state.sessionId === nextSessionId) {
    return state;
  }
  return {
    sessionId: nextSessionId,
    sequenceNo: 0
  };
}

export function nextBrowserSequenceNumber(
  state: BrowserSequenceState,
  sessionId: string
): number {
  const reconciled = reconcileBrowserSequenceState(state, sessionId);
  state.sessionId = reconciled.sessionId;
  state.sequenceNo = reconciled.sequenceNo + 1;
  return state.sequenceNo;
}
