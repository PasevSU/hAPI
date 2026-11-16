/**
 * Notary module - Browser compatible
 * @module Notary
 * @license LPGL3
 */

(function(window) {
    'use strict';

    const Utils = window.Utils || {};
    const Context = window.Context || {};

    // ================================================================
    // ERRORS
    // ================================================================
    class VerificationError extends Error {
        constructor(message) {
            super(message);
            this.name = 'VerificationError';
        }
    }

    // ================================================================
    // TIME ATTESTATION
    // ================================================================
    class TimeAttestation {
        _TAG_SIZE() { return 8; }
        _MAX_PAYLOAD_SIZE() { return 8192; }

        static deserialize(ctx) {
            const tag = ctx.readBytes(new TimeAttestation()._TAG_SIZE());
            const serializedAttestation = ctx.readVarbytes(new TimeAttestation()._MAX_PAYLOAD_SIZE());
            const ctxPayload = new Context.StreamDeserialization(serializedAttestation);

            if (Utils.arrEq(tag, new PendingAttestation()._TAG())) {
                return PendingAttestation.deserialize(ctxPayload);
            } else if (Utils.arrEq(tag, new BitcoinBlockHeaderAttestation()._TAG())) {
                return BitcoinBlockHeaderAttestation.deserialize(ctxPayload);
            } else if (Utils.arrEq(tag, new LitecoinBlockHeaderAttestation()._TAG())) {
                return LitecoinBlockHeaderAttestation.deserialize(ctxPayload);
            }
            return UnknownAttestation.deserialize(ctxPayload, tag);
        }

        serialize(ctx) {
            ctx.writeBytes(this._TAG());
            const ctxPayload = new Context.StreamSerialization();
            this.serializePayload(ctxPayload);
            ctx.writeVarbytes(ctxPayload.getOutput());
        }

        compareTo(other) {
            const deltaTag = Utils.arrCompare(this._TAG(), other._TAG());
            if (deltaTag === 0) {
                // Compare URIs if they exist
                const myUri = this.uri || '';
                const otherUri = other.uri || '';
                if (myUri < otherUri) return -1;
                if (myUri > otherUri) return 1;
                return 0;
            }
            return deltaTag;
        }

        equals(other) {
            return other && other.constructor === this.constructor;
        }

        toString() {
            return this.constructor.name;
        }
    }

    // ================================================================
    // UNKNOWN ATTESTATION
    // ================================================================
    class UnknownAttestation extends TimeAttestation {
        constructor(tag, payload) {
            super();
            this._tag = tag;
            this.payload = payload || [];
        }

        _TAG() { return this._tag; }

        serializePayload(ctx) {
            ctx.writeBytes(this.payload);
        }

        static deserialize(ctxPayload, tag) {
            const payload = ctxPayload.readBytes(new TimeAttestation()._MAX_PAYLOAD_SIZE());
            return new UnknownAttestation(tag, payload);
        }

        toString() {
            return 'UnknownAttestation ' + Utils.bytesToHex(this._TAG()) + ' ' + Utils.bytesToHex(this.payload);
        }

        equals(other) {
            return other instanceof UnknownAttestation &&
                   Utils.arrEq(this._TAG(), other._TAG()) &&
                   Utils.arrEq(this.payload, other.payload);
        }

        compareTo(other) {
            if (other instanceof UnknownAttestation) {
                return Utils.arrCompare(this.payload, other.payload);
            }
            return super.compareTo(other);
        }
    }

    // ================================================================
    // PENDING ATTESTATION
    // ================================================================
    class PendingAttestation extends TimeAttestation {
        _TAG() {
            return [0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9, 0x0c, 0x8e];
        }

        _MAX_URI_LENGTH() { return 1000; }
        _ALLOWED_URI_CHARS() { return 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._/:'; }

        constructor(uri_) {
            super();
            this.uri = uri_ || '';
        }

        static checkUri(uri) {
            if (uri.length > new PendingAttestation()._MAX_URI_LENGTH()) {
                console.error('URI exceeds maximum length');
                return false;
            }
            const allowed = new PendingAttestation()._ALLOWED_URI_CHARS();
            for (let i = 0; i < uri.length; i++) {
                if (allowed.indexOf(uri[i]) < 0) {
                    console.error('URI contains invalid character: ' + uri[i]);
                    return false;
                }
            }
            return true;
        }

        static deserialize(ctxPayload) {
            const utf8Uri = ctxPayload.readVarbytes(new PendingAttestation()._MAX_URI_LENGTH());
            if (!this.checkUri(utf8Uri)) {
                throw new Error('Invalid URI');
            }
            // Convert bytes to string
            let uri = '';
            for (let i = 0; i < utf8Uri.length; i++) {
                uri += String.fromCharCode(utf8Uri[i]);
            }
            return new PendingAttestation(uri);
        }

        serializePayload(ctx) {
            const bytes = Utils.stringToBytes(this.uri);
            ctx.writeVarbytes(bytes);
        }

        toString() {
            return 'PendingAttestation(\'' + this.uri + '\')';
        }

        equals(other) {
            return other instanceof PendingAttestation &&
                   Utils.arrEq(this._TAG(), other._TAG()) &&
                   this.uri === other.uri;
        }

        compareTo(other) {
            if (other instanceof PendingAttestation) {
                if (this.uri < other.uri) return -1;
                if (this.uri > other.uri) return 1;
                return 0;
            }
            return super.compareTo(other);
        }
    }

    // ================================================================
    // BITCOIN BLOCK HEADER ATTESTATION
    // ================================================================
    class BitcoinBlockHeaderAttestation extends TimeAttestation {
        _TAG() {
            return [0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01];
        }

        constructor(height_) {
            super();
            this.height = height_ || 0;
        }

        static deserialize(ctxPayload) {
            const height = ctxPayload.readVaruint();
            return new BitcoinBlockHeaderAttestation(height);
        }

        serializePayload(ctx) {
            ctx.writeVaruint(this.height);
        }

        toString() {
            return 'BitcoinBlockHeaderAttestation(' + this.height + ')';
        }

        equals(other) {
            return other instanceof BitcoinBlockHeaderAttestation &&
                   Utils.arrEq(this._TAG(), other._TAG()) &&
                   this.height === other.height;
        }

        compareTo(other) {
            if (other instanceof BitcoinBlockHeaderAttestation) {
                return this.height - other.height;
            }
            return super.compareTo(other);
        }

        verifyAgainstBlockheader(digest, block) {
            if (digest.length !== 32) {
                throw new VerificationError('Expected digest with length 32 bytes; got ' + digest.length + ' bytes');
            }
            
            let merkleRoot;
            if (typeof block === 'object' && block.merkleroot) {
                merkleRoot = Utils.hexToBytes(block.merkleroot);
            } else if (typeof block === 'string') {
                merkleRoot = Utils.hexToBytes(block);
            } else if (block instanceof Uint8Array || Array.isArray(block)) {
                merkleRoot = block;
            } else {
                throw new VerificationError('Invalid block header');
            }

            if (!Utils.arrEq(digest, merkleRoot)) {
                throw new VerificationError('Digest does not match merkleroot');
            }
            
            return block.time || block.timestamp || 0;
        }
    }

    // ================================================================
    // LITECOIN BLOCK HEADER ATTESTATION
    // ================================================================
    class LitecoinBlockHeaderAttestation extends TimeAttestation {
        _TAG() {
            return [0x06, 0x86, 0x9a, 0x0d, 0x73, 0xd7, 0x1b, 0x45];
        }

        constructor(height_) {
            super();
            this.height = height_ || 0;
        }

        static deserialize(ctxPayload) {
            const height = ctxPayload.readVaruint();
            return new LitecoinBlockHeaderAttestation(height);
        }

        serializePayload(ctx) {
            ctx.writeVaruint(this.height);
        }

        toString() {
            return 'LitecoinBlockHeaderAttestation(' + this.height + ')';
        }

        equals(other) {
            return other instanceof LitecoinBlockHeaderAttestation &&
                   Utils.arrEq(this._TAG(), other._TAG()) &&
                   this.height === other.height;
        }

        compareTo(other) {
            if (other instanceof LitecoinBlockHeaderAttestation) {
                return this.height - other.height;
            }
            return super.compareTo(other);
        }

        verifyAgainstBlockheader(digest, block) {
            if (digest.length !== 32) {
                throw new VerificationError('Expected digest with length 32 bytes; got ' + digest.length + ' bytes');
            }
            
            let merkleRoot;
            if (typeof block === 'object' && block.merkleroot) {
                merkleRoot = Utils.hexToBytes(block.merkleroot);
            } else if (typeof block === 'string') {
                merkleRoot = Utils.hexToBytes(block);
            } else if (block instanceof Uint8Array || Array.isArray(block)) {
                merkleRoot = block;
            } else {
                throw new VerificationError('Invalid block header');
            }

            if (!Utils.arrEq(digest, merkleRoot)) {
                throw new VerificationError('Digest does not match merkleroot');
            }
            
            return block.time || block.timestamp || 0;
        }
    }

    // ================================================================
    // EXPORT
    // ================================================================
    const Notary = {
        VerificationError,
        TimeAttestation,
        UnknownAttestation,
        PendingAttestation,
        BitcoinBlockHeaderAttestation,
        LitecoinBlockHeaderAttestation
    };

    window.Notary = Notary;

})(typeof window !== 'undefined' ? window : this);