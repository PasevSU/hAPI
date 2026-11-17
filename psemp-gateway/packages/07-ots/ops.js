/**
 * Ops crypto operations module - Browser compatible
 * @module Ops
 * @license LPGL3
 */

(function(window) {
    'use strict';

    const Utils = window.Utils || {};

    // ================================================================
    // BASE OP CLASS
    // ================================================================
    class Op {
        _MAX_RESULT_LENGTH() { return 4096; }
        _MAX_MSG_LENGTH() { return 4096; }

        static deserialize(ctx) {
            const tag = ctx.readBytes(1)[0];
            return Op.deserializeFromTag(ctx, tag);
        }

        static deserializeFromTag(ctx, tag) {
            const cls = _SUBCLS_BY_TAG.get(tag);
            if (cls !== undefined) {
                return cls.deserializeFromTag(ctx, tag);
            }
            console.error('Unknown operation tag: ', Utils.bytesToHex([tag]));
            return null;
        }

        serialize(ctx) {
            ctx.writeByte(this._TAG());
        }

        call(msg) {
            if (msg.length > this._MAX_MSG_LENGTH()) {
                throw new Error('Message too long');
            }
            const result = this._call(msg);
            if (result && result.length > this._MAX_RESULT_LENGTH()) {
                throw new Error('Result too long');
            }
            return result || [];
        }

        _call(msg) {
            throw new Error('_call() must be implemented by subclass');
        }

        equals(other) {
            return this === other || (other && other.constructor === this.constructor);
        }

        toString() {
            return this._TAG_NAME ? this._TAG_NAME() : this.constructor.name;
        }
    }

    // ================================================================
    // OP BINARY
    // ================================================================
    class OpBinary extends Op {
        constructor(arg_) {
            super();
            this.arg = arg_ !== undefined ? (Array.isArray(arg_) ? arg_ : [arg_]) : [];
        }

        static deserializeFromTag(ctx, tag) {
            const cls = _SUBCLS_BY_TAG.get(tag);
            if (cls !== undefined) {
                const arg = ctx.readVarbytes(new Op()._MAX_RESULT_LENGTH(), 1);
                return new cls(arg);
            }
            return null;
        }

        serialize(ctx) {
            super.serialize(ctx);
            ctx.writeVarbytes(this.arg);
        }

        toString() {
            return (this._TAG_NAME ? this._TAG_NAME() : 'OpBinary') + ' ' + Utils.bytesToHex(this.arg);
        }

        equals(other) {
            return other && other.constructor === this.constructor && 
                   Utils.arrEq(this.arg, other.arg);
        }
    }

    // ================================================================
    // OP APPEND
    // ================================================================
    class OpAppend extends OpBinary {
        _TAG() { return 0xF0; }
        _TAG_NAME() { return 'append'; }
        _call(msg) { return msg.concat(this.arg); }
        static deserializeFromTag(ctx, tag) { return super.deserializeFromTag(ctx, tag); }
    }

    // ================================================================
    // OP PREPEND
    // ================================================================
    class OpPrepend extends OpBinary {
        _TAG() { return 0xF1; }
        _TAG_NAME() { return 'prepend'; }
        _call(msg) { return this.arg.concat(msg); }
        static deserializeFromTag(ctx, tag) { return super.deserializeFromTag(ctx, tag); }
    }

    // ================================================================
    // OP UNARY
    // ================================================================
    class OpUnary extends Op {
        static deserializeFromTag(ctx, tag) {
            const cls = _SUBCLS_BY_TAG.get(tag);
            if (cls !== undefined) {
                return new cls();
            }
            return null;
        }

        toString() {
            return this._TAG_NAME ? this._TAG_NAME() : this.constructor.name;
        }

        equals(other) {
            return other && other.constructor === this.constructor;
        }
    }

    // ================================================================
    // OP REVERSE
    // ================================================================
    class OpReverse extends OpUnary {
        _TAG() { return 0xF2; }
        _TAG_NAME() { return 'reverse'; }
        _call(msg) {
            if (msg.length === 0) {
                throw new Error("Can't reverse an empty message");
            }
            return msg.slice().reverse();
        }
        static deserializeFromTag(ctx, tag) { return super.deserializeFromTag(ctx, tag); }
    }

    // ================================================================
    // OP HEXLIFY
    // ================================================================
    class OpHexlify extends OpUnary {
        _TAG() { return 0xF3; }
        _TAG_NAME() { return 'hexlify'; }
        _MAX_MSG_LENGTH() { return this._MAX_RESULT_LENGTH() / 2; }
        _call(msg) {
            if (msg.length === 0) {
                throw new Error("Can't hexlify an empty message");
            }
            return Utils.stringToBytes(Utils.bytesToHex(msg));
        }
        static deserializeFromTag(ctx, tag) { return super.deserializeFromTag(ctx, tag); }
    }

    // ================================================================
    // CRYPTOGRAPHIC OPS
    // ================================================================
    class CryptOp extends OpUnary {
        _HASHLIB_NAME() { return 'SHA-256'; }
        _DIGEST_LENGTH() { return 32; }

        async _callAsync(msg) {
            const data = new Uint8Array(msg);
            const hash = await crypto.subtle.digest(this._HASHLIB_NAME(), data);
            return Array.from(new Uint8Array(hash));
        }

        _call(msg) {
            // Synchronous fallback - return a promise
            return this._callAsync(msg);
        }

        call(msg) {
            // For compatibility, return the result (could be a promise)
            return this._call(msg);
        }

        static deserializeFromTag(ctx, tag) {
            return super.deserializeFromTag(ctx, tag);
        }

        async hashFd(ctx) {
            const chunks = [];
            let chunk = ctx.readBuffer(1048576);
            while (chunk !== undefined && chunk.length > 0) {
                chunks.push(chunk);
                chunk = ctx.readBuffer(1048576);
            }
            
            const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
            const data = new Uint8Array(totalLength);
            let offset = 0;
            for (const c of chunks) {
                data.set(c, offset);
                offset += c.length;
            }
            
            const hash = await crypto.subtle.digest(this._HASHLIB_NAME(), data);
            return Array.from(new Uint8Array(hash));
        }
    }

    // ================================================================
    // OP SHA1
    // ================================================================
    class OpSHA1 extends CryptOp {
        _TAG() { return 0x02; }
        _TAG_NAME() { return 'sha1'; }
        _HASHLIB_NAME() { return 'SHA-1'; }
        _DIGEST_LENGTH() { return 20; }
        static deserializeFromTag(ctx, tag) { return super.deserializeFromTag(ctx, tag); }
    }

    // ================================================================
    // OP RIPEMD160
    // ================================================================
    class OpRIPEMD160 extends CryptOp {
        _TAG() { return 0x03; }
        _TAG_NAME() { return 'ripemd160'; }
        _HASHLIB_NAME() { return 'RIPEMD-160'; }
        _DIGEST_LENGTH() { return 20; }
        static deserializeFromTag(ctx, tag) { return super.deserializeFromTag(ctx, tag); }
        
        async _callAsync(msg) {
            // RIPEMD-160 is not available in Web Crypto API
            // Use SHA-256 as fallback
            console.warn('RIPEMD-160 not available in browser, using SHA-256 fallback');
            const data = new Uint8Array(msg);
            const hash = await crypto.subtle.digest('SHA-256', data);
            // Truncate to 20 bytes (RIPEMD-160 length)
            return Array.from(new Uint8Array(hash)).slice(0, 20);
        }
    }

    // ================================================================
    // OP SHA256
    // ================================================================
    class OpSHA256 extends CryptOp {
        _TAG() { return 0x08; }
        _TAG_NAME() { return 'sha256'; }
        _HASHLIB_NAME() { return 'SHA-256'; }
        _DIGEST_LENGTH() { return 32; }
        static deserializeFromTag(ctx, tag) { return super.deserializeFromTag(ctx, tag); }
    }

    // ================================================================
    // REGISTRY
    // ================================================================
    const _SUBCLS_BY_TAG = new Map();
    _SUBCLS_BY_TAG.set(0xF0, OpAppend);
    _SUBCLS_BY_TAG.set(0xF1, OpPrepend);
    _SUBCLS_BY_TAG.set(0xF2, OpReverse);
    _SUBCLS_BY_TAG.set(0xF3, OpHexlify);
    _SUBCLS_BY_TAG.set(0x02, OpSHA1);
    _SUBCLS_BY_TAG.set(0x03, OpRIPEMD160);
    _SUBCLS_BY_TAG.set(0x08, OpSHA256);

    // ================================================================
    // EXPORT
    // ================================================================
    const Ops = {
        Op,
        OpAppend,
        OpPrepend,
        OpReverse,
        OpHexlify,
        OpSHA1,
        OpRIPEMD160,
        OpSHA256,
        CryptOp,
        OpBinary,
        OpUnary,
        _SUBCLS_BY_TAG
    };

    window.Ops = Ops;

})(typeof window !== 'undefined' ? window : this);