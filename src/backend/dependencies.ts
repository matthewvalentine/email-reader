import {Database} from 'better-sqlite3';
import {gmail_v1, google} from 'googleapis';
import {OauthProvider} from './oauth';
import {CredentialStore} from './storage/credentials';
import {createNewDatabase} from './storage/database';
import {IngestionStore} from './storage/ingestion';
import {ProgressStore} from './storage/progress';
import {WarningStore} from './storage/warnings';

export class Deps {
    readonly db: Database;
    readonly oauth: OauthProvider;
    readonly gmail: gmail_v1.Gmail;

    readonly credentials: CredentialStore;
    readonly ingestion: IngestionStore;
    readonly progress: ProgressStore;
    readonly warnings: WarningStore;

    constructor(params: {
        databasePath: string,
        oauthSecretPath: string,
        oauthCallbackUrl: string,
    }) {
        this.db = createNewDatabase(params.databasePath);
        this.oauth = new OauthProvider(params.oauthSecretPath, params.oauthCallbackUrl);
        this.gmail = google.gmail({version: 'v1'});

        this.credentials = new CredentialStore(this.db);
        this.ingestion = new IngestionStore(this.db);
        this.progress = new ProgressStore(this.db);
        this.warnings = new WarningStore(this.db);
    }
}
