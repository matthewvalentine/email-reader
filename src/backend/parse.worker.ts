import {ParsedGroup, ParsedMailbox, parseFrom} from 'email-addresses';
import {gmail_v1} from 'googleapis';
import * as linkify from 'linkifyjs';
import {expose} from 'threads/worker';
import {decode} from 'urlsafe-base64';
import {Contact} from '../schema/schema';
import {scanForCodeSnippets, ScanResult} from './ml/classify_code';
import {isProbablyGoogleDriveLink} from './public_links';
import {decode as decodeHTML} from 'he';

// The plugin I'm using to automatically split Workers into their own bundle
// seems to mess up import semantics in some way, so I need this escape hatch.
// TODO: Fix that problem
const {URL} = __non_webpack_require__('url');

export type ParseWorker = (email: gmail_v1.Schema$Message) => Promise<ParseResult>;

export interface ParseResult {
    suspiciousLinks: Link[];
    codeSnippets: string[];
    subject?: string;
    sender?: Contact;
}

export interface Link {
    // Because it's serialized between threads, this can't be a URL object.
    link: string;
    originalText: string;
}

export interface Snippet {
    code: string;
}

const parse: ParseWorker = async (email) => {
    let subject: string | undefined;
    let sender: Contact | undefined;
    for (const header of email.payload?.headers ?? []) {
        if (!header.value) {
            continue;
        }
        try {
            switch (header.name) {
                case 'Subject':
                    subject = header.value;
                    break;
                case 'From':
                    for (const {name, address} of iterateMailboxes(parseFrom(header.value))) {
                        if (address) {
                            sender = {name: name || undefined, address};
                            break;
                        }
                    }
                    break;
            }
        } catch(err) {
            console.error(err);
        }
    }

    const seen = new Set<string>();
    const links: Link[] = [];
    for (const body of readEmailPayload(email.payload)) {
        for (let {value, href} of linkify.find(body)) {
            const url = cleanLinkifyLink(href);
            if (!url) {
                continue;
            }

            const cleanHref = url.href;
            if (seen.has(cleanHref)) {
                continue;
            }
            seen.add(cleanHref);

            if (isProbablyGoogleDriveLink(url)) {
                links.push({link: cleanHref, originalText: value});
            }
        }
    }

    const scanResultPromises: Promise<ScanResult>[] = [];
    for (const body of readEmailPayload(email.payload, {plaintextOnly: true})) {
        scanResultPromises.push(scanForCodeSnippets(body));
    }
    const scanResults = await Promise.all(scanResultPromises);

    let allSnippets: string[] = [];
    for (const {codeSnippets} of scanResults) {
        allSnippets = allSnippets.concat(codeSnippets);
    }

    return {
        suspiciousLinks: links,
        codeSnippets: allSnippets,
        subject,
        sender,
    };
}

function* readEmailPayload(
    payload: gmail_v1.Schema$MessagePart | undefined,
    options: {plaintextOnly?: boolean} = {},
): Iterable<string> {
    if (!payload) {
        return;
    }
    if (payload.parts) {
        for (const part of payload.parts) {
            // TODO: This should be iterative, because I can't really trust the input to
            // not be incredibly deep. But in practice it seems not to be, so I'll
            // leave it the simple way here for now.
            yield* readEmailPayload(part, options);
        }
        return;
    }

    if (options.plaintextOnly) {
        if (!payload.mimeType || payload.mimeType.trim().toLowerCase() !== 'text/plain') {
            return;
        }
    }

    const data = payload.body?.data;
    if (!data) {
        return;
    }

    // TODO: Probably some kind of latent problem here, like text encoding,
    // or just plain corrupted emails. Every email in my personal inbox seems to get parsed correctly.
    // Maybe Google is being super nice and converting/fixing stuff as necessary.
    try {
        yield decode(data).toString('utf8');
    } catch (err) {
        console.error(err);
    }
}

function* iterateMailboxes(boxes: (ParsedMailbox | ParsedGroup)[]): Iterable<ParsedMailbox> {
    // TODO: Look, even more possibly unbound nesting.
    for (const box of boxes) {
        if (box.hasOwnProperty('address')) {
            yield box as ParsedMailbox;
        } else if (box.hasOwnProperty('addresses')) {
            const group = box as ParsedGroup;
            yield* iterateMailboxes(group.addresses ?? []);
        }
    }
}

function cleanLinkifyLink(href: string): URL | null {
    // Surely many more edgecases abound

    if (href.startsWith('//')) {
        href = 'http:' + href;
    }

    const index = href.lastIndexOf('"><');
    if (index >= 0) {
        href = href.substring(0, index);
    }

    href = decodeHTML(href);

    try {
        // Ensure this is a valid URL before passing it to the main process.
        return new URL(href);
    } catch (err) {
        // TODO: There are a lot of these false positives, mostly the same format.
        // Ignore those for logging.
        // Until then, not logging at all since it's noisy.
        // console.error(href, err);
        return null;
    }
}

expose(parse);
