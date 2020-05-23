import {EventEmitter} from 'events';
import {AbortSignal} from "node-fetch/externals";

// I'm envisioning that I would actually be using some kind of distributed job queue,
// where each piece of the pipeline is potentially running on a different machine,
// and so can be scaled separately.  This is kind of an attempt at an easy abstraction
// that isn't *completely* divorced from that eventuality. But it certainly wouldn't be
// a drop-in replacement, in particular it doesn't have any committing and such.
// For now just leaving it simple.

export interface WriteStream<T> {
    publish: (message: T) => void;
}

export interface ReadStream<T> {
    take: () => Promise<T>;
}

export interface ConsumeOptions {
    // Total number of outstanding jobs allowed at once. Defaults to one.
    // Vaguely a proxy for scaling the number of consumers of the queue.
    workers?: number;

    // Stop consuming when the AbortSignal fires.
    cancel?: AbortSignal;
}

export type ConsumeOptionsWithInitialization<W> = ConsumeOptions & {
    initializeWorker: () => Promise<InitializedWorker<W>>;
}

export interface InitializedWorker<W> {
    worker: W;
    cleanup?: () => Promise<void> | void;
}

export function consume<T>(
    input: ReadStream<T>,
    process: (message: T) => Promise<void>,
    options?: ConsumeOptions,
): void;

export function consume<T, W>(
    input: ReadStream<T>,
    process: (message: T, worker: W) => Promise<void>,
    options: ConsumeOptionsWithInitialization<W>,
): void;

// Pull and process values from an input stream.
// TODO: Retry, backoff, dead-letter.
// TODO: Batching.
export function consume<T, W>(
    input: ReadStream<T>,
    process: (message: T, worker?: W) => Promise<void>,
    options: Partial<ConsumeOptionsWithInitialization<W>> = {},
) {
    const state = new Monitored({active: 0});
    for (let i = 0; i < (options.workers ?? 1); i++) {
        runWorker();
    }

    async function runWorker() {
        const {worker, cleanup} = await options.initializeWorker?.() ?? {};
        try {
            while (!options.cancel?.aborted) {
                await process(await input.take(), worker);
            }
        } finally {
            await cleanup?.();
        }
    }
}

export class MemoryQueue<T> implements ReadStream<T>, WriteStream<T> {
    private state = new Monitored<T[]>([]);

    publish(message: T): void {
        this.state.do(queue => queue.push(message));
    }

    take(): Promise<T> {
        return this.state.once(
            queue => queue.length > 0,
            queue => queue.shift()!,
        );
    }
}

// Wraps a value and possibly calls attached handlers whenever the value changes.
// Really, this is just to isolate any difficult logic of MemoryQueue (and maybe other things)
// into a testable abstraction. It could be more efficient.
class Monitored<T> {
    private events = new EventEmitter();
    constructor(private readonly value: T) {
        // This doesn't have any functional impact, it just prints a warning when exceeded.
        this.events.setMaxListeners(100);
    }

    // Read and potentially change the wrapped value, triggering listeners.
    do<V>(op: (value: T) => V): V {
        const result = op(this.value);
        this.events.emit('change');
        return result;
    }

    // Wait until the given predicate is true for the very first time,
    // and then execute the operation on it. Returns a promise of the
    // value that comes out of the operation (once it finally executes.)
    once<V>(predicate: (value: T) => boolean, op: (value: T) => V): Promise<V> {
        let resolve!: (value: V) => void;
        const deferred = new Promise<V>(rslv => { resolve = rslv; });

        // Like Promise.then, we don't want to execute the operation immediately,
        // but rather wait until the next microtask. That reduces the number of things
        // users of .do() have to keep in mind.
        let scheduled = false;
        const listener = () => {
            if (scheduled) {
                return;
            }

            scheduled = true;
            Promise.resolve().then(() => {
                if (!predicate(this.value)) {
                    scheduled = false;
                    return;
                }

                this.events.removeListener('change', listener);
                resolve(this.do(op));
            });
        };

        // Listen for changes, and check the current value.
        this.events.addListener('change', listener);
        listener();

        return deferred;
    }
}


