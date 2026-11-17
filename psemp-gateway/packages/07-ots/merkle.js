/**
 * Merkle module - Browser compatible
 * @module Merkle
 * @license LPGL3
 */

(function(window) {
    'use strict';

    const Timestamp = window.Timestamp;
    const Ops = window.Ops;

    class Merkle {
        static catThenUnaryOp(UnaryOpCls, left, right) {
            if (!(left instanceof Timestamp)) {
                left = new Timestamp(left);
            }
            if (!(right instanceof Timestamp)) {
                right = new Timestamp(right);
            }

            const rightPrependStamp = right.add(new Ops.OpPrepend(left.msg));
            left.ops.set(new Ops.OpAppend(right.msg), rightPrependStamp);
            const res = rightPrependStamp.add(new Ops.OpSHA256());
            return res;
        }

        static catSha256(left, right) {
            return Merkle.catThenUnaryOp(Ops.OpSHA256, left, right);
        }

        static catSha256d(left, right) {
            const sha256Timestamp = Merkle.catSha256(left, right);
            const opSHA256 = new Ops.OpSHA256();
            let res = sha256Timestamp.ops.get(opSHA256);
            if (res === undefined) {
                res = new Timestamp(opSHA256.call(sha256Timestamp.msg));
                sha256Timestamp.ops.set(opSHA256, res);
            }
            return res;
        }

        static makeMerkleTreeIterator(timestamps) {
            let stamps = timestamps;
            let nextStamps = [];
            let prevStamp;

            do {
                stamps = stamps[Symbol.iterator]();

                prevStamp = undefined;
                try {
                    prevStamp = stamps.next().value;
                } catch (err) {
                    return 'Need at least one timestamp';
                }

                nextStamps = [];
                for (const stamp of stamps) {
                    if (prevStamp === undefined) {
                        prevStamp = stamp;
                    } else {
                        nextStamps.push(Merkle.catSha256(prevStamp, stamp));
                        prevStamp = undefined;
                    }
                }

                if (nextStamps.length > 0) {
                    if (prevStamp !== undefined) {
                        nextStamps.push(prevStamp);
                    }
                    stamps = nextStamps;
                }
            } while (nextStamps.length > 0);
            return prevStamp;
        }

        static makeMerkleTree(timestamps) {
            let stamps = timestamps;
            let prevStamp;
            let exit = false;

            while (!exit) {
                prevStamp = stamps[0];
                const subStamps = stamps.slice(1, stamps.length);

                const nextStamps = [];
                for (const stamp of subStamps) {
                    if (prevStamp === undefined) {
                        prevStamp = stamp;
                    } else {
                        nextStamps.push(Merkle.catSha256(prevStamp, stamp));
                        prevStamp = undefined;
                    }
                }

                if (nextStamps.length === 0) {
                    exit = true;
                } else {
                    if (prevStamp !== undefined) {
                        nextStamps.push(prevStamp);
                    }
                    stamps = nextStamps;
                }
            }
            return prevStamp;
        }
    }

    window.Merkle = Merkle;

})(typeof window !== 'undefined' ? window : this);