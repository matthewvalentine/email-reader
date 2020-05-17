import * as express from 'express';
import session from "express-session";
import * as path from 'path';
import {processAllEmails} from "./email";
import {OauthProvider} from "./oauth";
import {AbortController} from 'abort-controller';
import {consume} from "./streams";

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

app.get('/api/connect', async (req, res, next) => {
    try {
        const abort = new AbortController();
        req.on('close', () => { abort.abort(); });

        // Designate this as a Server Sent Events stream.
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });

        consume(
            processAllEmails(oauth, req.session!.credentials, abort.signal),
            async (event) => {
                switch (event.type) {
                    case 'found_messages':
                        sendEvent(event);
                        break;
                    case 'processed_messages':
                        sendEvent({
                            type: event.type,
                            wordCount: Array.from(event.wordCount.entries()),
                        });
                        break;
                    default:
                        // Type-assert that all possibilities have been covered.
                        const _: never = event;
                        throw new Error(`Unexpected event ${JSON.stringify(event)}`);
                }
            },
            {cancel: abort.signal},
        );

        function sendEvent(data: object) {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        }
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
