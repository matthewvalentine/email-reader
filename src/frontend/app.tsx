import * as React from 'react';
import {render} from 'react-dom';
import './styles.css';
import {EmailWarning, Event, Warning} from '../schema/schema';
import {Overview} from './overview';
import {WarningCard} from './warning';

export function App() {
    const [totalMessageCount, setTotalMessageCount] = React.useState<number | null>(null);
    const [processedMessageCount, setProcessedMessageCount] = React.useState(0);
    const [warnings, setWarnings] = React.useState<EmailWarning[]>([]);

    React.useEffect(() => {
        const events = new EventSource('/api/connect');
        events.addEventListener('message', rawEvent => {
            const event: Event = JSON.parse(rawEvent.data);

            if (event.progress) {
                setTotalMessageCount(event.progress.ingestedEmails);
                setProcessedMessageCount(event.progress.completedEmails);
            }

            if (event.warnings) {
                setWarnings(ws => ws.concat(event.warnings!));
            }
        });
        return () => events.close();
    }, []);

    const warningCards = React.useMemo(() => {
        return warnings.map(w => <WarningCard key={w.warningId} warning={w} />).reverse();
    }, [warnings])

    const totalPerWarning = React.useMemo(() => {
        const perWarning = new Map<Warning['type'], number>();
        for (const w of warnings) {
            perWarning.set(w.warning.type, 1 + (perWarning.get(w.warning.type) ?? 0));
        }
        return perWarning;
    }, [warnings]);

    return <div>
        <div className="container">
            <div className="row">
                <div className="col-12">
                    <Overview
                        totalIngested={totalMessageCount ?? 0}
                        totalCompleted={processedMessageCount}
                        totalPerWarning={totalPerWarning}
                    />
                </div>
            </div>
            <div className="row">
                {warningCards}
            </div>
        </div>
    </div>;
}

export function start() {
    const rootElem = document.getElementById('main');
    render(<App />, rootElem);
}

