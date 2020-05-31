import {gmail_v1} from 'googleapis';
import os from 'os';
import {spawn, Worker} from 'threads/dist';
import {URL} from 'url';
import {Contact} from '../schema/schema';
import {Context} from './util/context';
import {Deps} from './dependencies';
import {OauthClient} from './oauth';
import type {Link, ParseWorker} from './parse.worker';
import {fetchGoogleDriveInfo} from './public_links';
import {SQLiteStream} from './storage/stream';
import {consume, ReadWriteStream} from './util/streams';
import {v3 as murmurhash} from 'murmurhash';

export class Pipeline {
    private readonly pagingStream: ReadWriteStream<PageRequest>;
    private readonly fetchingStream: ReadWriteStream<FetchRequest>;
    private readonly parsingStream: ReadWriteStream<ParseRequest>;
    private readonly investigationStream: ReadWriteStream<InvestigateRequest>;

    constructor(private deps: Deps) {
        this.pagingStream = new SQLiteStream(this.deps.db, 'paging');
        this.fetchingStream = new SQLiteStream(this.deps.db, 'fetching');
        this.parsingStream = new SQLiteStream(this.deps.db, 'parsing');
        this.investigationStream = new SQLiteStream(this.deps.db, 'investigation', 30_000);
    }

    public run(ctx: Context) {
        consume(ctx, this.pagingStream, this.processPageRequest);
        consume(ctx, this.fetchingStream, this.processFetchRequest, {workers: 30});
        consume(ctx, this.parsingStream, this.processParseRequest, {
            workers: os.cpus().length,
            initializeWorker: async () => {
                const worker = new Worker('./parse.worker');
                return {
                    worker: await spawn<ParseWorker>(worker),
                    cleanup: () => worker.terminate(),
                };
            },
        });
        consume(ctx, this.investigationStream, this.processInvestigateRequest, {workers: 5});
    }

    public async refreshUser(ctx: Context, userId: string) {
        // Sanity check that this is a valid user.
        await this.getAuth(ctx, userId);

        await this.pagingStream.publish(ctx, {type: 'refresh', userId});
    }

    private processPageRequest = async (ctx: Context, request: PageRequest) => {
        switch (request.type) {
            case 'refresh': {
                const {userId} = request;
                const {historyId: startHistoryId, isSyncing} = await this.deps.ingestion.get(ctx, userId);
                if (!isSyncing) {
                    // We haven't got any data for this user yet, so start a full sync.
                    await this.pagingStream.publish(ctx, {type: 'sync', userId});
                    await this.deps.ingestion.update(ctx, userId);
                    return;
                }
                if (startHistoryId) {
                    await this.listAndIngestHistory(ctx, {userId, startHistoryId});
                }
                return;
            }

            case 'refreshPage': {
                const {userId, startHistoryId, pageToken} = request;
                await this.listAndIngestHistory(ctx, {userId, startHistoryId, pageToken});
                return;
            }

            case 'sync': {
                const {userId} = request;
                await this.listAndIngestMessages(ctx, {userId, recordHistoryId: true});
                return;
            }

            case 'syncPage': {
                const {userId, pageToken} = request;
                await this.listAndIngestMessages(ctx, {userId, pageToken});
                return;
            }

            default:
                const _: never = request;
        }
    }

    private processFetchRequest = async (ctx: Context, request: FetchRequest) => {
        const {userId, emailId, recordHistoryId} = request;
        const {data: message} = await this.deps.gmail.users.messages.get({
            userId: 'me',
            auth: await this.getAuth(ctx, userId),
            id: emailId,
        });
        if (recordHistoryId && message.historyId) {
            await this.deps.ingestion.update(ctx, userId, message.historyId)
        }
        await this.parsingStream.publish(ctx, {userId, message});
    }

    private processParseRequest = async (ctx: Context, {userId, message}: ParseRequest, worker: ParseWorker) => {
        const parsed = await worker(message);

        for (const snippet of parsed.codeSnippets) {
            await this.deps.warnings.add(
                ctx,
                userId,
                message.id!,
                // TODO: Collisions, all that stuff. I don't really mind right now.
                `code/${murmurhash(snippet)}`,
                parsed.subject,
                parsed.sender,
                {
                    type: 'code_snippet',
                    snippet,
                }
            )
        }

        // TODO: Skip the investigation pipeline if suspiciousLinks is empty.
        const pendingTasks: string[] = [];
        for (const link of parsed.suspiciousLinks) {
            pendingTasks.push(`link/${link.originalText}`);
        }
        await this.deps.progress.setPendingTasks(ctx, userId, message.id!, pendingTasks);
        for (const link of parsed.suspiciousLinks) {
            await this.investigationStream.publish(ctx, {
                userId,
                emailId: message.id!,
                suspiciousLink: link,
                taskId: `link/${link.originalText}`,
                subject: parsed.subject,
                sender: parsed.sender,
            });
        }
    }

