import {readFileSync} from 'fs';
import {google} from 'googleapis';

// TODO: Figure out how to import this type from googleapis.
export type Credentials = any;

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

    newClient(credentials?: Credentials) {
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
