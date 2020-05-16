import * as express from 'express';
import * as path from 'path';
import {OauthProvider} from "./oauth";
import session from "express-session";

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
