/**
 * Esplora module - Browser compatible
 * @module Esplora
 * @license LPGL3
 */

(function(window) {
    'use strict';

    const PUBLIC_ESPLORA_URL = 'https://blockstream.info/api';

    class Esplora {
        constructor(options = {}) {
            this.url = options.url || PUBLIC_ESPLORA_URL;
            this.timeout = options.timeout || 10000;
        }

        async blockhash(height) {
            const url = this.url + '/block-height/' + height;
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Accept': 'plain/text' },
                signal: AbortSignal.timeout(this.timeout)
            });
            if (!response.ok) {
                throw new Error('HTTP ' + response.status + ': ' + response.statusText);
            }
            const body = await response.text();
            if (!body) {
                throw new Error('Empty body');
            }
            return body.trim();
        }

        async block(hash) {
            const url = this.url + '/block/' + hash;
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
                signal: AbortSignal.timeout(this.timeout)
            });
            if (!response.ok) {
                throw new Error('HTTP ' + response.status + ': ' + response.statusText);
            }
            const body = await response.json();
            if (!body) {
                throw new Error('Empty body');
            }
            if (!body.merkle_root || !body.timestamp) {
                throw new Error('Invalid block data');
            }
            return { merkleroot: body.merkle_root, time: body.timestamp };
        }

        async blockTxids(hash) {
            const url = this.url + '/block/' + hash + '/txids';
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
                signal: AbortSignal.timeout(this.timeout)
            });
            if (!response.ok) {
                throw new Error('HTTP ' + response.status + ': ' + response.statusText);
            }
            return await response.json();
        }

        async tx(txid) {
            const url = this.url + '/tx/' + txid;
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
                signal: AbortSignal.timeout(this.timeout)
            });
            if (!response.ok) {
                throw new Error('HTTP ' + response.status + ': ' + response.statusText);
            }
            return await response.json();
        }

        async txStatus(txid) {
            const url = this.url + '/tx/' + txid + '/status';
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
                signal: AbortSignal.timeout(this.timeout)
            });
            if (!response.ok) {
                throw new Error('HTTP ' + response.status + ': ' + response.statusText);
            }
            return await response.json();
        }
    }

    window.Esplora = Esplora;

})(typeof window !== 'undefined' ? window : this);