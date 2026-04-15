export type SequenceStore = {
  load(sessionId: string): Promise<number>;
  save(sessionId: string, value: number): Promise<void>;
};

export class SessionSequenceManager {
  private activeSessionId: string | null = null;
  private activeSequenceNo = 0;
  private operationChain: Promise<void> = Promise.resolve();

  constructor(private readonly store: SequenceStore) {}

  async next(sessionId: string): Promise<number> {
    return this.enqueue(async () => {
      if (this.activeSessionId !== sessionId) {
        this.activeSessionId = sessionId;
        this.activeSequenceNo = await this.store.load(sessionId);
      }
      this.activeSequenceNo += 1;
      await this.store.save(sessionId, this.activeSequenceNo);
      return this.activeSequenceNo;
    });
  }

  private async enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const nextOperation = this.operationChain.then(operation, operation);
    this.operationChain = nextOperation.then(() => undefined, () => undefined);
    return nextOperation;
  }
}
