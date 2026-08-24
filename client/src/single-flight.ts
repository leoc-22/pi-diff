export function createSingleFlight<Result>(task: () => Promise<Result>): () => Promise<Result> {
  let active: Promise<Result> | undefined;

  return () => {
    if (active) return active;

    const pending = task();
    active = pending;
    const clear = () => {
      if (active === pending) active = undefined;
    };
    void pending.then(clear, clear);
    return pending;
  };
}
