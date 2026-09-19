export class InvalidStateTransitionError extends Error {
  readonly code = 'INVALID_STATE_TRANSITION';

  constructor(
    readonly entity: string,
    readonly from: string,
    readonly event: string,
  ) {
    super(`Invalid ${entity} transition: ${from} -> ${event}`);
    this.name = 'InvalidStateTransitionError';
  }
}

export type TransitionTable<Status extends string, Event extends string> = {
  readonly [status in Status]: Partial<Record<Event, Status>>;
};

export function transitionFrom<Status extends string, Event extends string>(
  entity: string,
  status: Status,
  event: Event,
  table: TransitionTable<Status, Event>,
): Status {
  const nextStatus = table[status][event];

  if (nextStatus === undefined) {
    throw new InvalidStateTransitionError(entity, status, event);
  }

  return nextStatus;
}

export function canTransition<Status extends string, Event extends string>(
  status: Status,
  event: Event,
  table: TransitionTable<Status, Event>,
): boolean {
  return table[status][event] !== undefined;
}
