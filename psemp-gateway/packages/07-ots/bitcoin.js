/**
 * Bitcoin module - Browser compatible
 * @module Bitcoin
 * @license LPGL3
 */

(function(window) {
    'use strict';

    const Utils = window.Utils || {};

    class BlockHeader {
        constructor(merkleroot, hash, time) {
            this.merkleroot = merkleroot;
            this.hash = hash;
            this.time = time;
        }

        getMerkleroot() { return this.merkleroot; }
        getHash() { return this.hash; }
        getTime() { return this.time; }
    }

    // Browser-compatible BitcoinNode - uses Esplora instead of local RPC
    class BitcoinNode {
        constructor(options = {}) {
            this.apiUrl = options.apiUrl || 'https://blockstream.info/api';
            this.timeout = options.timeout || 10000;
        }

        async getBlockHeader(height) {
            const url = this.apiUrl + '/block-height/' + height;
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Accept': 'plain/text' },
                signal: AbortSignal.timeout(this.timeout)
            });
            if (!response.ok) {
                throw new Error('HTTP ' + response.status + ': ' + response.statusText);
            }
            const hash = await response.text();
            
            const blockUrl = this.apiUrl + '/block/' + hash.trim();
            const blockResponse = await fetch(blockUrl, {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
                signal: AbortSignal.timeout(this.timeout)
            });
            if (!blockResponse.ok) {
                throw new Error('HTTP ' + blockResponse.status + ': ' + blockResponse.statusText);
            }
            const data = await blockResponse.json();
            
            return new BlockHeader(data.merkle_root, hash.trim(), data.timestamp);
        }

        static async readBitcoinConf() {
            // Browser version - cannot read local file
            // Return default configuration
            return {
                rpcuser: '',
                rpcpassword: '',
                rpcconnect: '127.0.0.1',
                rpcport: '8332'
            };
        }
    }

    window.Bitcoin = {
        BitcoinNode,
        BlockHeader
    };

})(typeof window !== 'undefined' ? window : this);