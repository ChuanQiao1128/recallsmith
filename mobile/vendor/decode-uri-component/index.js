'use strict';

// Decoder from decode-uri-component 0.5.1 (MIT, Sam Verschueren).
// Kept as CommonJS, and still turns "+" into a space before decoding, because
// query-string 7 relies on that 0.2.2 behavior. The 0.5.1 decoder scans each
// percent-encoded run once, which removes the quadratic replacement in 0.2.2
// (GHSA-qr28-fpjm-wq7f).

const token = '%[a-f0-9]{2}';
const multiMatcher = new RegExp('(' + token + ')+', 'gi');
const hexPair = /^[a-f\d]{2}$/i;

function parsePercentByte(input, position) {
	if (input.codePointAt(position) !== 37 || position + 3 > input.length) {
		return;
	}
	const digits = input.slice(position + 1, position + 3);
	if (!hexPair.test(digits)) {
		return;
	}
	return {byte: Number.parseInt(digits, 16), next: position + 3};
}

function utf8SequenceLength(byte) {
	if (byte <= 0x7F) {
		return 1;
	}
	if (byte >= 0xC2 && byte <= 0xDF) {
		return 2;
	}
	if (byte >= 0xE0 && byte <= 0xEF) {
		return 3;
	}
	if (byte >= 0xF0 && byte <= 0xF4) {
		return 4;
	}
	return 0;
}

function isContinuationByte(byte) {
	return byte >= 0x80 && byte <= 0xBF;
}

function decode(input) {
	try {
		return decodeURIComponent(input);
	} catch (err) {
		let output = '';
		let position = 0;
		while (position < input.length) {
			if (input.codePointAt(position) !== 37) {
				output += input.charAt(position);
				position++;
				continue;
			}
			const firstByte = parsePercentByte(input, position);
			if (!firstByte) {
				output += input.charAt(position);
				position++;
				continue;
			}
			const sequenceLength = utf8SequenceLength(firstByte.byte);
			if (sequenceLength === 0) {
				const pair = input.slice(position, position + 6);
				if (pair === '%FE%FF' || pair === '%FF%FE') {
					output += '\uFFFD\uFFFD';
					position += 6;
					continue;
				}
				output += input.slice(position, position + 3);
				position += 3;
				continue;
			}
			let end = firstByte.next;
			let validSequence = true;
			for (let index = 1; index < sequenceLength; index++) {
				const nextByte = parsePercentByte(input, end);
				if (!nextByte || !isContinuationByte(nextByte.byte)) {
					validSequence = false;
					break;
				}
				end = nextByte.next;
			}
			if (validSequence) {
				const encodedSequence = input.slice(position, end);
				try {
					output += decodeURIComponent(encodedSequence);
					position = end;
					continue;
				} catch (decodeErr) {
					// Invalid UTF-8 despite correct structure.
				}
			}
			const literal = input.slice(position, position + 3);
			output += literal === '%C2' ? '\uFFFD' : literal;
			position += 3;
		}
		return output;
	}
}

function customDecodeURIComponent(input) {
	return input.replace(multiMatcher, function (run) {
		return decode(run);
	});
}

module.exports = function (encodedURI) {
	if (typeof encodedURI !== 'string') {
		throw new TypeError('Expected `encodedURI` to be of type `string`, got `' + typeof encodedURI + '`');
	}
	try {
		encodedURI = encodedURI.replace(/\+/g, ' ');
		return decodeURIComponent(encodedURI);
	} catch (err) {
		return customDecodeURIComponent(encodedURI);
	}
};
