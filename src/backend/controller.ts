import deepEqual from 'deep-equal';
import {Event} from '../schema/schema';
import {Context} from './util/context';
import {Deps} from './dependencies';
import {Credentials} from './oauth';
import {Pipeline} from './pipeline';
import {ProgressStore, UserProgress} from './storage/progress';
import {WarningStore} from './storage/warnings';
import {mergeAsync, Poller} from './util/async_iterator';

export class Controller {
    constructor(private deps: Deps, private pipeline: Pipeline) {}

    subscribeToUserInfo(ctx: Context, userId: string): AsyncIterableIterator<Event> {
        const progress = new ProgressTracker(ctx, userId, this.deps.progress);
        const warnings = new WarningTracker(ctx, userId, this.deps.warnings);
        return mergeAsync(progress, warnings);
    }

    async hasCredentials(ctx: Context, userId: string): Promise<boolean> {
        const credentials = await this.deps.credentials.get(ctx, userId);
        return credentials !== null;
    }

    async setCredentialsForUser(ctx: Context, userId: string, credentials: Credentials): Promise<void> {
        return this.deps.credentials.set(ctx, userId, credentials);
    }

    async ingestEmailsForUser(ctx: Context, userId: string): Promise<void> {
        return this.pipeline.refreshUser(ctx, userId);
    }
}

class WarningTracker implements AsyncIterableIterator<Event> {
    private pings: AsyncIterator<unknown>;

    private warningCursor = 0;
    private hasMoreWarnings = true;

    constructor(private ctx: Context, private userId: string, private warnings: WarningStore) {
        this.pings = new Poller(500);
    }

    async next(): Promise<IteratorResult<Event>> {
        while (true) {
            if (!this.hasMoreWarnings) {
                await this.pings.next();
            }
            if (this.ctx.isDone) {
                return {done: true, value: null};
            }

            // TODO: Retries
            const {warnings, cursor, hasMore} = await this.warnings.list(this.ctx, this.userId, this.warningCursor);
            this.hasMoreWarnings = hasMore;
            this.warningCursor = cursor;
            if (warnings.length === 0) {
                continue;
            }

            return {value: {warnings}};
        }
    }

    [Symbol.asyncIterator](): AsyncIterableIterator<Event> {
        return this;
    }
}

class ProgressTracker implements AsyncIterableIterator<Event> {
    private pings: AsyncIterator<unknown>;
    private previous: UserProgress | undefined;

    constructor(private ctx: Context, private userId: string, private progress: ProgressStore) {
        this.pings = new Poller(200);
    }

    async next(): Promise<IteratorResult<Event>> {
        while (true) {
            await this.pings.next();
            if (this.ctx.isDone) {
                return {done: true, value: null}
            }

            // TODO: Retries
            const progress = await this.progress.getUserProgress(this.ctx, this.userId);
            if (deepEqual(progress, this.previous)) {
                continue;
            }

            this.previous = progress;
            return {value: {progress}};
        }
    }

    [Symbol.asyncIterator](): AsyncIterableIterator<Event> {
        return this;
    }
}
