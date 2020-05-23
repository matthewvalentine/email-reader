import {gmail_v1} from 'googleapis';
import * as linkify from 'linkifyjs';
import {expose} from 'threads/worker';
import {decode} from 'urlsafe-base64';
import {isProbablyGoogleDriveLink} from './public_links';

// The plugin I'm using to automatically split Workers into their own bundle
// seems to mess up import semantics in some way, so I need this escape hatch.
// TODO: Fix that problem
const {URL} = __non_webpack_require__('url');

export type ParseWorker = (email: gmail_v1.Schema$Message) => Promise<ParseResult>;

export interface ParseResult {
    suspiciousLinks: Link[];
}

export interface Link {
    // Because it's serialized between threads, this can't be a URL object.
    link: string;
    originalText: string;
}

const parse: ParseWorker = async (email) => {
    const seen = new Set<string>();
    const links: Link[] = [];
    for (const body of readEmailPayload(email.payload ?? {})) {
        for (let {value, href} of linkify.find(body)) {
            if (href.startsWith('//')) {
                href = 'http:' + href;
            }
            if (seen.has(href)) {
                continue;
            }
            seen.add(href);

            let url: URL;
            try {
                // Ensure this is a valid URL before passing it to the main process.
                url = new URL(href);
            } catch (err) {
                // TODO: There are a lot of these false positives, mostly the same format.
                // Ignore those for logging.
                // Until then, not logging at all since it's noisy.
                // console.error(value, href, err);
                continue;
            }

            if (isProbablyGoogleDriveLink(url)) {
                links.push({link: href, originalText: value});
            }
        }
    }
    return {suspiciousLinks: links};
}

function* readEmailPayload(payload: gmail_v1.Schema$MessagePart): Iterable<string> {
    if (payload.parts) {
        for (const part of payload.parts) {
            // TODO: This should be iterative, because I can't really trust the input to
            // not be incredibly deep. But in practice it seems not to be, so I'll
            // leave it the simple way here for now.
            yield* readEmailPayload(part);
        }
        return;
    }

    const data = payload.body?.data;
    if (!data) {
        return;
    }

    // TODO: Probably some kind of latent problem here, like text encoding,
    // or just plain corrupted emails. Every email in my personal inbox seems to get parsed correctly.
    // Maybe Google is being super nice and converting/fixing stuff as necessary.
    // Not catching errors here because it should be surfaced as a problem, not skipped.
    yield decode(data).toString('utf8');
}

expose(parse);
