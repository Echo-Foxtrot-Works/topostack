/** Bound downloads/decodes per source and cancel sibling work on first failure. */
export async function mapTiles<T, R>(items: readonly T[], load: (item: T, signal: AbortSignal) => Promise<R>, signal?: AbortSignal, concurrency = 6): Promise<R[]> {
  const controller = new AbortController();
  const operation = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const results = new Array<R>(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      operation.throwIfAborted();
      const index = next++;
      try {
        results[index] = await load(items[index]!, operation);
        operation.throwIfAborted();
      } catch (error) {
        controller.abort(error);
        throw error;
      }
    }
  }
  operation.throwIfAborted();
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}
