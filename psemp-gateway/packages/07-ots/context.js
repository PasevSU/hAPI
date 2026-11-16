/**
 * Context module - Пълна имплементация
 * @module Context
 */

(function(window) {
    'use strict';

    const Utils = window.Utils || {};

    // ================================================================
    // DESERIALIZATION
    // ================================================================

    class StreamDeserialization {
        constructor(stream) {
            this.buffer = [];
            this.counter = 0;

            if (stream === null || stream === undefined) {
                this.buffer = [];
            } else if (stream instanceof Uint8Array) {
                this.buffer = Array.from(stream);
            } else if (stream instanceof ArrayBuffer) {
                this.buffer = Array.from(new Uint8Array(stream));
            } else if (Array.isArray(stream)) {
                this.buffer = stream.slice();
            } else if (typeof stream === 'string') {
                const hex = stream.startsWith('0x') ? stream.substring(2) : stream;
                if (/^[0-9a-fA-F]*$/.test(hex)) {
                    this.buffer = Utils.hexToBytes(hex);
                } else {
                    this.buffer = Utils.stringToBytes(stream);
                }
            } else {
                throw new Error('Invalid stream type');
            }
        }

        getOutput() { return this.buffer; }
        getCounter() { return this.counter; }

        read(l) {
            if (l === undefined || l === null) {
                l = this.buffer.length - this.counter;
            }
            if (l <= 0) return [];
            const end = Math.min(this.counter + l, this.buffer.length);
            const result = this.buffer.slice(this.counter, end);
            this.counter = end;
            return result;
        }

        readByte() {
            if (this.counter >= this.buffer.length) {
                throw new Error('End of stream');
            }
            return this.buffer[this.counter++];
        }

        readVaruint() {
            let value = 0;
            let shift = 0;
            let b;
            do {
                b = this.readByte();
                value |= (b & 0b01111111) << shift;
                shift += 7;
            } while (b & 0b10000000);
            return value;
        }

        readVarbytes(maxLen = 8192) {
            const len = this.readVaruint();
            if (len > maxLen) {
                throw new Error(`Varbytes length ${len} exceeds max ${maxLen}`);
            }
            return this.read(len);
        }

        readBytes(len) {
            return this.read(len);
        }

        assertMagic(magic) {
            const actual = this.read(magic.length);
            if (!Utils.arrEq(magic, actual)) {
                throw new Error(`Expected magic ${Utils.bytesToHex(magic)}, got ${Utils.bytesToHex(actual)}`);
            }
        }

        assertEof() {
            if (this.counter < this.buffer.length) {
                throw new Error(`Trailing garbage: ${this.buffer.length - this.counter} bytes remaining`);
            }
        }
    }

    // ================================================================
    // SERIALIZATION
    // ================================================================

    class StreamSerialization {
        constructor() {
            this.buffer = [];
            this.length = 0;
        }

        getOutput() { return this.buffer; }
        getLength() { return this.length; }

        writeByte(value) {
            this.buffer[this.length] = (value || 0) & 0xFF;
            this.length++;
        }

        writeBytes(value) {
            if (!value) return;
            for (let i = 0; i < value.length; i++) {
                this.writeByte(value[i]);
            }
        }

        writeVaruint(value) {
            if (value < 0) throw new Error('Varuint must be non-negative');
            if (value === 0) {
                this.writeByte(0);
                return;
            }
            while (value > 0) {
                let b = value & 0b01111111;
                if (value > 0b01111111) {
                    b |= 0b10000000;
                }
                this.writeByte(b);
                if (value <= 0b01111111) break;
                value >>= 7;
            }
        }

        writeVarbytes(value) {
            this.writeVaruint(value.length);
            this.writeBytes(value);
        }
    }

    // ================================================================
    // ERRORS
    // ================================================================

    class DeserializationError extends Error {
        constructor(message) { super(message); this.name = 'DeserializationError'; }
    }

    class BadMagicError extends DeserializationError {
        constructor(message) { super(message); this.name = 'BadMagicError'; }
    }

    class UnsupportedMajorVersion extends Error {
        constructor(message) { super(message); this.name = 'UnsupportedMajorVersion'; }
    }

    class TrailingGarbageError extends DeserializationError {
        constructor(message) { super(message); this.name = 'TrailingGarbageError'; }
    }

    // ================================================================
    // EXPORT
    // ================================================================

    const Context = {
        StreamDeserialization,
        StreamSerialization,
        DeserializationError,
        BadMagicError,
        UnsupportedMajorVersion,
        TrailingGarbageError
    };

    window.Context = Context;

})(typeof window !== 'undefined' ? window : this);