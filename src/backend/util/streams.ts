import {Context} from './context';

// I'm envisioning that I would actually be using some kind of distributed job queue,
// where each piece of the pipeline is potentially running on a different machine,
// and so can be scaled separately.  This is kind of an attempt at an easy abstraction
// that isn't *completely* divorced from that eventuality. But it certainly wouldn't be
// a drop-in replacement, in particular it doesn't have any committing and such.
// For now just leaving it simple.

export type JobID = string;

export interface Job<T> {
    id: JobID;
    message: T;
    deadline?: number;
}

// TODO: Batch
export interface WriteStream<T> {
    publish: (ctx: Context, message: T) => Promise<void>;
}

export interface ReadStream<T> {
    take: (ctx: Context) => Promise<Job<T>>;
    commit: (ctx: Context, job: JobID, success: boolean) => Promise<void>;
}

export interface ReadWriteStream<T> extends ReadStream<T>, WriteStream<T> {}

export interface ConsumeOptions {
    // Total number of outstanding jobs allowed at once. Defaults to one.
    // Vaguely a proxy for scaling the number of consumers of the queue.
    workers?: number;
}

export type ConsumeOptionsWithInitialization<W> = ConsumeOptions & {
    initializeWorker: () => Promise<InitializedWorker<W>>;
}

export interface InitializedWorker<W> {
    worker: W;
    cleanup?: () => Promise<void> | void;
}

export function consume<T>(
    ctx: Context,
    input: ReadStream<T>,
    process: (ctx: Context, message: T) => Promise<void>,
    options?: ConsumeOptions,
): void;

export function consume<T, W>(
    ctx: Context,
    input: ReadStream<T>,
    process: (ctx: Context, message: T, worker: W) => Promise<void>,
    options: ConsumeOptionsWithInitialization<W>,
): void;

// Pull and process values from an input stream.
// TODO: Batching.
export function consume<T, W>(
    ctx: Context,
    input: ReadStream<T>,
    process: (ctx: Context, message: T, worker?: W) => Promise<void>,
    options: Partial<ConsumeOptionsWithInitialization<W>> = {},
) {
    for (let i = 0; i < (options.workers ?? 1); i++) {
        // TODO: Well... This would mean creating or cleaning up the worker failed,
        // and we would need to communicate that to somebody.
        // Most likely consume should return a Promise<void> or similar.
        // It would just be a Promise.all(...) of the workers.
        runWorker().catch(err => { console.log(err); });
    }

    async function runWorker() {
        const {worker, cleanup} = await options.initializeWorker?.() ?? {};
        try {
            while (!ctx.isDone) {
                let job: Job<T>;
                try {
                    // TODO: Some wrapper for ReadStream that retries
                    // and/or backs off of take and commit.
                    job = await input.take(ctx);
                } catch (err) {
                    // TODO: As of right now, this is almost always cancellation.
                    // Not quite sure how I want to deal with that in JS.
                    // A small amount of logspam is OK with me for now.
                    console.error(err);
                    continue;
                }

                let success: boolean;
                try {
                    await process(
                        ctx.withOptionalDeadline(job.deadline),
                        job.message,
                        worker,
                    );
                    success = true;
                } catch (err) {
                    console.error(err);
                    success = false;
                }

                try {
                    await input.commit(ctx, job.id, success);
                } catch(err) {
                    console.error(err);
                }
            }
        } finally {
            await cleanup?.();
        }
    }
}
