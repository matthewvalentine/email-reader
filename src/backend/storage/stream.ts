import type {Database, Statement} from 'better-sqlite3';
import type {Context} from '../util/context';
import type {ReadStream, WriteStream, Job, JobID} from '../util/streams';
import {performance} from 'perf_hooks';
import {EventEmitter} from 'events';

export class SQLiteStream<T> implements ReadStream<T>, WriteStream<T> {
    private table: string;
    private db: Database;
    private processingTimeout: number;

    private events = new EventEmitter();

    private $publish: Statement;
    private $peek: Statement;
    private $take: Statement;
    private $fail: Statement;
    private $succeed: Statement;

    constructor(db: Database, topic: string, processingTimeoutMs = 10000) {
        this.table = `stream_${topic}`;
        this.db = db;
        this.processingTimeout = processingTimeoutMs;

        db.prepare(`
            CREATE TABLE ${this.table} (
                event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                payload TEXT,
                attempts INTEGER,
                visible_after INTEGER
            );
        `).run();
        db.prepare(`
            CREATE INDEX ${this.table}_visible
            ON ${this.table} (visible_after);
        `).run();

        this.$publish = db.prepare(`
            INSERT INTO ${this.table} (payload, attempts, visible_after)
            VALUES (:payload, 0, 0);
        `);

        this.$peek = db.prepare(`
            SELECT event_id, payload, attempts, visible_after
            FROM ${this.table}
            ORDER BY visible_after ASC
            LIMIT 1
        `);

        this.$take = db.prepare(`
            UPDATE ${this.table}
            SET
                attempts = :currentAttempt,
                visible_after = :deadline
            WHERE event_id = :eventId;
        `);

        this.$fail = db.prepare(`
            UPDATE ${this.table}
            SET visible_after = :nextAttemptTime
            WHERE
                event_id = :eventId
                AND attempts = :currentAttempt;
        `);

        this.$succeed = db.prepare(`
            DELETE FROM ${this.table}
            WHERE event_id = :eventId;
        `);
    }

    async publish(ctx: Context, message: T): Promise<void> {
        const payload = JSON.stringify(message);
        this.$publish.run({payload});
        setTimeout(() => this.events.emit('publish'), 0);
    }

    async take(ctx: Context): Promise<Job<T>> {
        type Row = {
            event_id: number;
            payload: string;
            attempts: number;
            visible_after: number;
        };

        type Result =
            | {type: 'wait', deadline?: number}
            | {type: 'result', row: Row, currentAttempt: number, deadline: number};

        const tryTake: () => Result = this.db.transaction((): Result => {
            const nextItem: Row = this.$peek.get();
            if (nextItem === undefined) {
                // gotta wait for a new item
                return {type: 'wait'};
            }

            const now = performance.now();
            if (nextItem.visible_after >= now) {
                return {type: 'wait', deadline: nextItem.visible_after};
            }

            const currentAttempt = nextItem.attempts + 1;
            const deadline = now + this.processingTimeout - 100;
            this.$take.run({
                eventId: nextItem.event_id,
                deadline,
                currentAttempt,
            });

            return {
                type: 'result',
                row: nextItem,
                currentAttempt,
                deadline,
            };
        });

        while (true) {
            if (ctx.isDone) {
                throw ctx.doneError();
            }

            const result = tryTake();
            switch (result.type) {
                case 'result':
                    const message = JSON.parse(result.row.payload);
                    return {
                        id: JSON.stringify({eventId: result.row.event_id, currentAttempt: result.currentAttempt}),
                        message,
                        deadline: result.deadline,
                    };

                case 'wait':
                    await this.waitForJob(ctx, result.deadline);
                    break;

                default:
                    const _: never = result;
                    throw new Error(`Unexpected result ${JSON.stringify(result)}`);
            }
        }
    }

    async commit(ctx: Context, jobID: JobID, success: boolean): Promise<void> {
        const {eventId, currentAttempt} = JSON.parse(jobID);
        if (success) {
            this.$succeed.run({eventId});
        } else {
            // TODO: Actual delay
            const nextAttemptTime = performance.now() + 1000;
            this.$fail.run({eventId, currentAttempt, nextAttemptTime});
        }
    }

    private async waitForJob(ctx: Context, deadline?: number): Promise<void> {
        let setAnyDone!: () => void;
        const anyDone = new Promise<void>((resolve) => { setAnyDone = resolve; });

        const clearCtx = ctx.onDone(setAnyDone);
        this.events.once('publish', setAnyDone);
        // setTimeout works fine with a negative timeout, just completes on the next tick.
        const timeoutId = deadline !== undefined ? setTimeout(setAnyDone, deadline - performance.now()) : null;

        await anyDone;

        clearCtx?.();
        this.events.removeListener('publish', setAnyDone);
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
        }
    }
}
