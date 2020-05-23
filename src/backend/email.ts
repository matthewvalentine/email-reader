import {AbortController} from 'abort-controller';
import {gmail_v1, google} from 'googleapis';
import {AbortSignal} from 'node-fetch/externals';
import * as os from 'os';
import {spawn, Worker} from 'threads/dist';
import {URL} from 'url';
import {Credentials, OauthProvider} from './oauth';
import type {ParseResult, ParseWorker} from './parse.worker';
import {fetchGoogleDriveInfo, isProbablyGoogleDriveLink} from './public_links';
import {consume, MemoryQueue, ReadStream} from './streams';

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
    const suspicious = new MemoryQueue<ParseResult>();
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
        workers: 30,
        cancel,
    });

    consume(
        toParse,
        async (message: gmail_v1.Schema$Message, worker: ParseWorker) => {
            const parsed = await worker(message);
            if (parsed.suspiciousLinks.length === 0) {
                results.publish({type: 'processed_messages', wordCount: new Map<string, number>()});
            } else {
                suspicious.publish(parsed);
            }
        },
        {
            cancel,
            initializeWorker: async () => {
                const worker = new Worker('./parse.worker');
                return {
                    worker: await spawn<ParseWorker>(worker),
                    cleanup: () => worker.terminate(),
                };
            },
            workers: os.cpus().length,
        },
    );

    consume(suspicious, async ({suspiciousLinks}) => {
        const wordCount = new Map<string, number>();
        for (const {link, originalText} of suspiciousLinks) {
            const url = new URL(link);
            const {isPublic, title} = await fetchGoogleDriveInfo(url);
            if (isPublic) {
                wordCount.set(title || originalText, 1 + (wordCount.get(title || originalText) ?? 0));
            }
        }
        results.publish({type: 'processed_messages', wordCount});
    }, {
        cancel,
        workers: 5,
    });

    // After setting up the pipeline, kick it off with our initial message.
    toList.publish({});

    return results;
}
