import clsx from 'clsx';
import * as React from 'react';
import {Email, EmailWarning, Warning} from '../schema/schema';
import GoogleDocIcon from './google-docs.png';
import CodeIcon from './codeicon.png';
import './styles.css';

export function WarningCard({warning}: {warning: EmailWarning}) {
    const [expandedState, setExpandedState] = React.useState(false);

    const onClick = React.useCallback(() => {
        setExpandedState(!expandedState);
    }, [expandedState]);

    const isExpanded = expandedState && canExpand(warning.warning);

    const title = objectTitle(warning.warning);
    const image = objectImage(warning.warning);
    const severity = warningSeverity(warning.warning);
    const cardClass = clsx('card hover-shadow', {
        'border-left-danger': severity === 'error',
        'border-left-warning': severity === 'warning',
    });

    return <div className={clsx('col-12 my-2', {'col-lg-6': !isExpanded})}>
        <div className={cardClass} onClick={onClick}>
            <div className="card-header">
                <h5 className="card-title text-primary m-0">{displayType(warning.warning)}</h5>
            </div>
            <div className="card-body pt-2">
                <EmailHeader email={warning.email} />
                <div className="row">
                    <div className="col-2 pr-0 my-auto">
                        <img className="scaled-image" src={image} alt="Warning" />
                    </div>
                    {!isExpanded && <div className="col my-auto">
                        {title && <h5 className="card-title text-truncate font-weight-bold mb-0">{title}</h5>}
                        <div className="text-truncate">
                            {objectContent(warning.warning, isExpanded)}
                        </div>
                    </div>}
                </div>
                {isExpanded && objectContent(warning.warning, isExpanded)}
            </div>
        </div>
    </div>;
}

function EmailHeader({email}: {email: Email}) {
    let sender: string | undefined;
    if (email.sender) {
        if (email.sender.name) {
            sender = `${email.sender.name} \u2012 ${email.sender.address}`;
        } else {
            sender = email.sender.address;
        }
    }

    return <div className="mb-2">
        <h6 className="card-title text-truncate mb-1">
            <span className="font-weight-bold">{email.subject ?? 'No subject'}</span>
        </h6>
        {sender && <h6 className="card-subtitle text-truncate">
            <span className="text-muted font-italic"> &#x2937; {sender}</span>
        </h6>}
    </div>;
}

function displayType(warning: Warning): string {
    switch (warning.type) {
        case 'public_document':
            return 'Unsecured document link';
        case 'code_snippet':
            return 'Exposed source code';
        default:
            return 'Unknown problem';
    }
}

function objectTitle(warning: Warning): string | undefined {
    switch (warning.type) {
        case 'public_document':
            return warning.documentTitle ?? warning.link;
        default:
            return undefined;
    }
}

function canExpand(warning: Warning) {
    return warning.type === 'code_snippet';
}

function objectContent(warning: Warning, expanded: boolean): React.ReactNode {
    switch (warning.type) {
        case 'public_document':
            return <div className="text-truncate">
                <a className="card-link" href={warning.link}>{warning.link}</a>
            </div>;
        case 'code_snippet':
            if (!warning.snippet) {
                return null;
            }
            return expanded
                ? <pre><code>{warning.snippet}</code></pre>
                : <code>{warning.snippet}</code>;
        default:
            return null;
    }
}

function objectImage(warning: Warning): string {
    switch (warning.type) {
        case 'public_document':
            return GoogleDocIcon;
        case 'code_snippet':
            return CodeIcon;
        default:
            return CodeIcon;
    }
}

function warningSeverity(warning: Warning): 'error' | 'warning' {
    switch (warning.type) {
        case 'public_document':
            return 'error';
        default:
            return 'warning';
    }
}
