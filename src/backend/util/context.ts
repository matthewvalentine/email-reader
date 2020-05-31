import {AbortController, AbortSignal} from 'abort-controller';
import type {Request} from 'express';
import {performance} from 'perf_hooks';

// Is this literally me copying Golang? Yes. Yes it is.
// Honestly AbortController seems meh, but at least it works with Fetch.

export class Context {
    public readonly donePromise: Promise<string>;

    private readonly controller = new AbortController();
    private message = '';
    private unsubscribeFromParent: (() => void) | null = null;

    static forRequest(req: Request, serverCtx = new Context()): Context {
        const [ctx, cancel] = serverCtx.withCancel();
        req.on('close', cancel);
        return ctx;
    }

    constructor() {
        this.donePromise = new Promise(resolve => this.onDone(resolve));
    }

    withCancel(): [Context, () => void] {
        const ctx = new Context();
        ctx.unsubscribeFromParent = this.onDone((message) => ctx.abort(message));
        return [ctx, () => ctx.abort('Context cancelled')];
    }

    withDeadline(deadline: number): Context {
        const ctx = new Context();
        const id = setTimeout(() => ctx.abort('Context timed out'), deadline - performance.now());
        ctx.unsubscribeFromParent = this.onDone((message) => {
            ctx.abort(message);
            clearTimeout(id);
        });
        return ctx;
    }

    withOptionalDeadline(deadline?: number): Context {
        return deadline === undefined ? this : this.withDeadline(deadline);
    }

    get isDone(): boolean {
        return this.controller.signal.aborted;
    }

    get doneSignal(): AbortSignal {
        return this.controller.signal;
    }

    // I do wish TS had public(get) private(set) like Swift.
    get doneMessage(): string {
        return this.message;
    }

    // TODO: I'm not really certain of the JavaScript conventions
    // on specially handling specific kinds of errors, but this
    // would be one that you'd often want to not report as a big problem.
    doneError(): Error {
        return new Error(this.isDone ? this.message : 'Asked for Context.doneError before Context was done');
    }

    onDone(handler: (message: string) => void): (() => void) | null {
        if (this.controller.signal.aborted) {
            handler(this.message);
            return null;
        } else {
            const wrappedHandler = () => {
                handler(this.message);
                unsubscribe();
            };

            const unsubscribe = () => {
                // The Node polyfill, at the very least, has this lovely memory leak lurking in the shadows.
                this.controller.signal.removeEventListener('abort', wrappedHandler);
            };

            this.controller.signal.addEventListener('abort', wrappedHandler);
            return unsubscribe;
        }
    }

    private abort(message: string) {
        if (!this.controller.signal.aborted) {
            this.message = message;
            this.controller.abort();
            this.unsubscribeFromParent?.();
            this.unsubscribeFromParent = null;
        }
    }
}
