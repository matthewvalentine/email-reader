import * as React from 'react';
import { render } from 'react-dom';

type Event =
    | {type: 'found_messages', messageCount: number}
    | {type: 'processed_messages', wordCount: [string, number][]};

export function App() {
    const [totalMessageCount, setTotalMessageCount] = React.useState<number | null>(null);
    const [processedMessageCount, setProcessedMessageCount] = React.useState(0);

    // Null to avoid allocating every single time. State to cause a re-render even though we're
    // using this mutable value.
    const totalCounts = React.useRef<Map<string, number> | null>(null);
    totalCounts.current = totalCounts.current ?? new Map();
    const [totalCountsVersion, setTotalCountsVersion] = React.useState(0);

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
                    for (const [word, count] of event.wordCount) {
                        totalCounts.current!.set(word, 1 + (totalCounts.current!.get(word) ?? 0));
                    }
                    setTotalCountsVersion(c => c + 1);
                    break;
            }
        });
        return () => events.close();
    }, []);

    const topWords = React.useMemo(() => {
        return Array.from(totalCounts.current!.entries()).sort(
            // Negative so that the largest counts are first
            ([, lhsCount], [, rhsCount]) => -(lhsCount - rhsCount)
        ).slice(0, 20);
    }, [totalCountsVersion]);

    return <div>
        <div>Total messages: {
            totalMessageCount === null
            ? 'loading...'
            : `${processedMessageCount} / ${totalMessageCount}`
        }</div>
        {topWords.map(([word, count]) => <div>{word}: {count}</div>)}
    </div>;
}

export function start() {
    const rootElem = document.getElementById('main');
    render(<App />, rootElem);
}
