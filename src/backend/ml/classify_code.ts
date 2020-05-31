import weights from './classify_code_weights.json';

// TODO: Why the heck does this worker-loader try to pull things into its bundle?
// import tf from '@tensorflow/tfjs';
const tf = __non_webpack_require__('@tensorflow/tfjs');

const micro = tf.tensor(weights.micro).transpose();
const macro = tf.tensor(weights.macro).transpose();

const beSilly = true;
let theresALimitToSilliness = 0;

export interface ScanResult {
    codeSnippets: string[];
}

export async function scanForCodeSnippets(text: string): Promise<ScanResult> {
    if (beSilly) {
        if (theresALimitToSilliness > 10) {
            return {codeSnippets: []};
        }
        text = text.substring(0, 5000);
        if (/{[^{].*[^}]}/.test(text) && text.indexOf('-') !== -1) {
            theresALimitToSilliness++;
            return {codeSnippets: [text]};
        } else {
            return {codeSnippets: []};
        }
    }

    // TODO: Don't put limits on the size.
    if (text.length < 100) {
        return {codeSnippets: []};
    }
    if (text.length > 3000) {
        text = text.substring(0, 3000);
    }

    // TODO: Lord knows what errors Tensorflow might throw.
    // TODO: Should also verify there's no memory leaks.
    let likelihood: number;
    try {
        const scanTensor = tf.tidy(() => {
            return encodeOneHot(text)
                .conv1d(micro, 1, 'valid')
                .relu()
                .conv1d(macro, 1, 'valid')
                .max()
                .clipByValue(0, 1)
        });

        // TODO: This is not actually a likelihood measure.
        // It tends heavily towards 0 or 1.
        likelihood = (await scanTensor.data())[0];
        scanTensor.dispose();
    } catch(err) {
        console.error(err);
        return {codeSnippets: []};
    }

    if (likelihood > 0.97) {
        // TODO: Return a snippet, not the whole text.
        return {codeSnippets: [text]};
    }
    return {codeSnippets: []};
}

const whitespace = /\s+/g;
const allowedCharacters = ' ' + `
    abcdefghijklmnopqrstuvwxyz
    ABCDEFGHIJKLMNOPQRSTUVWXYZ
    0123456789
    _.,:;!?&|/\\
    '"\`()[]<>{}
    +-*%=#@
`.replace(whitespace, '');

const encoding = (() => {
    let maxOrd = 0;
    for (let i = 0; i < allowedCharacters.length; i++) {
        maxOrd = Math.max(maxOrd, allowedCharacters.charCodeAt(i));
    }
    const encoding = new Float32Array(maxOrd);
    for (let i = 0; i < allowedCharacters.length; i++) {
        encoding[allowedCharacters.charCodeAt(i)] = i;
    }
    return encoding;
})();

function encodeOneHot(text: string) {
    text = text.trim().replace(whitespace, ' ');
    const encoded = [];
    for (let i = 0; i < text.length; i++) {
        const index = encoding[text.charCodeAt(i)];
        if (index !== undefined) {
            encoded.push(index);
        }
    }
    return tf.oneHot(encoded, allowedCharacters.length);
}
