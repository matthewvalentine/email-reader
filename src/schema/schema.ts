
export type Event = {
    progress?: {
        estimatedEmails: number | null;
        ingestedEmails: number;
        completedEmails: number;
    };
    warnings?: EmailWarning[];
}

export type Warning =
    | {type: 'none'}
    | {
        type: 'public_document',
        link: string,
        originalText: string,
        documentTitle?: string,
        context?: string,
      }
    | {
        type: 'code_snippet',
        snippet?: string,
      };

export interface EmailWarning {
    warningId: string;
    email: Email;
    version: number;
    warning: Warning;
}

export interface Email {
    emailId: string;
    subject?: string;
    sender?: Contact;
    plaintext?: string;
}

export interface Contact {
    address: string;
    name?: string;
}
