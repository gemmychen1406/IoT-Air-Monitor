export function createRefetchBatcher(invalidate: (key: string) => void, waitMs = 250) {
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    request(...keys: string[]) {
      keys.forEach((key) => pending.add(key));
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        const keys = [...pending];
        pending.clear();
        keys.forEach(invalidate);
      }, waitMs);
    },
    cancel() {
      clearTimeout(timer);
      timer = undefined;
      pending.clear();
    },
  };
}
