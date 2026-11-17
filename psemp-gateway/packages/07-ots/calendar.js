/**
 * Calendar module - Browser compatible
 * @module Calendar
 * @license LPGL3
 */

(function(window) {
    'use strict';

    const Utils = window.Utils || {};
    const Context = window.Context || {};
    const Timestamp = window.Timestamp || {};

    // ================================================================
    // ERRORS
    // ================================================================
    class CommitmentNotFoundError extends Error {
        constructor(message) { super(message); this.name = 'CommitmentNotFoundError'; }
    }
    class URLError extends Error {
        constructor(message) { super(message); this.name = 'URLError'; }
    }
    class ExceededSizeError extends Error {
        constructor(message) { super(message); this.name = 'ExceededSizeError'; }
    }

    // ================================================================
    // REMOTE CALENDAR
    // ================================================================
    class RemoteCalendar {
        constructor(url) {
            this.url = url;
            this.timeout = 30000;
        }

        async submit(digest) {
            const url = this.url + '/digest';
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Accept': 'application/vnd.opentimestamps.v1',
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new Uint8Array(digest),
                signal: AbortSignal.timeout(this.timeout)
            });

            if (!response.ok) {
                throw new URLError('HTTP ' + response.status + ': ' + response.statusText);
            }

            const body = await response.arrayBuffer();
            if (body.byteLength > 10000) {
                throw new ExceededSizeError('Calendar response exceeded size limit');
            }

            const ctx = new Context.StreamDeserialization(new Uint8Array(body));
            const timestamp = Timestamp.deserialize(ctx, digest);
            return timestamp;
        }

        async getTimestamp(commitment) {
            const hex = Utils.bytesToHex(commitment);
            const url = this.url + '/timestamp/' + hex;
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/vnd.opentimestamps.v1'
                },
                signal: AbortSignal.timeout(this.timeout)
            });

            if (!response.ok) {
                if (response.status === 404) {
                    throw new CommitmentNotFoundError('Commitment not found: ' + hex);
                }
                throw new Error('HTTP ' + response.status + ': ' + response.statusText);
            }

            const body = await response.arrayBuffer();
            if (body.byteLength > 10000) {
                throw new ExceededSizeError('Calendar response exceeded size limit');
            }

            const ctx = new Context.StreamDeserialization(new Uint8Array(body));
            const timestamp = Timestamp.deserialize(ctx, commitment);
            return timestamp;
        }
    }

    // ================================================================
    // URL WHITELIST
    // ================================================================
    class UrlWhitelist {
        constructor(urls) {
            this.urls = new Set();
            if (urls) {
                for (const u of urls) {
                    this.add(u);
                }
            }
        }

        add(url) {
            if (typeof url !== 'string') {
                throw new TypeError('URL must be a string');
            }
            if (url.startsWith('http://') || url.startsWith('https://')) {
                this.urls.add(url);
            } else {
                this.urls.add('http://' + url);
                this.urls.add('https://' + url);
            }
        }

        contains(url) {
            // Simple contains - check if any whitelisted URL is a prefix
            for (const w of this.urls) {
                if (url.startsWith(w) || w.startsWith(url)) {
                    return true;
                }
            }
            return false;
        }

        toString() {
            return 'UrlWhitelist([' + Array.from(this.urls).join(',') + '])';
        }
    }

    // ================================================================
    // DEFAULTS
    // ================================================================
    const DEFAULT_CALENDAR_WHITELIST = new UrlWhitelist([
        'https://*.calendar.opentimestamps.org',
        'https://*.calendar.eternitywall.com',
        'https://*.calendar.catallaxy.com'
    ]);

    const DEFAULT_AGGREGATORS = [
        'https://a.pool.opentimestamps.org',
        'https://b.pool.opentimestamps.org',
        'https://a.pool.eternitywall.com',
        'https://ots.btc.catallaxy.com'
    ];

    // ================================================================
    // EXPORT
    // ================================================================
    const Calendar = {
        RemoteCalendar,
        UrlWhitelist,
        DEFAULT_CALENDAR_WHITELIST,
        DEFAULT_AGGREGATORS,
        CommitmentNotFoundError,
        URLError,
        ExceededSizeError
    };

    window.Calendar = Calendar;

})(typeof window !== 'undefined' ? window : this);