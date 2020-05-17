import fetch from 'node-fetch';
import * as React from 'react';
import { render } from 'react-dom';

interface AppProps {
    name: string;
}

interface AppState {
    time: string | null;
}

export function App() {
    const [messageCount, setMessageCount] = React.useState<number | null>(null);

    React.useEffect(() => {
        const ctrl = new AbortController();
        fetch(
            '/api/email_count',
            {method: 'POST', signal: ctrl.signal as any},  // TODO: Browser and node types are mixed up
        ).then(async response => {
            if (!response.ok) {
                return;
            }
            const {messageCount} = await response.json();
            if (ctrl.signal.aborted) {
                return;
            }
            setMessageCount(messageCount);
        });
        return () => ctrl.abort();
    }, []);

    return <div>Total messages: {messageCount ?? 'loading...'}</div>;
}


export function start() {
    const rootElem = document.getElementById('main');
    render(<App />, rootElem);
}
