import type {Database} from 'better-sqlite3';
import createDatabase from 'better-sqlite3';
import * as fs from 'fs';

export function createNewDatabase(path: string): Database {
    for (const dbfile of [path, path+'-shm', path+'-wal']) {
        if (fs.existsSync(dbfile)) {
            // TODO: Actually persist data between runs,
            // but I don't want that right now.
            fs.unlinkSync(dbfile);
        }
    }

    const db = createDatabase(path);
    // I'm not actually using the DB concurrently in any way right now,
    // but this seems like best practice.
    db.pragma(`journal_mode = WAL`);
    return db;
}
