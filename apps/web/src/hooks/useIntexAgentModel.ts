import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_INTEX_AGENT_MODEL,
  type IntexAgentModel,
} from '@intexuraos/llm-contract';
import { ApiError } from '@/services/apiClient.js';
import type {
  IntexAgentModelPatchResponse,
  IntexAgentModelSelectorV1,
  LlmKeysResponse,
} from '@/services/llmKeysApi.types.js';

export type IntexAgentModelMutationOutcome =
  | 'applied'
  | 'superseded'
  | 'rolled_back'
  | 'disposed';

export type IntexAgentModelSelectorAvailable = Extract<
  IntexAgentModelSelectorV1,
  { status: 'available' }
>;

export type UseIntexAgentModelResult =
  | { availability: 'unavailable'; writable: false }
  | {
      availability: 'available';
      writable: true;
      explicitModel: IntexAgentModel | null;
      effectiveModel: IntexAgentModel;
      revision: number;
      options: IntexAgentModelSelectorAvailable['options'];
      savingIntexAgentModel: boolean;
      intexAgentModelError: string | null;
      setIntexAgentModel: (model: IntexAgentModel | null) => Promise<IntexAgentModelMutationOutcome>;
    };

export interface UseIntexAgentModelInput {
  subject: string | undefined;
  selector: IntexAgentModelSelectorV1 | undefined;
  getAccessToken: () => Promise<string>;
  getLlmKeys: (accessToken: string, userId: string) => Promise<LlmKeysResponse>;
  updateIntexAgentModel: (
    accessToken: string,
    userId: string,
    model: IntexAgentModel | null,
    expectedRevision: number,
    signal?: AbortSignal
  ) => Promise<IntexAgentModelPatchResponse>;
}

type View =
  | { availability: 'unavailable' }
  | {
      availability: 'available';
      explicitModel: IntexAgentModel | null;
      effectiveModel: IntexAgentModel;
      revision: number;
      options: IntexAgentModelSelectorAvailable['options'];
      saving: boolean;
      error: string | null;
    };

interface Waiter {
  resolve: (outcome: IntexAgentModelMutationOutcome) => void;
}

interface Work {
  intent: IntexAgentModel | null;
  waiters: Set<Waiter>;
  controller: AbortController;
  retry: boolean;
}

interface Recovery {
  owner: Work;
  floor: number;
}

const UNAVAILABLE_VIEW: View = { availability: 'unavailable' };

function hasStatus(error: unknown, status: number): boolean {
  return error instanceof ApiError
    ? error.status === status
    : typeof error === 'object' && error !== null && 'status' in error && error.status === status;
}

function conflictRevision(error: unknown): number | null {
  if (!hasStatus(error, 409) || typeof error !== 'object' || error === null || !('details' in error)) return null;
  const details = error.details;
  if (typeof details !== 'object' || details === null || !('currentRevision' in details)) return null;
  const revision = details.currentRevision;
  return typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0
    ? revision
    : null;
}

class IntexAgentModelPump {
  private confirmed: IntexAgentModelSelectorAvailable;
  private visibleIntent: IntexAgentModel | null;
  private active: Work | undefined;
  private queued: Work | undefined;
  private recovery: Recovery | undefined;
  private disposed = false;
  private error: string | null = null;

  public constructor(
    private readonly subject: string,
    selector: IntexAgentModelSelectorAvailable,
    private readonly input: () => UseIntexAgentModelInput,
    private readonly onChange: (view: View) => void
  ) {
    this.confirmed = selector;
    this.visibleIntent = selector.explicitModel;
    this.emit();
  }

  public reconcile(selector: IntexAgentModelSelectorV1 | undefined): void {
    if (this.disposed) return;
    if (selector?.status !== 'available') {
      this.dispose();
      return;
    }
    if (selector.revision < this.confirmed.revision) return;
    if (selector.revision === this.confirmed.revision) {
      if (selector.explicitModel !== this.confirmed.explicitModel) return;
      return;
    }
    this.confirmed = selector;
    if (this.active === undefined && this.queued === undefined && this.recovery === undefined) {
      this.visibleIntent = selector.explicitModel;
    }
    this.emit();
  }

  public isForSubject(subject: string): boolean {
    return this.subject === subject;
  }

