import * as React from 'react';
import { render } from 'react-dom';

type Event =
    | {type: 'found_messages', messageCount: number}
    | {type: 'processed_messages', wordCount: [string, number][]};

export function App() {
    const [totalMessageCount, setTotalMessageCount] = React.useState<number | null>(null);
    const [processedMessageCount, setProcessedMessageCount] = React.useState(0);
    const [recentWords, setRecentWords] = React.useState<string[]>([]);

    React.useEffect(() => {
        const events = new EventSource('/api/connect');
        events.addEventListener('message', rawEvent => {
            const event: Event = JSON.parse(rawEvent.data);
            switch (event.type) {
                case 'found_messages':
                    setTotalMessageCount(c => (c ?? 0) + event.messageCount);
                    break;
                case 'processed_messages':
                    setProcessedMessageCount(c => c + 1);
                    event.wordCount.sort(
                        // negative = reverse
                        ([, lhsCount], [, rhsCount]) => -(lhsCount - rhsCount),
                    );
                    setRecentWords(event.wordCount.slice(0, 10).map(([w]) => w));
                    break;
            }
        });
        return () => events.close();
    }, []);

    return <div>
        <div>Total messages: {
            totalMessageCount === null
            ? 'loading...'
            : `${processedMessageCount} / ${totalMessageCount}`
        }</div>
        {recentWords.map(w => <div>{w}</div>)}
    </div>;
}

export function start() {
    const rootElem = document.getElementById('main');
    render(<App />, rootElem);
}
