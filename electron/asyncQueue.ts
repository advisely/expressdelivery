export class QueueDrainedError extends Error {
    constructor(accountId: string) {
        super(`Operation queue drained for account ${accountId}`);
        this.name = 'QueueDrainedError';
    }
}

type QueuedTask<T> = {
    run: () => Promise<T>;
    resolve: (value: T) => void;
    reject: (reason: unknown) => void;
};

export class AsyncQueue {
    private readonly accountId: string;
    private readonly queue: QueuedTask<unknown>[] = [];
    private running = false;
    private drained = false;

    constructor(accountId = 'unknown') {
        this.accountId = accountId;
    }

    enqueue<T>(task: () => Promise<T>): Promise<T> {
        if (this.drained) {
            const rejected = Promise.reject(new QueueDrainedError(this.accountId));
            // Attach a no-op handler to suppress unhandled-rejection warnings
            // for callers that attach their .catch/await on a later tick.
            rejected.catch(() => { /* intentionally empty */ });
            return rejected;
        }
        const promise = new Promise<T>((resolve, reject) => {
            this.queue.push({
                run: task as () => Promise<unknown>,
                resolve: resolve as (v: unknown) => void,
                reject,
            });
            if (!this.running) {
                void this.dispatch();
            }
        });
        // Suppress unhandled-rejection warnings for drained tasks whose
        // rejection handlers may be attached after a later await point.
        promise.catch(() => { /* intentionally empty */ });
        return promise;
    }

    drain(): void {
        this.drained = true;
        const pending = this.queue.splice(0, this.queue.length);
        for (const task of pending) {
            task.reject(new QueueDrainedError(this.accountId));
        }
    }

    get size(): number {
        return this.queue.length;
    }

    private async dispatch(): Promise<void> {
        this.running = true;
        try {
            while (this.queue.length > 0) {
                const task = this.queue.shift()!;
                try {
                    const result = await task.run();
                    task.resolve(result);
                } catch (err) {
                    task.reject(err);
                }
            }
        } finally {
            this.running = false;
        }
    }
}
