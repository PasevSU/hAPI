/**
 * OpenTimestamps module - Browser compatible
 * @module OpenTimestamps
 * @license LPGL3
 */

(function(window) {
    'use strict';

    const Utils = window.Utils || {};
    const Context = window.Context || {};
    const DetachedTimestampFile = window.DetachedTimestampFile || {};
    const Timestamp = window.Timestamp || {};
    const Ops = window.Ops || {};
    const Calendar = window.Calendar || {};
    const Notary = window.Notary || {};
    const Esplora = window.Esplora || {};
    const Merkle = window.Merkle || {};

    // ================================================================
    // OPEN TIMESTAMPS API
    // ================================================================
    const OpenTimestamps = {

        info(detached, options) {
            if (!(detached instanceof DetachedTimestampFile)) {
                console.error('Invalid input');
                return 'Invalid input';
            }

            const timestamp = detached.timestamp;
            const hashOp = detached.fileHashOp._HASHLIB_NAME ? detached.fileHashOp._HASHLIB_NAME() : 'unknown';
            const fileHash = Utils.bytesToHex(detached.fileDigest());
            let output = 'File ' + hashOp + ' hash: ' + fileHash + '\n';

            try {
                if (options && options.verbose) {
                    output += 'Timestamp:\n' + timestamp.strTree(0, 1);
                } else {
                    output += 'Timestamp:\n' + timestamp.strTree(0, 0);
                }
                return output;
            } catch (err) {
                return 'Error parsing info ' + err;
            }
        },

        json(ots) {
            const json = {};
            if (!ots) {
                json.result = 'KO';
                json.error = 'No ots file';
                return JSON.stringify(json);
            }

            let timestamp;
            if (ots instanceof Timestamp) {
                timestamp = ots;
                json.hash = Utils.bytesToHex(timestamp.msg);
            } else {
                try {
                    const ctx = new Context.StreamDeserialization(ots);
                    const detached = DetachedTimestampFile.deserialize(ctx);
                    timestamp = detached.timestamp;
                    json.hash = Utils.bytesToHex(timestamp.msg);
                    json.op = detached.fileHashOp._HASHLIB_NAME ? detached.fileHashOp._HASHLIB_NAME() : 'unknown';
                } catch (err) {
                    json.result = 'KO';
                    json.error = 'Error deserialization ' + err;
                    return JSON.stringify(json);
                }
            }

            try {
                json.result = 'OK';
                json.timestamp = timestamp.toJson();
            } catch (err) {
                json.result = 'KO';
                json.error = 'Error parsing info ' + err;
            }
            return JSON.stringify(json);
        },

        async stamp(detaches, options = {}) {
            let detachedList;
            if (detaches instanceof DetachedTimestampFile) {
                detachedList = [detaches];
            } else if (Array.isArray(detaches)) {
                detachedList = detaches;
            } else {
                throw new Error('Invalid input');
            }

            const merkleTip = this.makeMerkleTree(detachedList);
            if (!merkleTip) {
                throw new Error('Invalid input');
            }

            if (!options.calendars || options.calendars.length === 0) {
                options.calendars = Calendar.DEFAULT_AGGREGATORS;
            }
            if (!options.m || options.m === 0) {
                options.m = options.calendars.length >= 2 ? 2 : 1;
            }
            if (options.m < 0 || options.m > options.calendars.length) {
                throw new Error('m cannot be greater than available calendar');
            }

            const timestamp = await this.createTimestamp(merkleTip, options.calendars, options.m);
            if (!timestamp) {
                throw new Error('Error on timestamp creation');
            }
            return timestamp;
        },

        async createTimestamp(timestamp, calendars, m) {
            const promises = [];
            for (const calendarUrl of calendars) {
                const remote = new Calendar.RemoteCalendar(calendarUrl);
                promises.push(remote.submit(timestamp.msg));
                console.log('Submitting to remote calendar ' + calendarUrl);
            }

            const results = await Promise.allSettled(promises);
            for (const result of results) {
                if (result.status === 'fulfilled' && result.value) {
                    timestamp.merge(result.value);
                }
            }
            return timestamp;
        },

        makeMerkleTree(fileTimestamps) {
            const merkleRoots = [];
            for (const fileTimestamp of fileTimestamps) {
                if (!(fileTimestamp instanceof DetachedTimestampFile)) {
                    console.error('Invalid input');
                    return undefined;
                }
                try {
                    const bytesRandom16 = Utils.randBytes(16);
                    const nonceAppendedStamp = fileTimestamp.timestamp.add(new Ops.OpAppend(Utils.arrayToBytes(bytesRandom16)));
                    const merkleRoot = nonceAppendedStamp.add(new Ops.OpSHA256());
                    merkleRoots.push(merkleRoot);
                } catch (err) {
                    return undefined;
                }
            }
            return Merkle.makeMerkleTree(merkleRoots);
        },

        async verify(detachedStamped, detachedOriginal, options = {}) {
            if (!Utils.arrEq(detachedStamped.fileDigest(), detachedOriginal.fileDigest())) {
                throw new Error('File does not match original!');
            }

            await this.upgradeTimestamp(detachedStamped.timestamp, options);
            return await this.verifyTimestamp(detachedStamped.timestamp, options);
        },

        async verifyTimestamp(timestamp, options = {}) {
            const results = [];
            const allAttestations = timestamp.allAttestations();
            
            for (const [msg, attestation] of allAttestations) {
                try {
                    const result = await this.verifyAttestation(attestation, msg, options);
                    if (result) results.push(result);
                } catch (err) {
                    // Skip failed attestations
                }
            }

            if (results.length === 0) {
                throw new Notary.VerificationError('No valid attestations found');
            }

            // Group by chain and find earliest attestation
            const grouped = {};
            for (const r of results) {
                if (!grouped[r.chain]) grouped[r.chain] = [];
                grouped[r.chain].push(r);
            }

            const output = {};
            for (const [chain, items] of Object.entries(grouped)) {
                const earliest = items.reduce((a, b) => a.attestedTime < b.attestedTime ? a : b);
                output[chain] = { timestamp: earliest.attestedTime, height: earliest.height };
            }
            return output;
        },

        async verifyAttestation(attestation, msg, options = {}) {
            if (attestation instanceof Notary.PendingAttestation) {
                throw new Error('PendingAttestation');
            }
            if (attestation instanceof Notary.UnknownAttestation) {
                throw new Error('UnknownAttestation');
            }

            if (attestation instanceof Notary.BitcoinBlockHeaderAttestation) {
                // Use Esplora for verification
                const esplora = new Esplora(options);
                try {
                    const blockHash = await esplora.blockhash(attestation.height);
                    const blockHeader = await esplora.block(blockHash);
                    const attestedTime = attestation.verifyAgainstBlockheader(
                        msg.slice().reverse(), 
                        blockHeader
                    );
                    return {
                        attestedTime: attestedTime,
                        chain: 'bitcoin',
                        height: attestation.height
                    };
                } catch (err) {
                    throw new Notary.VerificationError('Bitcoin verification failed: ' + err.message);
                }
            }

            if (attestation instanceof Notary.LitecoinBlockHeaderAttestation) {
                // Litecoin via Esplora
                const esplora = new Esplora({
                    url: 'https://litecoin.space/api',
                    ...options
                });
                try {
                    const blockHash = await esplora.blockhash(attestation.height);
                    const blockHeader = await esplora.block(blockHash);
                    const attestedTime = attestation.verifyAgainstBlockheader(
                        msg.slice().reverse(),
                        blockHeader
                    );
                    return {
                        attestedTime: attestedTime,
                        chain: 'litecoin',
                        height: attestation.height
                    };
                } catch (err) {
                    throw new Notary.VerificationError('Litecoin verification failed: ' + err.message);
                }
            }

            throw new Error('Unsupported attestation type');
        },

        async upgrade(detached, options = {}) {
            const changed = await this.upgradeTimestamp(detached.timestamp, options);
            return changed;
        },

        async upgradeTimestamp(timestamp, options = {}) {
            if (!options.whitelist) {
                options.whitelist = Calendar.DEFAULT_CALENDAR_WHITELIST;
            }

            const existingAttestations = timestamp.getAttestations();
            const promises = [];

            for (const subStamp of timestamp.directlyVerified()) {
                for (const attestation of subStamp.attestations) {
                    if (attestation instanceof Notary.PendingAttestation) {
                        if (subStamp.isTimestampComplete()) continue;

                        let calendars = [];
                        if (options.calendars && options.calendars.length > 0) {
                            calendars = options.calendars;
                        } else if (options.whitelist.contains(attestation.uri)) {
                            calendars.push(attestation.uri);
                        }

                        const commitment = subStamp.msg;
                        for (const calendarUrl of calendars) {
                            const calendar = new Calendar.RemoteCalendar(calendarUrl);
                            promises.push(this.upgradeStamp(subStamp, calendar, commitment, existingAttestations));
                        }
                    }
                }
            }

            const results = await Promise.allSettled(promises);
            let changed = false;
            for (const result of results) {
                if (result.status === 'fulfilled' && result.value) {
                    const { subStamp, upgradedStamp } = result.value;
                    if (subStamp && upgradedStamp) {
                        subStamp.merge(upgradedStamp);
                        changed = true;
                    }
                }
            }
            return changed;
        },

        async upgradeStamp(subStamp, calendar, commitment, existingAttestations) {
            try {
                const upgradedStamp = await calendar.getTimestamp(commitment);
                const attsFromRemote = upgradedStamp.getAttestations();
                
                if (attsFromRemote.size > 0) {
                    console.log('Got ' + attsFromRemote.size + ' attestation(s) from ' + calendar.url);
                }

                const newAttestations = new Set();
                for (const att of attsFromRemote) {
                    if (!existingAttestations.has(att)) {
                        newAttestations.add(att);
                    }
                }

                if (newAttestations.size > 0) {
                    for (const att of newAttestations) {
                        existingAttestations.add(att);
                    }
                    return { subStamp, upgradedStamp };
                }
                return null;
            } catch (err) {
                console.log('Calendar ' + calendar.url + ': ' + err.message);
                throw err;
            }
        }
    };

    // ================================================================
    // EXPORT
    // ================================================================
    window.OpenTimestamps = OpenTimestamps;

})(typeof window !== 'undefined' ? window : this);