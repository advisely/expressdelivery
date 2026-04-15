import { describe, it, expect, vi } from 'vitest';
import { AsyncQueue, QueueDrainedError } from './asyncQueue.js';

describe('AsyncQueue', () => {
    it('resolves tasks in FIFO order', async () => {
        const queue = new AsyncQueue();
        const log: number[] = [];

        const p1 = queue.enqueue(async () => { await Promise.resolve(); log.push(1); return 1; });
        const p2 = queue.enqueue(async () => { await Promise.resolve(); log.push(2); return 2; });
        const p3 = queue.enqueue(async () => { await Promise.resolve(); log.push(3); return 3; });

        const results = await Promise.all([p1, p2, p3]);
        expect(results).toEqual([1, 2, 3]);
        expect(log).toEqual([1, 2, 3]);
    });

    it('allows other tasks to continue after one task rejects', async () => {
        const queue = new AsyncQueue();
        const task1 = queue.enqueue(async () => 'a');
        const task2 = queue.enqueue(async () => { throw new Error('boom'); });
        const task3 = queue.enqueue(async () => 'c');

        await expect(task1).resolves.toBe('a');
        await expect(task2).rejects.toThrow('boom');
        await expect(task3).resolves.toBe('c');
    });

    it('serializes overlapping execution (no two tasks run concurrently)', async () => {
        const queue = new AsyncQueue();
        let concurrent = 0;
        let maxConcurrent = 0;

        const makeTask = () => queue.enqueue(async () => {
            concurrent++;
            if (concurrent > maxConcurrent) maxConcurrent = concurrent;
            await new Promise(resolve => setTimeout(resolve, 5));
            concurrent--;
        });

        await Promise.all([makeTask(), makeTask(), makeTask(), makeTask()]);
        expect(maxConcurrent).toBe(1);
    });

    it('executes a single task on the next microtask when queue is empty', async () => {
        const queue = new AsyncQueue();
        const spy = vi.fn(async () => 'done');
        const result = await queue.enqueue(spy);
        expect(result).toBe('done');
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('drain() rejects all pending tasks with QueueDrainedError', async () => {
        const queue = new AsyncQueue();
        const blockingTask = queue.enqueue(async () => {
            await new Promise(resolve => setTimeout(resolve, 50));
            return 'first';
        });
        const pending1 = queue.enqueue(async () => 'second');
        const pending2 = queue.enqueue(async () => 'third');

        queue.drain();

        await expect(blockingTask).resolves.toBe('first');
        await expect(pending1).rejects.toBeInstanceOf(QueueDrainedError);
        await expect(pending2).rejects.toBeInstanceOf(QueueDrainedError);
    });

    it('QueueDrainedError has a clear message', () => {
        const err = new QueueDrainedError('test-account');
        expect(err.message).toContain('test-account');
        expect(err.name).toBe('QueueDrainedError');
    });

    it('handles enqueue called from within a running task', async () => {
        const queue = new AsyncQueue();
        const log: string[] = [];

        let nestedPromise: Promise<string> | undefined;
        const outer = queue.enqueue(async () => {
            log.push('outer-start');
            nestedPromise = queue.enqueue(async () => {
                log.push('nested');
                return 'nested-result';
            });
            log.push('outer-end');
            return 'outer-result';
        });

        const outerResult = await outer;
        const nestedResult = await nestedPromise;

        expect(outerResult).toBe('outer-result');
        expect(nestedResult).toBe('nested-result');
        // Serial guarantee: outer must fully complete before nested runs.
        expect(log).toEqual(['outer-start', 'outer-end', 'nested']);
    });

    it('rejects tasks enqueued after drain() with QueueDrainedError', async () => {
        const queue = new AsyncQueue('acct-X');
        queue.drain();

        const taskFn = vi.fn(async () => 'should-not-run');
        const rejected = queue.enqueue(taskFn);

        await expect(rejected).rejects.toBeInstanceOf(QueueDrainedError);
        await expect(rejected).rejects.toThrow('acct-X');
        expect(taskFn).not.toHaveBeenCalled();
    });

    it('drain() is idempotent on empty queue and when called twice', () => {
        const queue = new AsyncQueue('acct-Y');
        expect(() => queue.drain()).not.toThrow();
        expect(() => queue.drain()).not.toThrow();
        expect(queue.size).toBe(0);
    });
});
