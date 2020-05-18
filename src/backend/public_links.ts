import fetch from 'node-fetch';
import {URL} from 'url';

// TODO: Either lots and lots of cataloguing, or cleverer tricks.
// For example, the hostname along with something that looks like a big base64-UID
// might be enough to determine that it is likely to be a link to content.

// TODO: Somewhere, follow link shorteners.

const b64id = /^[0-9a-zA-Z_\-]{8,}$/;
const googleDriveHost = /^(drive|docs)\.google\.com/i;
const googleContentHost = /^[\w.]+\.googleusercontent\.com/i;
const googleDriveFileLink = /^\/\w+\/d\/[0-9a-zA-Z_\-]{8,}/;
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

export async function isGoogleDriveLinkPublic(url: URL): Promise<boolean> {
    const response = await fetch(url.href);
    if (!response.ok) {
        // TODO: Distinguish temporary errors from permanent errors,
        // except that malformed URLs could even produce permanent "temporary" errors.
        return false;
    }

    let redirectedURL: URL;
    try {
        redirectedURL = new URL(response.url);
    } catch(err) {
        console.error(err);
        return false;
    }

    // TODO: Log unexpected domains gotten this way.
    // (Actual redirects to sign in should end up on accounts.google.com and not elsewhere.)
    return googleDriveHost.test(redirectedURL.hostname) || googleContentHost.test(redirectedURL.hostname);
}
