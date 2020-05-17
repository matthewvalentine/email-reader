import * as express from 'express';
import session from "express-session";
import {google} from "googleapis";
import * as path from 'path';
import {performance} from 'perf_hooks';
import {OauthProvider} from "./oauth";

const oauth = new OauthProvider(
    './secret/oauth_secret.json',
    'http://localhost:8080/auth/google/callback',
);

const app = express();
app.use(session({
    secret: 'adults can eat Trix too',
    cookie: {httpOnly: true},
    // TODO: There are warnings about some parameters for which being optional has been deprecated.
}));

// Simple endpoint that returns the current time
app.get('/api/time', (req, res) => {
    res.send(new Date().toISOString());
});

app.post('/api/email_count', async (req, res, next) => {
    try {
        let closed = false;
        req.on('close', () => { closed = true; });

        const start = performance.now();
        const gmail = google.gmail({version: 'v1', auth: oauth.newClient(req.session?.credentials)});

        let messageCount = 0;
        let pageCount = 0;
        let nextPage: string | undefined;
        while (true) {
            if (closed) {
                throw new Error('Request canceled');
            }
            
            const response = await gmail.users.messages.list({
                userId: 'me',
                includeSpamTrash: true,
                pageToken: nextPage,
            });

            pageCount++;
            messageCount += response.data.messages?.length ?? 0;
            console.log(pageCount, messageCount, (performance.now() - start)/1000);
            nextPage = response.data.nextPageToken ?? undefined;
            if (!nextPage) {
                break;
            }
        }
        const stop = performance.now();
        console.log(`Listed ${messageCount} message IDs in ${pageCount} pages and ${(stop - start)/1000} seconds.`);
        res.json({messageCount});
    } catch (err) {
        next(err);
    }
});

app.get('/auth/google/callback', async (req, res, next) => {
    try {
        const authCode = req.query.code as string;
        const response = await oauth.newClient().getToken(authCode);

        // TODO: Store in database instead of in session
        const session = req.session!;
        session.credentials = response.tokens;
        // TODO: Is this necessary? Seems not to set the cookie if I don't.
        session.save((err) => {
            if (err) console.error(err);
            res.redirect('/');
        });
    } catch(err) {
        next(err);
    }
});

// Redirect to sign in if necessary
app.get('/', (req, res, next) => {
    if (req.session?.credentials) {
        // Already signed in.
        next(null);
        return;
    }

    const authorizeUrl = oauth.newClient().generateAuthUrl({
        access_type: 'offline',
        scope: ['profile', 'https://www.googleapis.com/auth/gmail.readonly'],
    });
    res.redirect(authorizeUrl);
});

// Serve static files
app.use('/', express.static(path.join(__dirname, '/www')));

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
