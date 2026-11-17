/**
 * Detached Timestamp File module - Browser compatible
 * @module DetachedTimestampFile
 * @license LPGL3
 */

(function(window) {
    'use strict';

    const Ops = window.Ops || {};
    const Timestamp = window.Timestamp || {};
    const Utils = window.Utils || {};
    const Context = window.Context || {};

    const HEADER_MAGIC = [0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00, 0x00, 0x50, 0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94];
    const MAJOR_VERSION = 1;

    class DetachedTimestampFile {
        constructor(fileHashOp, timestamp) {
            if (!(fileHashOp instanceof Ops.Op) || !(timestamp instanceof Timestamp)) {
                throw new Context.ValueError('Invalid Timestamp or fileHashOp');
            }
            if (timestamp.msg.length !== fileHashOp._DIGEST_LENGTH()) {
                throw new Context.ValueError('Timestamp message length and fileHashOp digest length differ');
            }
            this.fileHashOp = fileHashOp;
            this.timestamp = timestamp;
        }

        fileDigest() {
            return this.timestamp.msg;
        }

        serialize(ctx) {
            ctx.writeBytes(HEADER_MAGIC);
            ctx.writeVaruint(MAJOR_VERSION);
            this.fileHashOp.serialize(ctx);
            ctx.writeBytes(this.timestamp.msg);
            this.timestamp.serialize(ctx);
        }

        serializeToBytes() {
            const ctx = new Context.StreamSerialization();
            this.serialize(ctx);
            return ctx.getOutput();
        }

        static deserialize(buffer) {
            let ctx;
            if (buffer instanceof Context.StreamDeserialization) {
                ctx = buffer;
            } else if (Array.isArray(buffer)) {
                ctx = new Context.StreamDeserialization(buffer);
            } else if (buffer instanceof Uint8Array) {
                ctx = new Context.StreamDeserialization(Array.from(buffer));
            } else if (buffer instanceof ArrayBuffer) {
                ctx = new Context.StreamDeserialization(Array.from(new Uint8Array(buffer)));
            } else if (typeof buffer === 'string') {
                const bytes = Utils.hexToBytes(buffer);
                ctx = new Context.StreamDeserialization(bytes);
            } else {
                throw new Error('DetachedTimestampFile.deserialize: Invalid param');
            }

            ctx.assertMagic(HEADER_MAGIC);
            const major = ctx.readVaruint();
            if (major !== MAJOR_VERSION) {
                throw new Context.UnsupportedMajorVersion('Version ' + major + ' detached timestamp files are not supported');
            }

            const fileHashOp = Ops.CryptOp.deserialize(ctx);
            if (!fileHashOp) {
                throw new Error('Failed to deserialize fileHashOp');
            }
            const fileHash = ctx.readBytes(fileHashOp._DIGEST_LENGTH());
            const timestamp = Timestamp.deserialize(ctx, fileHash);

            ctx.assertEof();
            return new DetachedTimestampFile(fileHashOp, timestamp);
        }

        static async fromBytes(fileHashOp, buffer) {
            if (!(fileHashOp instanceof Ops.Op)) {
                throw new Error('DetachedTimestampFile: Invalid fileHashOp param');
            }

            let fdHash;
            if (buffer instanceof Context.StreamDeserialization) {
                fdHash = await fileHashOp.hashFd(buffer);
            } else if (Array.isArray(buffer)) {
                const ctx = new Context.StreamDeserialization(buffer);
                fdHash = await fileHashOp.hashFd(ctx);
            } else if (buffer instanceof Uint8Array) {
                const ctx = new Context.StreamDeserialization(Array.from(buffer));
                fdHash = await fileHashOp.hashFd(ctx);
            } else if (buffer instanceof ArrayBuffer) {
                const ctx = new Context.StreamDeserialization(Array.from(new Uint8Array(buffer)));
                fdHash = await fileHashOp.hashFd(ctx);
            } else if (typeof buffer === 'string') {
                const bytes = Utils.hexToBytes(buffer);
                const ctx = new Context.StreamDeserialization(bytes);
                fdHash = await fileHashOp.hashFd(ctx);
            } else {
                throw new Error('DetachedTimestampFile: Invalid buffer param');
            }

            return new DetachedTimestampFile(fileHashOp, new Timestamp(fdHash));
        }

        static fromHash(fileHashOp, fdHash) {
            if (!(fileHashOp instanceof Ops.Op)) {
                throw new Error('DetachedTimestampFile: Invalid fileHashOp param');
            }
            if (Array.isArray(fdHash)) {
                return new DetachedTimestampFile(fileHashOp, new Timestamp(fdHash));
            } else if (fdHash instanceof ArrayBuffer || fdHash instanceof Uint8Array) {
                return new DetachedTimestampFile(fileHashOp, new Timestamp(Array.from(fdHash)));
            } else if (typeof fdHash === 'string') {
                const bytes = Utils.hexToBytes(fdHash);
                return new DetachedTimestampFile(fileHashOp, new Timestamp(bytes));
            } else {
                throw new Error('DetachedTimestampFile: Invalid fdHash param');
            }
        }

        toString() {
            let output = 'DetachedTimestampFile\n';
            output += 'fileHashOp: ' + (this.fileHashOp.toString ? this.fileHashOp.toString() : String(this.fileHashOp)) + '\n';
            output += 'timestamp: ' + (this.timestamp.toString ? this.timestamp.toString() : String(this.timestamp)) + '\n';
            return output;
        }

        toJson() {
            const json = {
                hash: Utils.bytesToHex(this.fileDigest()),
                op: this.fileHashOp._HASHLIB_NAME ? this.fileHashOp._HASHLIB_NAME() : this.fileHashOp.constructor.name
            };
            if (this.timestamp.toJson) {
                json.timestamp = this.timestamp.toJson();
            }
            return json;
        }

        equals(another) {
            if (!(another instanceof DetachedTimestampFile)) return false;
            if (!(another.fileHashOp.equals(this.fileHashOp))) return false;
            if (!(another.timestamp.equals(this.timestamp))) return false;
            return true;
        }
    }

    window.DetachedTimestampFile = DetachedTimestampFile;

})(typeof window !== 'undefined' ? window : this);