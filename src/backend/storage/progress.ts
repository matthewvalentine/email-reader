import type {Database, Statement} from 'better-sqlite3';
import {Context} from '../util/context';

export interface UserProgress {
    estimatedEmails: number | null;
    ingestedEmails: number;
    completedEmails: number;
}

export class ProgressStore {
    private static table = 'progress';

    private $getTotal: Statement;
    private $getPending: Statement;
    private $ingest: Statement;
    private $set: Statement;

    constructor(private db: Database) {
        db.prepare(`
            CREATE TABLE ${ProgressStore.table} (
                user_id TEXT,
                email_id TEXT,
                ingested BOOLEAN,
                completed BOOLEAN,
                pending_tasks TEXT,
                PRIMARY KEY (user_id, email_id)
            );
        `).run();

        // TODO: Incremental aggregation

        this.$getTotal = db.prepare(`
            SELECT SUM(IFNULL(ingested, 0)) AS total_ingested, SUM(IFNULL(completed, 0)) AS total_completed
            FROM ${ProgressStore.table}
            WHERE user_id = :userId;
        `);

        this.$getPending = db.prepare(`
            SELECT pending_tasks
            FROM ${ProgressStore.table}
            WHERE user_id = :userId AND email_id = :emailId
        `);

        this.$ingest = db.prepare(`
            INSERT INTO ${ProgressStore.table}
            VALUES (
                :userId, 
                :emailId,
                1,
                0,
                null
            )
            
            ON CONFLICT (user_id, email_id)
            DO UPDATE
            SET ingested = 1;
        `);

        this.$set = db.prepare(`
            INSERT OR REPLACE INTO ${ProgressStore.table}
            VALUES (
                :userId,
                :emailId,
                1,
                :completed,
                :pendingTasks
            );
        `);
    }

    async getUserProgress(ctx: Context, userId: string): Promise<UserProgress> {
        const progress = this.$getTotal.get({userId});
        return {
            estimatedEmails: progress?.estimated_emails ?? null,
            ingestedEmails: progress?.total_ingested ?? 0,
            completedEmails: progress?.total_completed ?? 0,
        };
    }

    async markEmailIngested(ctx: Context, userId: string, emailId: string) {
        this.$ingest.run({userId, emailId});
    }

    async setPendingTasks(ctx: Context, userId: string, emailId: string, pendingTasks: string[]) {
        this.updatePendingTasks(userId, emailId, (currentPending) => {
            const newPending: {[id: string]: boolean} = {};
            for (const id of pendingTasks) {
                newPending[id] = currentPending[id] ?? false;
            }
            return newPending;
        });
    }

    async markTaskCompleted(ctx: Context, userId: string, emailId: string, taskId: string) {
        this.updatePendingTasks(userId, emailId, (currentPending) => {
            if (currentPending.hasOwnProperty(taskId)) {
                currentPending[taskId] = true;
            }
            return currentPending;
        });
    }

    private updatePendingTasks(
        userId: string,
        emailId: string,
        fn: (pending: {[id: string]: boolean}) => {[id: string]: boolean},
    ) {
        this.db.transaction(() => {
            const pendingText = this.$getPending.get({userId, emailId})?.pending_tasks;
            const currentPending = pendingText ? JSON.parse(pendingText) : {};
            const newPending = fn(currentPending);
            let completed = true;
            for (const done of Object.values(newPending)) {
                completed = completed && done;
            }
            this.$set.run({
                userId,
                emailId,
                completed: completed ? 1 : 0,
                pendingTasks: JSON.stringify(newPending),
            });
        })();
    }
}
