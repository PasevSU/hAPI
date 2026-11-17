/**
 * Timestamp module - Browser compatible
 * @module Timestamp
 * @license LPGL3
 */

(function(window) {
    'use strict';

    const Utils = window.Utils || {};
    const Ops = window.Ops || {};
    const Notary = window.Notary || {};
    const Context = window.Context || {};

    // ================================================================
    // TIMESTAMP CLASS
    // ================================================================
    class Timestamp {
        constructor(msg) {
            if (!msg || !Array.isArray(msg)) {
                throw new TypeError('Expected msg to be bytes; got ' + typeof msg);
            }
            if (msg.length > (new Ops.Op())._MAX_MSG_LENGTH()) {
                throw new TypeError('Message exceeds Op length limit; ' + msg.length + 
                    ' > ' + (new Ops.Op())._MAX_MSG_LENGTH());
            }
            this.msg = msg;
            this.attestations = [];
            this.ops = new Map();
        }

        getDigest() {
            return this.msg;
        }

        static deserialize(ctx, initialMsg) {
            const self = new Timestamp(initialMsg);

            function doTagOrAttestation(tag, initialMsg) {
                if (tag === 0x00) {
                    const attestation = Notary.TimeAttestation.deserialize(ctx);
                    self.attestations.push(attestation);
                } else {
                    const op = Ops.Op.deserializeFromTag(ctx, tag);
                    if (!op) {
                        throw new Error('Unknown operation tag: ' + tag);
                    }
                    const result = op.call(initialMsg);
                    // Handle async result
                    if (result && result.then) {
                        result.then(r => {
                            const stamp = Timestamp.deserialize(ctx, r);
                            self.ops.set(op, stamp);
                        });
                    } else {
                        const stamp = Timestamp.deserialize(ctx, result);
                        self.ops.set(op, stamp);
                    }
                }
            }

            let tag = ctx.readBytes(1)[0];
            while (tag === 0xFF) {
                const current = ctx.readBytes(1)[0];
                doTagOrAttestation(current, initialMsg);
                tag = ctx.readBytes(1)[0];
            }
            doTagOrAttestation(tag, initialMsg);

            return self;
        }

        serialize(ctx) {
            if (!this.attestations && !this.ops) {
                throw new Context.ValueError("An empty timestamp can't be serialized");
            }

            const sortedAttestations = this.attestations.slice();
            sortedAttestations.sort((a, b) => a.compareTo && b.compareTo ? a.compareTo(b) : 0);

            if (sortedAttestations.length > 1) {
                for (let i = 0; i < sortedAttestations.length - 1; i++) {
                    ctx.writeBytes([0xFF, 0x00]);
                    if (sortedAttestations[i].serialize) {
                        sortedAttestations[i].serialize(ctx);
                    }
                }
            }

            if (this.ops.size === 0) {
                if (sortedAttestations.length > 0) {
                    ctx.writeByte(0x00);
                    if (sortedAttestations[sortedAttestations.length - 1].serialize) {
                        sortedAttestations[sortedAttestations.length - 1].serialize(ctx);
                    }
                }
            } else {
                if (sortedAttestations.length > 0) {
                    ctx.writeBytes([0xFF, 0x00]);
                    if (sortedAttestations[sortedAttestations.length - 1].serialize) {
                        sortedAttestations[sortedAttestations.length - 1].serialize(ctx);
                    }
                }

                let index = 0;
                this.ops.forEach((stamp, op) => {
                    if (index < this.ops.size - 1) {
                        ctx.writeBytes([0xFF]);
                        index++;
                    }
                    if (op.serialize) op.serialize(ctx);
                    if (stamp.serialize) stamp.serialize(ctx);
                });
            }
        }

        merge(other) {
            if (!(other instanceof Timestamp)) {
                throw new Context.ValueError('Can only merge Timestamps together');
            }
            if (!Utils.arrEq(this.msg, other.msg)) {
                throw new Context.ValueError("Can't merge timestamps for different messages together");
            }

            for (const attestation of other.attestations) {
                this.attestations.push(attestation);
            }

            other.ops.forEach((otherOpStamp, otherOp) => {
                let ourOpStamp = this.ops.get(otherOp);
                if (ourOpStamp === undefined) {
                    const result = otherOp.call(this.msg);
                    if (result && result.then) {
                        result.then(r => {
                            ourOpStamp = new Timestamp(r);
                            this.ops.set(otherOp, ourOpStamp);
                            ourOpStamp.merge(otherOpStamp);
                        });
                    } else {
                        ourOpStamp = new Timestamp(result);
                        this.ops.set(otherOp, ourOpStamp);
                        ourOpStamp.merge(otherOpStamp);
                    }
                } else {
                    ourOpStamp.merge(otherOpStamp);
                }
            });
        }

        allAttestations() {
            const map = new Map();
            for (const attestation of this.attestations) {
                map.set(this.msg, attestation);
            }
            for (const opStamp of this.ops.values()) {
                const subMap = opStamp.allAttestations();
                for (const [msg, att] of subMap) {
                    map.set(msg, att);
                }
            }
            return map;
        }

        toString(indent = 0) {
            let output = '';
            output += this._indent(indent) + 'msg: ' + Utils.bytesToHex(this.msg) + '\n';
            output += this._indent(indent) + this.attestations.length + ' attestations: \n';
            let i = 0;
            for (const attestation of this.attestations) {
                output += this._indent(indent) + '[' + i + '] ' + (attestation.toString ? attestation.toString() : String(attestation)) + '\n';
                i++;
            }

            i = 0;
            output += this._indent(indent) + this.ops.size + ' ops: \n';
            for (const [op, stamp] of this.ops) {
                output += this._indent(indent) + '[' + i + '] op: ' + (op.toString ? op.toString() : String(op)) + '\n';
                output += this._indent(indent) + '[' + i + '] timestamp: \n';
                output += stamp.toString(indent + 1);
                i++;
            }
            return output;
        }

        toJson(fork = 0) {
            const json = {};
            
            if (this.attestations.length > 0) {
                json.attestations = [];
                for (const attestation of this.attestations) {
                    const item = { fork };
                    if (attestation instanceof Notary.PendingAttestation) {
                        item.type = 'PendingAttestation';
                        item.param = attestation.uri;
                    } else if (attestation instanceof Notary.UnknownAttestation) {
                        item.type = 'UnknownAttestation';
                        item.param = attestation.payload;
                    } else if (attestation instanceof Notary.BitcoinBlockHeaderAttestation) {
                        item.type = 'BitcoinBlockHeaderAttestation';
                        item.param = attestation.height;
                        item.merkle = Utils.bytesToHex(this.msg.slice().reverse());
                    } else if (attestation instanceof Notary.LitecoinBlockHeaderAttestation) {
                        item.type = 'LitecoinBlockHeaderAttestation';
                        item.param = attestation.height;
                        item.merkle = Utils.bytesToHex(this.msg.slice().reverse());
                    }
                    json.attestations.push(item);
                }
            }

            json.result = Utils.bytesToHex(this.msg);

            if (this.ops.size > 1) fork++;
            if (this.ops.size > 0) {
                json.ops = [];
                let count = 0;
                for (const [op, timestamp] of this.ops) {
                    const item = {
                        fork: fork + count,
                        op: op._TAG_NAME ? op._TAG_NAME() : op.constructor.name,
                        arg: op.arg !== undefined ? Utils.bytesToHex(op.arg) : '',
                        result: Utils.bytesToHex(timestamp.msg),
                        timestamp: timestamp.toJson(fork + count)
                    };
                    json.ops.push(item);
                    count++;
                }
            }
            return json;
        }

        _indent(pos) {
            let r = '';
            for (let i = 0; i < pos; i++) {
                r += '    ';
            }
            return r;
        }

        static indention(pos) {
            let r = '';
            for (let i = 0; i < pos; i++) {
                r += '    ';
            }
            return r;
        }

        strTree(indent = 0, verbosity = 0) {
            let r = '';
            
            if (this.attestations.length > 0) {
                for (const attestation of this.attestations) {
                    r += this._indent(indent) + 'verify ' + (attestation.toString ? attestation.toString() : String(attestation));
                    if (verbosity > 0) {
                        r += ' == ' + Utils.bytesToHex(this.msg);
                    }
                    r += '\n';
                    if (attestation instanceof Notary.BitcoinBlockHeaderAttestation) {
                        const tx = Utils.bytesToHex(new Ops.OpReverse().call(this.msg));
                        r += this._indent(indent) + '# Bitcoin block merkle root ' + tx + '\n';
                    }
                    if (attestation instanceof Notary.LitecoinBlockHeaderAttestation) {
                        const tx = Utils.bytesToHex(new Ops.OpReverse().call(this.msg));
                        r += this._indent(indent) + '# Litecoin block merkle root ' + tx + '\n';
                    }
                }
            }

            if (this.ops.size > 1) {
                for (const [op, timestamp] of this.ops) {
                    const curRes = op.call(this.msg);
                    r += this._indent(indent) + ' -> ' + (op.toString ? op.toString() : String(op));
                    if (verbosity > 0 && curRes !== undefined) {
                        if (curRes && curRes.then) {
                            r += ' == [async]';
                        } else {
                            r += ' == ' + Utils.bytesToHex(curRes);
                        }
                    }
                    r += '\n';
                    r += timestamp.strTree(indent + 1, verbosity);
                }
            } else if (this.ops.size > 0) {
                const op = this.ops.keys().next().value;
                const stamp = this.ops.values().next().value;
                const curRes = op.call(this.msg);
                r += this._indent(indent) + (op.toString ? op.toString() : String(op));
                if (verbosity > 0 && curRes !== undefined) {
                    if (curRes && curRes.then) {
                        r += ' == [async]';
                    } else {
                        r += ' == ' + Utils.bytesToHex(curRes);
                    }
                }
                r += '\n';
                r += stamp.strTree(indent, verbosity);
            }
            return r;
        }

        directlyVerified() {
            if (this.attestations.length > 0) {
                return [this];
            }
            let array = [];
            for (const value of this.ops.values()) {
                const result = value.directlyVerified();
                array = array.concat(result);
            }
            return array;
        }

        getAttestations() {
            const set = new Set();
            for (const [msg, att] of this.allAttestations()) {
                set.add(att);
            }
            return set;
        }

        isTimestampComplete() {
            let found = false;
            for (const [msg, att] of this.allAttestations()) {
                if (att instanceof Notary.BitcoinBlockHeaderAttestation ||
                    att instanceof Notary.LitecoinBlockHeaderAttestation ||
                    att instanceof Notary.UnknownAttestation) {
                    found = true;
                }
            }
            return found;
        }

        equals(another) {
            if (!(another instanceof Timestamp)) return false;
            if (!Utils.arrEq(this.getDigest(), another.getDigest())) return false;
            if (this.getAttestations().size !== another.getAttestations().size) return false;
            if (this.attestations.length !== another.attestations.length) return false;

            for (let i = 0; i < this.attestations.length; i++) {
                const a1 = this.attestations[i];
                const a2 = another.attestations[i];
                if (a1.equals && !a1.equals(a2)) return false;
            }

            if (this.ops.size !== another.ops.size) return false;

            const keys1 = Array.from(this.ops.keys());
            const keys2 = Array.from(another.ops.keys());
            for (let i = 0; i < keys1.length; i++) {
                if (keys1[i].equals && !keys1[i].equals(keys2[i])) return false;
            }

            const vals1 = Array.from(this.ops.values());
            const vals2 = Array.from(another.ops.values());
            for (let i = 0; i < vals1.length; i++) {
                if (!vals1[i].equals(vals2[i])) return false;
            }

            return true;
        }

        add(op) {
            if (this.ops.has(op)) {
                return this.ops.get(op);
            }
            const stamp = new Timestamp(op.call(this.msg));
            this.ops.set(op, stamp);
            return stamp;
        }

        allTips() {
            const set = new Set();
            if (this.ops.size === 0) {
                set.add(this.msg);
            }
            for (const stamp of this.ops.values()) {
                const subSet = stamp.allTips();
                for (const msg of subSet) {
                    set.add(msg);
                }
            }
            return set;
        }
    }

    // ================================================================
    // EXPORT
    // ================================================================
    window.Timestamp = Timestamp;

})(typeof window !== 'undefined' ? window : this);