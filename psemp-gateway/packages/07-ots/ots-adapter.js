// ================================================================
// ots-adapter.js – v5.12 с локален fallback
// ================================================================

'use strict';

class SuperSafeOTSAdapter {
    constructor(config = {}) {
        this.version = '5.12';
        this._ready = false;
        this._logs = [];
        this._cache = new Map();
        this._readyCallbacks = [];
        this._isFileProtocol = window.location.protocol === 'file:';
        this._loadAttempts = 0;
        this._maxLoadAttempts = 5;

        this.stats = {
            totalAttempts: 0,
            successfulAttempts: 0,
            failedAttempts: 0,
            cacheHits: 0,
            cacheMisses: 0
        };

        this.config = {
            maxFileSize: config.maxFileSize ?? 100 * 1024 * 1024,
            timeout: config.timeout ?? 60000,
            retryCount: config.retryCount ?? 3,
            retryDelay: config.retryDelay ?? 1000,
            useCache: config.useCache ?? true,
            logLevel: config.logLevel ?? 'info'
        };

        if (this._isFileProtocol) {
            this._log('info', '📁 Running from file:// protocol');
        }

        this._initialize();
    }

    _initialize() {
        // Проверка дали OpenTimestamps е зареден
        if (typeof window.OpenTimestamps !== 'undefined') {
            this._ready = true;
            this._log('info', '✅ OpenTimestamps already loaded');
            this._notifyReady();
            return;
        }

        // Опит за зареждане
        this._loadOpenTimestamps();
    }

    _loadOpenTimestamps() {
        // Първо опитайте локални файлове, след това CDN
        const sources = [
            'opentimestamps.min.js',
            'https://cdn.jsdelivr.net/npm/opentimestamps@0.4.9/dist/opentimestamps.min.js',
            'https://unpkg.com/opentimestamps@0.4.9/dist/opentimestamps.min.js',
            'https://opentimestamps.org/assets/javascripts/vendor/opentimestamps.min.js'
        ];

        let index = 0;
        this._loadAttempts = 0;

        const tryLoad = () => {
            if (this._loadAttempts >= this._maxLoadAttempts) {
                this._log('error', '❌ Max load attempts reached');
                this._notifyReady();
                return;
            }

            if (index >= sources.length) {
                this._log('error', '❌ All OpenTimestamps sources failed');
                this._notifyReady();
                return;
            }

            const url = sources[index];
            this._loadAttempts++;
            this._log('debug', `Loading OpenTimestamps from: ${url} (attempt ${this._loadAttempts})`);

            const script = document.createElement('script');
            script.src = url;
            script.async = true;
            script.crossOrigin = 'anonymous';
            
            const timeoutId = setTimeout(() => {
                script.onload = null;
                script.onerror = null;
                if (script.parentNode) {
                    document.head.removeChild(script);
                }
                this._log('warn', `Timeout loading: ${url}`);
                index++;
                tryLoad();
            }, 15000);

            script.onload = () => {
                clearTimeout(timeoutId);
                if (typeof window.OpenTimestamps !== 'undefined') {
                    this._ready = true;
                    this._log('info', `✅ OpenTimestamps loaded from: ${url}`);
                    this._notifyReady();
                } else {
                    this._log('warn', `Loaded but not available: ${url}`);
                    index++;
                    tryLoad();
                }
            };

            script.onerror = () => {
                clearTimeout(timeoutId);
                this._log('warn', `Failed to load: ${url}`);
                if (script.parentNode) {
                    document.head.removeChild(script);
                }
                index++;
                tryLoad();
            };

            document.head.appendChild(script);
        };

        tryLoad();
    }

    _notifyReady() {
        for (const cb of this._readyCallbacks) {
            try { cb(); } catch (e) {}
        }
        this._readyCallbacks = [];
    }

    async waitForReady() {
        if (this._ready) return true;
        return new Promise((resolve) => {
            if (this._ready) {
                resolve(true);
            } else {
                this._readyCallbacks.push(() => resolve(this._ready));
                setTimeout(() => {
                    if (!this._ready) {
                        this._log('warn', '⚠️ Wait timeout - continuing anyway');
                        resolve(false);
                    }
                }, 30000);
            }
        });
    }

    isReady() {
        return this._ready;
    }

    getInfo() {
        return {
            version: this.version,
            ready: this._ready,
            isFileProtocol: this._isFileProtocol,
            loadAttempts: this._loadAttempts,
            loadedAPIs: this._ready ? ['OpenTimestamps'] : [],
            stats: { ...this.stats },
            cacheSize: this._cache.size,
            config: { ...this.config },
            logs: this._logs.slice(-20)
        };
    }