    private processInvestigateRequest = async (ctx: Context, request: InvestigateRequest) => {
        const {userId, emailId, suspiciousLink, taskId, subject, sender} = request;
        const {link, originalText} = suspiciousLink;
        const url = new URL(link);
        const {isPublic, title} = await fetchGoogleDriveInfo(url);
        if (isPublic) {
            await this.deps.warnings.add(
                ctx,
                userId,
                emailId,
                taskId,
                subject,
                sender,
                {
                    type: 'public_document',
                    link,
                    originalText,
                    documentTitle: title,
                },
            );
        }
        await this.deps.progress.markTaskCompleted(ctx, userId, emailId, taskId);
    }

    private async getAuth(ctx: Context, userId: string): Promise<OauthClient> {
        const credentials = await this.deps.credentials.get(ctx, userId);
        if (!credentials) {
            throw new Error(`Expected credentials for user ${userId}`);
        }
        return this.deps.oauth.newClient(credentials);
    }

    private async listAndIngestHistory(
        ctx: Context,
        params: {
            userId: string;
            startHistoryId: string;
            pageToken?: string;
        },
    ) {
        // TODO: Catch 404 error, and in that case, start a new full sync.
        const {data: {history, historyId, nextPageToken}} = await this.deps.gmail.users.history.list({
            userId: 'me',
            auth: await this.getAuth(ctx, params.userId),
            startHistoryId: params.startHistoryId,
            pageToken: params.pageToken,
        });

        const messages: gmail_v1.Schema$Message[] = [];
        for (const {messagesAdded} of history ?? []) {
            for (const {message} of messagesAdded ?? []) {
                if (message) {
                    messages.push(message);
                }
            }
        }
        if (messages.length) {
            await this.ingestMessages(ctx, params.userId, true, messages);
        }

        if (nextPageToken) {
            await this.pagingStream.publish(ctx, {
                type: 'refreshPage',
                userId: params.userId,
                startHistoryId: params.startHistoryId,
                pageToken: nextPageToken,
            });
        }

        if (historyId) {
            await this.deps.ingestion.update(ctx, params.userId, historyId);
        }
        return;
    }

    private async listAndIngestMessages(
        ctx: Context,
        params: {
            userId: string;
            pageToken?: string;
            recordHistoryId?: boolean;
        }
    ) {
        const {data: {messages, nextPageToken}} = await this.deps.gmail.users.messages.list({
            userId: 'me',
            auth: await this.getAuth(ctx, params.userId),
            pageToken: params.pageToken,
            includeSpamTrash: true,
        });

        if (messages) {
            await this.ingestMessages(ctx, params.userId, !!params.recordHistoryId, messages);
        }

        if (nextPageToken) {
            await this.pagingStream.publish(ctx, {
                type: 'syncPage',
                userId: params.userId,
                pageToken: nextPageToken,
            });
        }
    }

    private async ingestMessages(
        ctx: Context,
        userId: string,
        recordHistoryId: boolean,
        messages: gmail_v1.Schema$Message[],
    ) {
        for (const message of messages ?? []) {
            if (message.id) {
                await this.fetchingStream.publish(ctx, {
                    userId: userId,
                    emailId: message.id,
                    recordHistoryId: recordHistoryId,
                });
                await this.deps.progress.markEmailIngested(ctx, userId, message.id);
            }
        }
    }
}

type PageRequest =
    | {type: 'refresh', userId: string}
    | {type: 'refreshPage', userId: string, startHistoryId: string, pageToken: string}
    | {type: 'sync', userId: string}
    | {type: 'syncPage', userId: string, pageToken: string};

type FetchRequest =
    | {userId: string, emailId: string, recordHistoryId: boolean};

type ParseRequest =
    | {userId: string, message: gmail_v1.Schema$Message};

type InvestigateRequest =
    | {userId: string, emailId: string, suspiciousLink: Link, taskId: string, subject?: string, sender?: Contact};
