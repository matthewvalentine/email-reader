import {readFileSync} from 'fs';
import {google} from 'googleapis';

// I can't for the life of me import these types directly from googleapis, even though they appear exported.
const dummyOauthConstructor = () => new google.auth.OAuth2();
export type OauthClient = ReturnType<typeof dummyOauthConstructor>;
export type Credentials = Parameters<OauthClient['setCredentials']>[0];

interface OauthSecret {
    web: {
        'client_id': string;
        'client_secret': string;
        'redirect_uris': string[];
    }
}

export class OauthProvider {
    private readonly secret: OauthSecret;
    private readonly callbackUrl: string;

    constructor(secretPath: string, callbackUrl: string) {
        this.secret = JSON.parse(readFileSync(secretPath, 'utf8'));
        this.callbackUrl = callbackUrl;
        if (!this.secret.web.redirect_uris.includes(callbackUrl)) {
            throw new Error(
                `Callback url ${callbackUrl} is not registered (registered: ${this.secret.web.redirect_uris})`
            );
        }
    }

    newClient(credentials?: Credentials): OauthClient {
        const client = new google.auth.OAuth2(
            this.secret.web.client_id,
            this.secret.web.client_secret,
            this.callbackUrl,
        );
        if (credentials) {
            client.setCredentials(credentials);
        }
        return client;
    }
}
