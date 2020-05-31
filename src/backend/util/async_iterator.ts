export class Poller implements AsyncIterableIterator<unknown> {
    constructor(private interval: number) {}

    async next(): Promise<IteratorResult<unknown>> {
        return new Promise(resolve => setTimeout(resolve, this.interval));
    }

    [Symbol.asyncIterator](): AsyncIterableIterator<unknown> {
        return this;
    }
}

export function mergeAsync<T>(...iterables: ReadonlyArray<AsyncIterable<T>>): AsyncIterableIterator<T> {
    return new MergeAsyncIterator(iterables);
}

type AsyncIteratorState<K, T> = {
    iterator: AsyncIterator<T>;
    next: Promise<{key: K, result: IteratorResult<T>}>;
};

function queueNextAsync<K, T>(key: K, iterator: AsyncIterator<T>): AsyncIteratorState<K, T> {
    return {
        iterator,
        next: iterator.next().then(result => ({key, result})),
    };
}

class MergeAsyncIterator<T> implements AsyncIterableIterator<T> {
    private iterators: Map<number, AsyncIteratorState<number, T>>;

    constructor(iterables: ReadonlyArray<AsyncIterable<T>>) {
        this.iterators = new Map(iterables.map((iterable, index) => {
            const iterator = iterable[Symbol.asyncIterator]();
            return [index, queueNextAsync(index, iterator)];
        }));
    }

    [Symbol.asyncIterator]() {
        return this;
    }

    async next(): Promise<IteratorResult<T>> {
        while (this.iterators.size > 0) {
            const {key, result: {done, value}} = await Promise.race(this.promises());
            if (done) {
                this.iterators.delete(key);
                continue;
            }
            this.iterators.set(key, queueNextAsync(key, this.iterators.get(key)!.iterator));
            return {value};
        }
        return {done: true, value: null};
    }

    private promises() {
        const promises: AsyncIteratorState<number, T>['next'][] = [];
        for (const {next} of this.iterators.values()) {
            promises.push(next);
        }
        return promises;
    }
}
