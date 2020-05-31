import * as express from 'express';
import session from 'express-session';
import * as path from 'path';
import {Context} from './util/context';
import {Controller} from './controller';
import {Deps} from './dependencies';
import {OauthProvider} from './oauth';
import {Pipeline} from './pipeline';
import {Event} from '../schema/schema';

const oauth = new OauthProvider(
    './secret/oauth_secret.json',
    'http://localhost:8080/auth/google/callback',
);

const deps = new Deps({
    databasePath: 'secret/database.db',
    oauthSecretPath: 'secret/oauth_secret.json',
    oauthCallbackUrl: 'http://localhost:8080/auth/google/callback',
});

const pipeline = new Pipeline(deps);
const controller = new Controller(deps, pipeline);

pipeline.run(new Context());

const app = express();
app.use(session({
    secret: 'adults can eat Trix too',
    cookie: {httpOnly: true},
    // TODO: There are warnings about some parameters for which being optional has been deprecated.
}));

app.get('/api/connect', handler(async (ctx, req, res) => {
    // Designate this as a Server Sent Events stream.
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    });

    function sendEvent(data: Event) {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    }

    await controller.ingestEmailsForUser(ctx, req.session!.id);

    for await (const event of controller.subscribeToUserInfo(ctx, req.session!.id)) {
        sendEvent(event);
    }
}));

app.get('/auth/google/callback', handler(async (ctx, req, res) => {
    const authCode = req.query.code as string;
    const authResponse = await oauth.newClient().getToken(authCode);

    // TODO: Obviously, userId and sessionId should not be the same thing.
    await controller.setCredentialsForUser(ctx, req.session!.id, authResponse.tokens);
    res.redirect('/');
}));

// Redirect to sign in if necessary
app.get('/', (req, res, next) => {
    (async () => {
        const ctx = Context.forRequest(req);
        if (await controller.hasCredentials(ctx, req.session!.id)) {
            next(null);
            return;
        }

        const authorizeUrl = oauth.newClient().generateAuthUrl({
            access_type: 'offline',
            scope: ['profile', 'https://www.googleapis.com/auth/gmail.readonly'],
        });
        res.redirect(authorizeUrl);
    })();
});

// Serve static files
app.use('/', express.static(path.join(__dirname, '/www')));

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

function handler(
    handlerFn: (ctx: Context, req: express.Request, res: express.Response) => Promise<void>,
): (req: express.Request, res: express.Response, next: express.NextFunction) => void {
    return (req, res, next) => {
        const ctx = Context.forRequest(req);
        handlerFn(ctx, req, res).then(() => next(null), err => next(err));
    }
}
