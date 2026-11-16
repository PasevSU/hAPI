/**
 * OTS Evidence Package Engine v2.1.0
 * PASEVSU · Denislav Dimitrov Pasev
 * @module OTSPackage
 */

class OTSPackage {
    constructor(options = {}) {
        this.version = '2.1.0';
        this.createdAt = new Date().toISOString();
        this.schema = 'OTS-EVIDENCE-PACKAGE-V2';
        this.data = {
            report: {},
            document: {},
            ots: {},
            calendars: [],
            blockchains: [],
            attestations: [],
            verification: {},
            legal: {},
            audit: [],
            qr: {},
            pages: []
        };
        this.hash = null;
        this.signature = null;
        this.chainHash = null;
        this.options = options;
    }

    // Създаване на Evidence Package
    create(fileData, fileInfo) {
        const now = new Date();
        const reportId = `OTS-${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}-${String(Math.floor(Math.random()*10000)).padStart(4,'0')}`;
        
        this.data.report = {
            reportId: reportId,
            documentId: `DOC-${reportId}`,
            status: 'PENDING',
            createdAt: now.toISOString(),
            finalizedAt: null,
            organization: this.options.organization || 'PASEVSU',
            author: this.options.author || 'Denislav Dimitrov Pasev',
            productName: 'OTS Forensic Enterprise',
            version: this.version,
            templateVersion: '12.0.0',
            language: 'bg'
        };

        this.data.document = {
            fileName: fileInfo.name,
            fileSize: fileInfo.size,
            fileDigest: fileInfo.hash,
            hashAlgorithm: 'SHA-256',
            mimeType: fileInfo.type || 'application/octet-stream'
        };

        this.data.verification = {
            status: 'PENDING',
            verifiedAt: null,
            durationMs: 0,
            hashMatch: true,
            attestationCount: 0,
            blockchainAttestationCount: 0,
            confidence: 'PENDING'
        };

        this.data.legal = {
            classification: 'Confidential',
            evidenceValue: 'Pending Verification',
            zpoParagraph: '§ 371a ZPO',
            eidasRegulation: 'eIDAS EU 910/2014',
            legalStatus: 'Qualifizierter elektronischer Zeitstempel',
            disclaimer: 'Dieses Dokument wurde automatisch generiert.'
        };

        this.data.audit = [{
            event: 'PACKAGE_CREATED',
            timestamp: now.toISOString(),
            details: { version: this.version }
        }];

        return this;
    }

    // Добавяне на OTS
    addOTS(otsData) {
        this.data.ots = {
            fileName: otsData.fileName || 'timestamp.ots',
            size: otsData.size || 0,
            digest: otsData.digest || '',
            generatedAt: otsData.generatedAt || new Date().toISOString(),
            generationDurationMs: otsData.durationMs || 0,
            method: 'OpenTimestamps',
            calendars: otsData.calendars || []
        };
        
        this.data.audit.push({
            event: 'OTS_ADDED',
            timestamp: new Date().toISOString(),
            details: { size: otsData.size }
        });
        
        return this;
    }

    // Добавяне на календари
    addCalendars(calendars) {
        this.data.calendars = calendars.map((cal, i) => ({
            sequence: i + 1,
            hostname: cal.hostname || cal.url,
            url: cal.url,
            status: cal.status || 'PENDING',
            submittedAt: cal.submittedAt || new Date().toISOString(),
            completedAt: cal.completedAt || null,
            responseTimeMs: cal.responseTimeMs || null
        }));
        
        this.data.audit.push({
            event: 'CALENDARS_ADDED',
            timestamp: new Date().toISOString(),
            details: { count: calendars.length }
        });
        
        return this;
    }

    // Добавяне на блокчейн атестации
    addBlockchains(blockchains) {
        this.data.blockchains = blockchains.map((bc, i) => ({
            sequence: i + 1,
            type: bc.type || 'Bitcoin',
            name: bc.name || 'Bitcoin',
            status: bc.status || 'PENDING',
            verified: bc.verified || false,
            blockHash: bc.blockHash || '',
            confirmations: bc.confirmations || 0,
            explorerUrl: bc.explorerUrl || ''
        }));
        
        this.data.verification.blockchainAttestationCount = blockchains.length;
        
        this.data.audit.push({
            event: 'BLOCKCHAINS_ADDED',
            timestamp: new Date().toISOString(),
            details: { count: blockchains.length }
        });
        
        return this;
    }

    // Обновяване на статуса
    updateStatus(status, details = {}) {
        this.data.report.status = status;
        this.data.verification.status = status;
        
        if (status === 'VERIFIED') {
            this.data.report.finalizedAt = new Date().toISOString();
            this.data.verification.verifiedAt = new Date().toISOString();
        }
        
        this.data.audit.push({
            event: 'STATUS_UPDATED',
            timestamp: new Date().toISOString(),
            details: { status, ...details }
        });
        
        return this;
    }

    // Изчисляване на hash на пакета
    async calculateHash() {
        const json = JSON.stringify(this.data);
        const encoder = new TextEncoder();
        const data = encoder.encode(json);
        const hash = await crypto.subtle.digest('SHA-256', data);
        this.hash = Array.from(new Uint8Array(hash))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
        
        this.data.report.reportHash = this.hash;
        
        this.data.audit.push({
            event: 'HASH_CALCULATED',
            timestamp: new Date().toISOString(),
            details: { hash: this.hash.substring(0, 16) + '...' }
        });
        
        return this.hash;
    }

    // Експорт на пакета
    export() {
        return {
            schema: this.schema,
            version: this.version,
            data: this.data,
            hash: this.hash,
            createdAt: this.createdAt
        };
    }

    // JSON сериализация
    toJSON() {
        return JSON.stringify(this.export(), null, 2);
    }

    // Валидация на пакета
    validate() {
        const errors = [];
        const warnings = [];
        
        // Проверка на задължителни полета
        if (!this.data.report.reportId) errors.push('Missing reportId');
        if (!this.data.document.fileDigest) errors.push('Missing fileDigest');
        if (!this.data.ots.digest) warnings.push('Missing OTS digest');
        
        // Проверка на консистентност
        if (this.data.document.fileDigest && this.data.ots.digest) {
            if (this.data.document.fileDigest !== this.data.ots.digest) {
                errors.push('Document digest does not match OTS digest');
            }
        }
        
        return {
            valid: errors.length === 0,
            errors,
            warnings,
            status: errors.length === 0 ? 'VALID' : 'INVALID'
        };
    }
}

// ================================================================
// ЕКСПОРТ
// ================================================================
window.OTSPackage = OTSPackage;
window.OTSPackageV2 = OTSPackage; // Съвместимост

// ================================================================
// ГЛОБАЛЕН ЕКЗЕМПЛЯР
// ================================================================
window.PASEVSU_OTS_EVIDENCE_PACKAGE_V2 = null;

console.log('📦 OTSPackage v2.1.0 зареден');