  public request(intent: IntexAgentModel | null): Promise<IntexAgentModelMutationOutcome> {
    if (this.disposed) return Promise.resolve('disposed');
    this.visibleIntent = intent;
    this.error = null;
    const promise = new Promise<IntexAgentModelMutationOutcome>((resolve) => {
      const waiter = { resolve };
      if (this.active === undefined && this.queued === undefined && this.recovery === undefined && intent === this.confirmed.explicitModel) {
        waiter.resolve('applied');
        this.visibleIntent = this.confirmed.explicitModel;
        this.emit();
        return;
      }

      if (this.active !== undefined) {
        if (this.active.intent === intent) {
          this.dropQueuedForActive(intent);
          this.active.waiters.add(waiter);
        } else if (this.queued?.intent === intent) {
          this.queued.waiters.add(waiter);
        } else {
          this.replaceQueued(this.createWork(intent, waiter));
        }
        this.emit();
        return;
      }

      if (this.recovery !== undefined) {
        if (this.recovery.owner.intent === intent) {
          this.recovery.owner.waiters.add(waiter);
        } else {
          this.settle(this.recovery.owner, 'superseded');
          this.recovery.owner = this.createWork(intent, waiter);
        }
        this.emit();
        return;
      }

      this.active = this.createWork(intent, waiter);
      this.emit();
      void this.dispatch(this.active);
    });
    return promise;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.active?.controller.abort();
    this.recovery?.owner.controller.abort();
    this.queued?.controller.abort();
    if (this.active !== undefined) this.settle(this.active, 'disposed');
    if (this.recovery !== undefined) this.settle(this.recovery.owner, 'disposed');
    if (this.queued !== undefined) this.settle(this.queued, 'disposed');
    this.active = undefined;
    this.recovery = undefined;
    this.queued = undefined;
    this.onChange(UNAVAILABLE_VIEW);
  }

  private createWork(intent: IntexAgentModel | null, waiter: Waiter): Work {
    return { intent, waiters: new Set([waiter]), controller: new AbortController(), retry: false };
  }

  private replaceQueued(next: Work): void {
    if (this.queued !== undefined) this.settle(this.queued, 'superseded');
    this.queued = next;
  }

  private dropQueuedForActive(intent: IntexAgentModel | null): void {
    if (this.queued !== undefined && this.queued.intent !== intent) {
      this.settle(this.queued, 'superseded');
      this.queued = undefined;
    }
  }

  private settle(work: Work, outcome: IntexAgentModelMutationOutcome): void {
    for (const waiter of work.waiters) waiter.resolve(outcome);
    work.waiters.clear();
  }

  private async dispatch(work: Work): Promise<void> {
    try {
      const token = await this.input().getAccessToken();
      if (this.noLongerOwns(work)) return;
      if (this.queued?.intent === this.confirmed.explicitModel) {
        this.active = undefined;
        this.settle(work, 'superseded');
        this.dispatchNext();
        return;
      }
      if (work.intent === this.confirmed.explicitModel) {
        this.active = undefined;
        if (this.queued !== undefined) {
          this.settle(work, 'superseded');
          this.dispatchNext();
          return;
        }
        this.settle(work, 'applied');
        this.visibleIntent = this.confirmed.explicitModel;
        this.dispatchNext();
        return;
      }
      const response = await this.input().updateIntexAgentModel(
        token,
        this.subject,
        work.intent,
        this.confirmed.revision,
        work.controller.signal
      );
      if (this.noLongerOwns(work)) return;
      if (!this.acceptResponse(work, response)) {
        this.handleFailure(work);
        return;
      }
      this.active = undefined;
      if (this.queued !== undefined) {
        this.settle(work, 'superseded');
        this.dispatchNext();
        return;
      }
      this.visibleIntent = this.confirmed.explicitModel;
      this.error = null;
      this.settle(work, 'applied');
      this.emit();
    } catch (error: unknown) {
      if (this.disposed || this.active !== work) return;
      if (hasStatus(error, 404)) {
        this.dispose();
        return;
      }
      if (!work.retry && hasStatus(error, 409)) {
        const floor = conflictRevision(error);
        if (floor === null) {
          this.failInvalidConflict(work);
          return;
        }
        this.beginRecovery(work, floor);
        return;
      }
      this.handleFailure(work);
    }
  }

  private acceptResponse(work: Work, response: IntexAgentModelPatchResponse): boolean {
    if (response.explicitModel !== work.intent) return false;
    if (response.revision < this.confirmed.revision) return false;
    if (response.revision === this.confirmed.revision && response.explicitModel !== this.confirmed.explicitModel) return false;
    this.confirmed = {
      status: 'available',
      explicitModel: response.explicitModel,
      effectiveModel: response.effectiveModel,
      source: response.source,
      revision: response.revision,
      options: this.confirmed.options,
    };
    return true;
  }

  private handleFailure(work: Work): void {
    this.active = undefined;
    if (this.queued !== undefined) {
      this.settle(work, 'superseded');
      this.dispatchNext();
      return;
    }
    this.visibleIntent = this.confirmed.explicitModel;
    this.error = 'Failed to save Intex Agent model';
    this.settle(work, 'rolled_back');
    this.emit();
  }

  private beginRecovery(work: Work, conflictFloor: number): void {
    this.active = undefined;
    const owner = this.queued ?? work;
    this.queued = undefined;
    if (owner !== work) this.settle(work, 'superseded');
    const recovery: Recovery = { owner, floor: Math.max(this.confirmed.revision, conflictFloor) };
    this.recovery = recovery;
    this.emit();
    void this.recover(recovery);
  }