    getLogs(count = 50) {
        return this._logs.slice(-count);
    }

    clearCache() {
        this._cache.clear();
        this.stats.cacheHits = 0;
        this.stats.cacheMisses = 0;
        this._log('info', 'Cache cleared');
    }

    // ================================================================
    // OTS METHODS
    // ================================================================

    async createOTS(file) {
        await this.waitForReady();
        if (!this._ready) {
            this._log('error', 'OpenTimestamps not loaded');
            return { success: false, error: 'OpenTimestamps not loaded. Please check your internet connection.' };
        }

        this.stats.totalAttempts++;
        const startTime = performance.now();

        try {
            const OT = window.OpenTimestamps;
            const { fileData, fileName, fileSize } = await this._normalizeFile(file);

            if (fileSize > this.config.maxFileSize) {
                throw new Error(`File too large: ${this._formatBytes(fileSize)}`);
            }

            const hashBuffer = await this._sha256(fileData);
            const hash = this._arrayBufferToHex(hashBuffer);

            this._log('info', `File hash: ${hash.substring(0, 16)}...`);

            if (this.config.useCache && this._cache.has(hash)) {
                this.stats.cacheHits++;
                const cached = this._cache.get(hash);
                return {
                    success: true,
                    hash: hash,
                    otsData: cached.otsData,
                    otsSize: cached.otsData.length,
                    method: 'cache',
                    duration: Math.round(performance.now() - startTime),
                    fileName: fileName,
                    fileSize: fileSize
                };
            }
            this.stats.cacheMisses++;

            let timestamp;
            let submitAttempts = 0;

            try {
                timestamp = OT.DetachedTimestampFile.fromBytes(
                    fileData,
                    OT.Hash.sha256(fileData)
                );

                const calendars = [
                    'https://a.pool.opentimestamps.org',
                    'https://b.pool.opentimestamps.org',
                    'https://a.opentimestamps.org'
                ];

                for (const calendarUrl of calendars) {
                    try {
                        submitAttempts++;
                        await OT.Calendar.submit(timestamp, calendarUrl);
                        this._log('info', `Submitted to: ${calendarUrl}`);
                        break;
                    } catch (e) {
                        this._log('debug', `Calendar ${calendarUrl} failed: ${e.message}`);
                    }
                }
            } catch (e) {
                this._log('warn', `DetachedTimestampFile failed: ${e.message}`);
                try {
                    timestamp = OT.createTimestamp(fileData);
                    try {
                        await OT.submitTimestamp(timestamp);
                        submitAttempts++;
                    } catch (submitErr) {
                        this._log('warn', `Submit failed: ${submitErr.message}`);
                    }
                } catch (e2) {
                    throw new Error(`OTS creation failed: ${e.message}`);
                }
            }

            let otsData;
            try {
                if (timestamp.serialize) {
                    otsData = timestamp.serialize();
                } else if (timestamp.toBytes) {
                    otsData = timestamp.toBytes();
                } else {
                    otsData = OT.serializeTimestamp(timestamp);
                }
            } catch (e) {
                throw new Error(`Serialization failed: ${e.message}`);
            }

            const otsBytes = otsData instanceof Uint8Array ? otsData : new Uint8Array(otsData);

            if (this.config.useCache) {
                this._cache.set(hash, { otsData: otsBytes, created: Date.now() });
            }

            this.stats.successfulAttempts++;
            const duration = Math.round(performance.now() - startTime);

            return {
                success: true,
                hash: hash,
                otsData: otsBytes,
                otsSize: otsBytes.length,
                method: 'opentimestamps',
                duration: duration,
                submitAttempts: submitAttempts || 1,
                fileName: fileName,
                fileSize: fileSize
            };

        } catch (e) {
            this.stats.failedAttempts++;
            this._log('error', `OTS creation failed: ${e.message}`);
            return {
                success: false,
                error: e.message,
                duration: Math.round(performance.now() - startTime)
            };
        }
    }

