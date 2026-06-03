/**
 * AsyncQueue — bridges push-style producers (child-process stdout callbacks)
 * to pull-style consumers (`for await ... of`).
 *
 * The producer calls push()/close()/fail(); the consumer iterates. Values are
 * buffered if the consumer is slow; the consumer awaits if the buffer is empty.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private values: T[] = []
  private resolvers: Array<(r: IteratorResult<T>) => void> = []
  private rejecters: Array<(e: unknown) => void> = []
  private closed = false
  private error: unknown = null

  push(value: T): void {
    if (this.closed) return
    const resolve = this.resolvers.shift()
    if (resolve) {
      this.rejecters.shift()
      resolve({ value, done: false })
    } else {
      this.values.push(value)
    }
  }

  /** Signal normal completion. Buffered values are still drained first. */
  close(): void {
    if (this.closed) return
    this.closed = true
    // Wake all pending consumers with done.
    while (this.resolvers.length) {
      this.rejecters.shift()
      this.resolvers.shift()!({ value: undefined as never, done: true })
    }
  }

  /** Signal failure. The next (or pending) consumer sees the thrown error. */
  fail(err: unknown): void {
    if (this.closed) return
    this.error = err
    this.closed = true
    while (this.rejecters.length) {
      this.resolvers.shift()
      this.rejecters.shift()!(err)
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      if (this.values.length > 0) {
        yield this.values.shift()!
        continue
      }
      if (this.closed) {
        if (this.error) throw this.error
        return
      }
      const result = await new Promise<IteratorResult<T>>((resolve, reject) => {
        this.resolvers.push(resolve)
        this.rejecters.push(reject)
      })
      if (result.done) {
        if (this.error) throw this.error
        return
      }
      yield result.value
    }
  }
}
