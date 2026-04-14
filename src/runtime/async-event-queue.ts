export class AsyncEventQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) {
      return;
    }

    if (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter?.({ value: item, done: false });
      return;
    }

    this.items.push(item);
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;

    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter?.({ value: undefined as T, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.items.length > 0) {
          return Promise.resolve({
            value: this.items.shift() as T,
            done: false,
          });
        }

        if (this.closed) {
          return Promise.resolve({
            value: undefined as T,
            done: true,
          });
        }

        return new Promise<IteratorResult<T>>((resolve) => {
          this.waiters.push(resolve);
        });
      },
    };
  }
}