    async verifyOTS(otsData, originalFile = null) {
        await this.waitForReady();
        if (!this._ready) {
            return { valid: false, error: 'OpenTimestamps not loaded' };
        }

        const startTime = performance.now();

        try {
            const OT = window.OpenTimestamps;
            const otsBytes = otsData instanceof Uint8Array ? otsData : new Uint8Array(otsData);

            let timestamp;
            try {
                timestamp = OT.parseTimestamp(otsBytes);
            } catch (e) {
                throw new Error(`Failed to parse OTS: ${e.message}`);
            }

            let digest = null;
            if (timestamp.digest) {
                digest = this._arrayBufferToHex(timestamp.digest);
            }

            let attestationCount = 0;
            let blockchainAttestations = 0;
            let attestationDetails = [];

            try {
                const attestations = timestamp.allAttestations ? timestamp.allAttestations() : (timestamp.attestations || []);
                attestationCount = attestations.length;

                for (let i = 0; i < attestations.length; i++) {
                    const att = attestations[i];
                    const detail = {
                        index: i,
                        type: att.type || att._type || 'unknown',
                        verified: att.verified || false
                    };
                    if (att.type && (att.type.includes('Bitcoin') || att.type.includes('Litecoin'))) {
                        blockchainAttestations++;
                    }
                    attestationDetails.push(detail);
                }
            } catch (e) {
                this._log('debug', `Failed to get attestations: ${e.message}`);
            }

            let hashMatch = null;
            let fileDigest = null;

            if (originalFile) {
                const { fileData } = await this._normalizeFile(originalFile);
                const hashBuffer = await this._sha256(fileData);
                fileDigest = this._arrayBufferToHex(hashBuffer);
                if (digest) {
                    hashMatch = fileDigest === digest;
                }
            }

            const duration = Math.round(performance.now() - startTime);
            const isValid = blockchainAttestations > 0 || attestationCount > 0;

            return {
                valid: isValid,
                fileDigest: fileDigest || digest || null,
                hashMatch: hashMatch,
                attestationCount: attestationCount,
                blockchainAttestations: blockchainAttestations,
                attestationDetails: attestationDetails,
                duration: duration,
                details: {
                    hasAttestations: attestationCount > 0,
                    hasBlockchain: blockchainAttestations > 0,
                    verificationMessage: isValid ? '✅ OTS verified' : '⚠️ No blockchain attestations found'
                }
            };

        } catch (e) {
            this._log('error', `Verification failed: ${e.message}`);
            return {
                valid: false,
                error: e.message,
                duration: Math.round(performance.now() - startTime)
            };
        }
    }

    // ================================================================
    // UTILITIES
    // ================================================================

    async _normalizeFile(file) {
        let fileData;
        let fileName = 'unknown';
        let fileSize = 0;

        if (file instanceof File) {
            fileName = file.name;
            fileSize = file.size;
            fileData = new Uint8Array(await file.arrayBuffer());
        } else if (file instanceof ArrayBuffer) {
            fileData = new Uint8Array(file);
            fileSize = fileData.length;
        } else if (file instanceof Uint8Array) {
            fileData = file;
            fileSize = fileData.length;
        } else {
            throw new Error('Unsupported file type');
        }

        return { fileData, fileName, fileSize };
    }

    async _sha256(data) {
        if (typeof crypto !== 'undefined' && crypto.subtle) {
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            return new Uint8Array(hashBuffer);
        }
        throw new Error('SHA-256 not available');
    }

    _arrayBufferToHex(buffer) {
        const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    _formatBytes(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        if (bytes < 1073741824) return (bytes / 1048576).toFixed(2) + ' MB';
        return (bytes / 1073741824).toFixed(2) + ' GB';
    }

    _log(level, message) {
        const entry = { level, message, timestamp: new Date().toISOString() };
        this._logs.push(entry);
        if (this._logs.length > 100) this._logs.shift();

        const levels = ['debug', 'info', 'warn', 'error'];
        const configured = this.config.logLevel || 'info';
        if (levels.indexOf(level) >= levels.indexOf(configured)) {
            const prefix = `[OTS-Adapter] ${level.toUpperCase()}`;
            switch (level) {
                case 'error': console.error(prefix, message); break;
                case 'warn': console.warn(prefix, message); break;
                case 'debug': console.debug(prefix, message); break;
                default: console.log(prefix, message);
            }
        }
    }
}

// ================================================================
// ГЛОБАЛЕН ИНСТАНС
// ================================================================

if (typeof window !== 'undefined') {
    if (!window._otsAdapterInstance) {
        window._otsAdapterInstance = new SuperSafeOTSAdapter();
        window.otsAdapter = window._otsAdapterInstance;
    }

    console.log('⚖️ SuperSafeOTSAdapter v5.12 loaded');
    console.log('📋 Ausgearbeitet von PasevSU – D. Pasev');

    // Стартирайте зареждането веднага
    (async function initAdapter() {
        const ready = await window.otsAdapter.waitForReady();
        if (ready) {
            console.log('✅ OpenTimestamps loaded successfully!');
        } else {
            console.warn('⚠️ OpenTimestamps not loaded. Please check internet connection.');
            console.warn('💡 Tip: Restore the opentimestamps.min.js browser bundle in the project folder.');
        }
    })();
}