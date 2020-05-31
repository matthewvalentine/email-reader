import type {Database, Statement} from 'better-sqlite3';
import {Contact, EmailWarning, Warning} from '../../schema/schema';
import {Context} from '../util/context';

export class WarningStore {
    private static table = 'warnings';
    private static pageSize = 20;

    private $list: Statement;
    private $add: Statement;

    constructor(db: Database) {
        // TODO: Subject and sender (and other email-based info) really shouldn't be stored
        // here along with the warnings (which are many per email),
        // but I was lazy and didn't want to set anything up.
        db.prepare(`
            CREATE TABLE ${WarningStore.table} (
                version INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT,
                email_id TEXT,
                task_id TEXT,
                warning TEXT,
                subject TEXT,
                sender TEXT
            );
        `).run();

        db.prepare(`
            CREATE UNIQUE INDEX ${WarningStore.table}_unique_index
            ON ${WarningStore.table} (user_id, email_id, task_id);
        `).run();

        db.prepare(`
            CREATE INDEX ${WarningStore.table}_version_index
            ON ${WarningStore.table} (user_id, version);
        `).run();

        // TODO: Incremental aggregation

        this.$list = db.prepare(`
            SELECT
                version,
                email_id,
                task_id,
                warning,
                subject,
                sender
            FROM ${WarningStore.table}
            WHERE
                user_id = :userId
                AND version > :cursor
            LIMIT ${WarningStore.pageSize};
        `);

        this.$add = db.prepare(`
            INSERT OR REPLACE INTO ${WarningStore.table} (
                user_id,
                email_id,
                task_id,
                warning,
                subject,
                sender
            ) VALUES (
                :userId,
                :emailId,
                :taskId,
                :warning,
                :subject,
                :sender
            );
        `);
    }

    async list(
        ctx: Context,
        userId: string,
        pageCursor: number = -1,
    ): Promise<{warnings: EmailWarning[], cursor: number, hasMore: boolean}> {
        const listedWarnings = this.$list.all({userId, cursor: pageCursor});

        let maxCursor = pageCursor;
        const warnings: EmailWarning[] = [];
        for (const {version, email_id, task_id, warning, subject, sender} of listedWarnings) {
            maxCursor = Math.max(maxCursor, version);
            warnings.push({
                email: {
                    emailId: email_id,
                    subject: subject || undefined,
                    sender: sender ? JSON.parse(sender) : undefined,
                },
                warningId: `${email_id}/${task_id}`,
                version,
                warning: JSON.parse(warning),
            });
        }

        return {
            warnings,
            cursor: maxCursor,
            hasMore: listedWarnings.length >= WarningStore.pageSize,
        };
    }

    async add(
        ctx: Context,
        userId: string,
        emailId: string,
        taskId: string,
        subject: string | undefined,
        sender: Contact | undefined,
        warning: Warning,
    ): Promise<void> {
        this.$add.run({
            userId,
            emailId,
            taskId,
            warning: JSON.stringify(warning),
            subject: subject || null,
            sender: sender ? JSON.stringify(sender) : null,
        });
    }
}