  private failInvalidConflict(work: Work): void {
    this.active = undefined;
    const owner = this.queued ?? work;
    this.queued = undefined;
    if (owner !== work) this.settle(work, 'superseded');
    this.visibleIntent = this.confirmed.explicitModel;
    this.error = 'Failed to save Intex Agent model';
    this.settle(owner, 'rolled_back');
    this.emit();
  }

  private async recover(recovery: Recovery): Promise<void> {
    try {
      const token = await this.input().getAccessToken();
      if (this.noLongerRecovering(recovery)) return;
      const refetched = await this.input().getLlmKeys(token, this.subject);
      if (this.noLongerRecovering(recovery)) return;
      const selector = refetched.intexAgentModelSelector;
      if (selector.status !== 'available') {
        this.recovery = undefined;
        this.settle(recovery.owner, 'rolled_back');
        this.dispose();
        return;
      }
      if (selector.revision < recovery.floor || (selector.revision === this.confirmed.revision && selector.explicitModel !== this.confirmed.explicitModel)) {
        this.failRecovery(recovery);
        return;
      }
      this.reconcile(selector);
      const owner = recovery.owner;
      if (this.confirmed.explicitModel === owner.intent) {
        this.recovery = undefined;
        this.visibleIntent = this.confirmed.explicitModel;
        this.error = null;
        this.settle(owner, 'applied');
        this.emit();
        return;
      }
      this.recovery = undefined;
      owner.retry = true;
      this.active = owner;
      this.emit();
      void this.dispatch(owner);
    } catch (error: unknown) {
      if (this.disposed || this.recovery !== recovery) return;
      if (hasStatus(error, 404)) {
        this.dispose();
        return;
      }
      this.failRecovery(recovery);
    }
  }

  private failRecovery(recovery: Recovery): void {
    if (this.recovery !== recovery) return;
    this.recovery = undefined;
    this.visibleIntent = this.confirmed.explicitModel;
    this.error = 'Failed to save Intex Agent model';
    this.settle(recovery.owner, 'rolled_back');
    this.emit();
  }

  private noLongerOwns(work: Work): boolean {
    return this.disposed || this.active !== work;
  }

  private noLongerRecovering(recovery: Recovery): boolean {
    return this.disposed || this.recovery !== recovery;
  }

  private dispatchNext(): void {
    const next = this.queued;
    this.queued = undefined;
    if (next === undefined) {
      this.emit();
      return;
    }
    if (next.intent === this.confirmed.explicitModel) {
      this.visibleIntent = this.confirmed.explicitModel;
      this.error = null;
      this.settle(next, 'applied');
      this.emit();
      return;
    }
    this.active = next;
    this.emit();
    void this.dispatch(next);
  }

  private emit(): void {
    if (this.disposed) return;
    this.onChange({
      availability: 'available',
      explicitModel: this.visibleIntent,
      effectiveModel: this.visibleIntent ?? DEFAULT_INTEX_AGENT_MODEL,
      revision: this.confirmed.revision,
      options: this.confirmed.options,
      saving: this.active !== undefined || this.queued !== undefined || this.recovery !== undefined,
      error: this.error,
    });
  }
}

export function useIntexAgentModel(input: UseIntexAgentModelInput): UseIntexAgentModelResult {
  const inputRef = useRef(input);
  inputRef.current = input;
  const controllerRef = useRef<IntexAgentModelPump | null>(null);
  const [view, setView] = useState<View>(UNAVAILABLE_VIEW);

  useEffect(() => {
    const selector = input.selector;
    const existing = controllerRef.current;
    if (input.subject === undefined || selector?.status !== 'available') {
      existing?.dispose();
      controllerRef.current = null;
      setView(UNAVAILABLE_VIEW);
      return;
    }
    if (existing?.isForSubject(input.subject) !== true) {
      existing?.dispose();
      controllerRef.current = new IntexAgentModelPump(input.subject, selector, () => inputRef.current, setView);
      return;
    }
    existing.reconcile(selector);
  }, [input.subject, input.selector]);

  useEffect(() => {
    return (): void => {
      controllerRef.current?.dispose();
      controllerRef.current = null;
    };
  }, []);

  const setIntexAgentModel = useCallback(
    (model: IntexAgentModel | null): Promise<IntexAgentModelMutationOutcome> => {
      const controller = controllerRef.current;
      return controller === null ? Promise.resolve('disposed') : controller.request(model);
    },
    []
  );

  const controller = controllerRef.current;
  if (
    input.subject === undefined
    || input.selector?.status !== 'available'
    || controller === null
    || !controller.isForSubject(input.subject)
    || view.availability !== 'available'
  ) {
    return { availability: 'unavailable', writable: false };
  }
  return {
    availability: 'available',
    writable: true,
    explicitModel: view.explicitModel,
    effectiveModel: view.effectiveModel,
    revision: view.revision,
    options: view.options,
    savingIntexAgentModel: view.saving,
    intexAgentModelError: view.error,
    setIntexAgentModel,
  };
}
