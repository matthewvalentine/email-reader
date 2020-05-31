import * as React from 'react';
import {Doughnut} from 'react-chartjs-2';
import {Warning} from '../schema/schema';

export interface OverviewProps {
    totalIngested: number;
    totalCompleted: number;
    totalPerWarning: Map<Warning['type'], number>;
}

export const Overview = React.memo((props: OverviewProps) => {
    return <div className="card">
        <div className="card-body">
            <div className="row align-items-center">
                <div className="col-6">
                    <Chart {...props} />
                </div>
                <div className="col-6">
                    <Summary {...props} />
                </div>
            </div>
        </div>
    </div>;
});

function Chart(props: OverviewProps) {
    const {totalIngested, totalCompleted} = props;
    let overlayTitle: string;
    let overlaySubtitle: string | undefined;
    let chart: React.ReactNode;
    if (totalIngested === 0) {
        overlayTitle = 'Loading...';
        overlaySubtitle = undefined;
        chart = null;
    } else {
        overlayTitle = `${Math.floor(100*totalCompleted/totalIngested)}%`;
        overlaySubtitle = `of ${totalIngested}`;

        const stats = computeStats(props);

        const labels: string[] = [];
        const data: number[] = [];
        const backgroundColor: string[] = [];

        for (const [warningType, proportion] of stats.warnings.entries()) {
            switch (warningType) {
                case 'code_snippet':
                    labels.push('Exposed source code');
                    data.push(proportion);
                    backgroundColor.push('rgb(255, 193, 7)');
                    break;
                case 'public_document':
                    labels.push('Unsecured document link');
                    data.push(proportion);
                    backgroundColor.push('rgb(220, 53, 69)');
                    break;
            }
        }

        labels.push('Ok');
        data.push(stats.successful);
        backgroundColor.push('rgb(40, 167, 69)');

        labels.push('Remaining');
        data.push(stats.remaining);
        backgroundColor.push('rgb(23, 162, 184)');

        chart = <Doughnut
            data={{
                labels,
                datasets: [{
                    data,
                    backgroundColor,
                }],
            }}
            options={{
                maintainAspectRatio: false,
                legend: {display: false},
                tooltips: {enabled: false},
            }}
        />;
    }

    return <div className="relative">
        <div className="absolute-centered-container">
            <div className="text-center">
                <h4 className="font-weight-bold">{overlayTitle}</h4>
                {overlaySubtitle && <h6>{overlaySubtitle}</h6>}
            </div>
        </div>
        <div className="chart-holder">
            {chart}
        </div>
    </div>;
}

function Summary(props: OverviewProps) {
    if (props.totalPerWarning.size === 0) {
        return <div className="text-center">
            <h4 className="font-weight-bold my-auto">No warnings yet!</h4>
        </div>;
    }

    return <div>
        {Array.from(props.totalPerWarning.entries()).map(([warningType, count]) => {
            switch (warningType) {
                case 'code_snippet':
                    return <h5>
                        Exposed source code: <span className="font-weight-bold text-warning">{count}</span>
                    </h5>;
                case 'public_document':
                    return <h5>
                        Unsecured document link: <span className="font-weight-bold text-danger">{count}</span>
                    </h5>;
                default:
                    return null;
            }
        })}
    </div>
}

function computeStats({totalIngested, totalCompleted, totalPerWarning}: OverviewProps) {
    const remaining = totalIngested - totalCompleted;

    let failed = 0;
    for (const count of totalPerWarning.values()) {
        failed += count;
    }

    const successful = totalCompleted - failed;

    let logTotal = Math.log2(successful + 1);
    for (const count of totalPerWarning.values()) {
        logTotal += Math.log2(count + 1);
    }

    const warningProportions = new Map<Warning['type'], number>();
    for (const warningType of ['public_document', 'code_snippet'] as const) {
        const count = totalPerWarning.get(warningType) ?? 0;
        warningProportions.set(warningType, successful * Math.log2(count + 1) / logTotal);
    }

    return {
        remaining,
        successful: successful * Math.log2(successful + 1) / logTotal,
        warnings: warningProportions,
    };
}
