import {AbortController} from 'abort-controller';
import {gmail_v1, google} from "googleapis";
import * as linkify from 'linkifyjs';
import {AbortSignal} from "node-fetch/externals";
import {URL} from 'url';
import {decode} from "urlsafe-base64";
import {Credentials, OauthProvider} from "./oauth";
import {isGoogleDriveLinkPublic, isProbablyGoogleDriveLink} from "./public_links";
import {consume, MemoryQueue, ReadStream} from "./streams";

export type EmailResult =
    | { type: 'found_messages', messageCount: number}
    | { type: 'processed_messages', wordCount: Map<string, number>};

// Currently this creates a brand new pipeline for just a single user upon request,
// but it should be one big static pipeline for all users.
export function processAllEmails(oauth: OauthProvider, credentials: Credentials, cancel: AbortSignal): ReadStream<EmailResult> {
    const abort = new AbortController();
    const gmail = google.gmail({version: 'v1', auth: oauth.newClient(credentials)});

    // These might be Kafka topics or something.
    // At least, the idea is to pretend (to a small degree) that the separate parts
    // of the pipeline are running on separate machines in some kind of horizontally scalable fashion.
    const toList = new MemoryQueue<{pageToken?: string}>();
    const toFetch = new MemoryQueue<{messageId: string}>();
    // TODO: Parse is currently following possibly-public-links,
    // split that into a separate step with separate workers.
    const toParse = new MemoryQueue<gmail_v1.Schema$Message>();
    const results = new MemoryQueue<EmailResult>();

    // Set up the pipeline.
    consume(toList, async ({pageToken}) => {
        const response = await gmail.users.messages.list({userId: 'me', includeSpamTrash: true, pageToken});
        if (response.data.nextPageToken) {
            toList.publish({pageToken: response.data.nextPageToken});
        }
        for (const {id} of response.data.messages ?? []) {
            toFetch.publish({messageId: id!});
        }
        results.publish({type: 'found_messages', messageCount: response.data.messages?.length ?? 0});
    }, {cancel});

    consume(toFetch, async ({messageId}) => {
        const {data: message} = await gmail.users.messages.get({userId: 'me', id: messageId});
        toParse.publish(message);
    }, {
        // TODO: This is a ton of workers. Use Google's batch API instead.
        // However, it doesn't seem supported by the client, so it'd have to be raw HTTP.
        // In comparison, typing a big number is just so easy...
        workers: 35,
        cancel,
    });

    // TODO: Use WorkerThreads as parsing is CPU bound.
    consume(toParse, async (message) => {
        const wordCount = new Map<string, number>();
        for (const body of readEmailPayload(message.payload ?? {})) {
            for (const {value, href} of linkify.find(body)) {
                let url: URL;
                try {
                    url = new URL(href);
                } catch (err) {
                    // TODO: There are a lot of these false positives, mostly the same format.
                    // Ignore those for logging.
                    // TODO: re-enable: console.error(value, href, err);
                    continue;
                }

                if (isProbablyGoogleDriveLink(url) && await isGoogleDriveLinkPublic(url)) {
                    wordCount.set(value, 1 + (wordCount.get(value) ?? 0));
                }
            }
        }
        results.publish({type: 'processed_messages', wordCount});
    }, {cancel});

    // After setting up the pipeline, kick it off with our initial message.
    toList.publish({});

    return results;
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
    // or just plain corrupted emails. Right now I'm not even catching errors,
    // every email in my personal inbox seems to get parsed correctly.
    // Maybe Google is being super nice and converting/fixing stuff as necessary.
    yield decode(data).toString('utf8');
}
