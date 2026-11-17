/**
 * Utils module - Пълна имплементация
 * @module Utils
 */

(function(window) {
    'use strict';

    const Utils = {};

    // ================================================================
    // КОНВЕРТИРАНЕ
    // ================================================================

    Utils.hexToBytes = function(hex) {
        if (!hex) return [];
        if (Array.isArray(hex)) return hex;
        if (typeof hex !== 'string') return [];
        
        const clean = hex.startsWith('0x') ? hex.substring(2) : hex;
        if (clean.length % 2 !== 0) return [];
        
        const bytes = [];
        for (let i = 0; i < clean.length; i += 2) {
            bytes.push(parseInt(clean.substr(i, 2), 16));
        }
        return bytes;
    };

    Utils.bytesToHex = function(bytes) {
        if (!bytes) return '';
        if (typeof bytes === 'string') return bytes;
        
        let arr;
        if (bytes instanceof ArrayBuffer) {
            arr = new Uint8Array(bytes);
        } else if (bytes instanceof Uint8Array) {
            arr = bytes;
        } else if (Array.isArray(bytes)) {
            arr = bytes;
        } else {
            return String(bytes);
        }
        
        return Array.from(arr)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    };

    Utils.stringToBytes = function(str) {
        if (!str) return [];
        const bytes = [];
        for (let i = 0; i < str.length; i++) {
            bytes.push(str.charCodeAt(i) & 0xFF);
        }
        return bytes;
    };

    Utils.bytesToString = function(bytes) {
        if (!bytes) return '';
        let str = '';
        for (let i = 0; i < bytes.length; i++) {
            str += String.fromCharCode(bytes[i] & 0xFF);
        }
        return str;
    };

    Utils.bytesToBase64 = function(bytes) {
        if (!bytes) return '';
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i] & 0xFF);
        }
        return btoa(binary);
    };

    Utils.base64ToBytes = function(base64) {
        if (!base64) return [];
        try {
            const binary = atob(base64);
            const bytes = [];
            for (let i = 0; i < binary.length; i++) {
                bytes.push(binary.charCodeAt(i) & 0xFF);
            }
            return bytes;
        } catch(e) {
            return [];
        }
    };

    // ================================================================
    // СРАВНЕНИЕ
    // ================================================================

    Utils.arrEq = function(a, b) {
        if (!a && !b) return true;
        if (!a || !b) return false;
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if ((a[i] || 0) !== (b[i] || 0)) return false;
        }
        return true;
    };

    Utils.arrCompare = function(a, b) {
        if (!a && !b) return 0;
        if (!a) return -1;
        if (!b) return 1;
        const len = Math.min(a.length, b.length);
        for (let i = 0; i < len; i++) {
            if ((a[i] || 0) !== (b[i] || 0)) {
                return (a[i] || 0) - (b[i] || 0);
            }
        }
        return a.length - b.length;
    };

    // ================================================================
    // RANDOM
    // ================================================================

    Utils.randBytes = function(n) {
        const arr = new Uint8Array(n || 16);
        if (crypto && crypto.getRandomValues) {
            crypto.getRandomValues(arr);
        } else {
            for (let i = 0; i < n; i++) {
                arr[i] = Math.floor(Math.random() * 256);
            }
        }
        return arr;
    };

    Utils.randHex = function(n) {
        return Utils.bytesToHex(Utils.randBytes(n));
    };

    // ================================================================
    // HASH
    // ================================================================

    Utils.sha256 = async function(data) {
        let input;
        if (data instanceof ArrayBuffer) {
            input = data;
        } else if (data instanceof Uint8Array) {
            input = data.buffer;
        } else if (Array.isArray(data)) {
            input = new Uint8Array(data).buffer;
        } else {
            input = new TextEncoder().encode(String(data)).buffer;
        }
        const hash = await crypto.subtle.digest('SHA-256', input);
        return new Uint8Array(hash);
    };

    Utils.sha256Hex = async function(data) {
        return Utils.bytesToHex(await Utils.sha256(data));
    };

    // ================================================================
    // REVERSE
    // ================================================================

    Utils.reverseBytes = function(bytes) {
        if (!bytes) return [];
        return Array.from(bytes).reverse();
    };

    Utils.reverseHex = function(hex) {
        if (!hex) return '';
        return Utils.bytesToHex(Utils.reverseBytes(Utils.hexToBytes(hex)));
    };

    // ================================================================
    // FORMAT
    // ================================================================

    Utils.formatBytes = function(bytes, decimals = 1) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
    };

    Utils.truncate = function(str, maxLen = 50, suffix = '…') {
        if (!str || str.length <= maxLen) return str;
        return str.substring(0, maxLen) + suffix;
    };

    // ================================================================
    // PROMISE
    // ================================================================

    Utils.sleep = function(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    };

    Utils.retry = async function(fn, maxRetries = 3, delay = 1000) {
        let lastError;
        for (let i = 0; i < maxRetries; i++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error;
                if (i < maxRetries - 1) {
                    await Utils.sleep(delay * Math.pow(2, i));
                }
            }
        }
        throw lastError;
    };

    Utils.timeout = function(promise, ms, message = 'Operation timed out') {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(message));
            }, ms);
            promise
                .then(result => { clearTimeout(timer); resolve(result); })
                .catch(error => { clearTimeout(timer); reject(error); });
        });
    };

    // ================================================================
    // FILE
    // ================================================================

    Utils.readFile = function(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(new Uint8Array(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(file);
        });
    };

    Utils.readFileText = function(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsText(file);
        });
    };

    Utils.downloadFile = function(data, filename, mimeType = 'application/octet-stream') {
        let blob;
        if (data instanceof Uint8Array) {
            blob = new Blob([data], { type: mimeType });
        } else if (data instanceof Blob) {
            blob = data;
        } else if (typeof data === 'string') {
            blob = new Blob([data], { type: mimeType });
        } else {
            throw new Error('Unsupported data type');
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    window.Utils = Utils;

})(typeof window !== 'undefined' ? window : this);