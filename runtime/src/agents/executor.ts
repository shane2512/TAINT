import type { ProposedAction } from "../proposal";

/** How a baseline agent moves funds. MOCK=1 uses MockExecutor; a LIVE NEAR executor is added when test accounts exist. */
export interface Executor {
  execute(action: ProposedAction): Promise<{ txHash: string }>;
}

export class MockExecutor implements Executor {
  executed: ProposedAction[] = [];

  async execute(action: ProposedAction): Promise<{ txHash: string }> {
    this.executed.push(action);
    return { txHash: "mock" };
  }
}
