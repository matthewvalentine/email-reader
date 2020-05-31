import type {Response} from 'node-fetch'
import {HTMLElement, NodeType, parse} from 'node-html-parser';
import {URL} from 'url';
import {decode} from 'he';

// Because this file is also used in a Worker and something is broken about
// how those are built.
const fetch = __non_webpack_require__('node-fetch');

// TODO: Either lots and lots of cataloguing, or cleverer tricks.
// For example, the hostname along with something that looks like a big base64-UID
// might be enough to determine that it is likely to be a link to content.

// TODO: Follow link shorteners like tinyurl.

const b64id = /^[0-9a-zA-Z_\-]{8,}$/;
const googleDriveHost = /^(drive|docs)\.google\.com/i;
const googleContentHost = /^[\w.]+\.googleusercontent\.com/i;
const googleDriveFileLink = /^\/\w+\/d\/([0-9a-zA-Z_\-]{8,})/;
const googleDriveActionLink = /^\/\w+/;

export function isProbablyGoogleDriveLink(url: URL): boolean {
    if (!googleDriveHost.test(url.hostname)) {
        return false;
    }

    if (googleDriveFileLink.test(url.pathname)) {
        return true;
    }
    if (googleDriveActionLink.test(url.pathname)) {
        const id = url.searchParams.get('id');
        if (id && b64id.test(id)) {
            return true;
        }
    }
    return false;
}

export interface GoogleDriveInfo {
    isPublic: boolean;
    title?: string;
}

export async function fetchGoogleDriveInfo(url: URL): Promise<GoogleDriveInfo> {
    // TODO: Consider using header-only requests
    const response = await fetch(url.href);
    if (!response.ok) {
        // TODO: Distinguish temporary errors from permanent errors,
        // except that malformed URLs could even produce permanent "temporary" errors.
        return {isPublic: false};
    }

    let redirectedURL: URL;
    try {
        redirectedURL = new URL(response.url);
    } catch(err) {
        console.error(err);
        return {isPublic: false};
    }

    if (googleDriveHost.test(redirectedURL.hostname)) {
        return {isPublic: true, title: await parseTitle(response)};
    }

    if (googleContentHost.test(redirectedURL.hostname)) {
        const docId = url.searchParams.get('id');
        if (!docId) {
            return {isPublic: true};
        }

        const documentResponse = await fetch(`https://drive.google.com/open?id=${docId}`);
        if (!documentResponse.ok) {
            return {isPublic: true};
        }
        return {isPublic: true, title: await parseTitle(documentResponse)};
    }

    // TODO: Log unexpected domains gotten this way.
    // (Actual redirects to sign in should end up on accounts.google.com and not elsewhere.)
    return {isPublic: false};
}

async function parseTitle(response: Response): Promise<string | undefined> {
    try {
        // TODO: I'm not happy with this since it reads the whole body
        // but for some reason the more capable packages (to successfully parse just the first bit of the html)
        // seem to all run into module resolution errors.
        if (!response.ok) {
            // TODO: Should distinguish temporary and permanent failures for purpose of retries.
            return undefined;
        }

        const parsed = parse(await response.text()) as HTMLElement & {valid: boolean};
        if (!parsed.valid || parsed.nodeType != NodeType.ELEMENT_NODE) {
            return undefined;
        }

        const title = parsed.querySelector('title')?.innerHTML;
        if (!title) {
            return undefined;
        }

        return decode(title);
    } catch(err) {
        console.error(err);
        return undefined;
    }
}
