import {Database, Statement} from 'better-sqlite3';
import {Context} from '../util/context';

export interface IngestionState {
    latestHistoryId?: bigint;
    syncedHistoryId?: bigint;
}

export class IngestionStore {
    private static table = 'ingestion';

    private $get: Statement;
    private $update: Statement;

    constructor(db: Database) {
        db.prepare(`
            CREATE TABLE ${IngestionStore.table} (
                user_id TEXT PRIMARY KEY,
                latest_history_id INTEGER,
                is_syncing BOOLEAN
            );
        `).run();

        this.$get = db.prepare(`
            SELECT latest_history_id, is_syncing
            FROM ${IngestionStore.table}
            WHERE user_id = :userId;
        `).safeIntegers();

        this.$update = db.prepare(`
            INSERT INTO ${IngestionStore.table}
            VAlUES (:userId, :latest, 1)
            
            ON CONFLICT (user_id)
            DO UPDATE
            SET latest_history_id = COALESCE(
                MAX(latest_history_id, EXCLUDED.latest_history_id),
                latest_history_id,
                EXCLUDED.latest_history_id
            );
        `);
    }

    async get(ctx: Context, userId: string): Promise<{historyId: string | undefined, isSyncing: boolean}> {
        const convert = (n: bigint | null | undefined): string | undefined => {
            return n === null || n === undefined ? undefined : `${n}`;
        };
        const result = this.$get.get({userId});
        return {historyId: convert(result?.latest_history_id), isSyncing: !!result?.is_syncing};
    }

    async update(ctx: Context, userId: string, historyId?: string) {
        this.$update.run({userId, latest: historyId ? BigInt(historyId) : null});
    }
}
