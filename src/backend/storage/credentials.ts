import {Database, Statement} from 'better-sqlite3';
import {Context} from '../util/context';
import {Credentials} from '../oauth';

export class CredentialStore {
    private static table = 'credentials';

    private $get: Statement;
    private $set: Statement;

    constructor(db: Database) {
        db.prepare(`
            CREATE TABLE ${CredentialStore.table} (
                user_id TEXT PRIMARY KEY,
                credentials TEXT
            );
        `).run()

        this.$get = db.prepare(`
            SELECT credentials
            FROM ${CredentialStore.table}
            WHERE user_id = :userId;
        `);

        this.$set = db.prepare(`
            INSERT OR REPLACE INTO ${CredentialStore.table} (user_id, credentials)
            VALUES (:userId, :credentials);
        `);
    }

    async get(ctx: Context, userId: string): Promise<Credentials | null> {
        const user = this.$get.get({userId});
        if (user === undefined || !user.credentials) {
            return null;
        }
        return JSON.parse(user.credentials);
    }

    async set(ctx: Context, userId: string, credentials: Credentials) {
        this.$set.run({userId, credentials: JSON.stringify(credentials)});
    }
}
