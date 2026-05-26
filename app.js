// QR Scanner App with robust mobile-first camera detection
class MatterQRScanner {
    constructor() {
        this.video = document.getElementById('video');
        this.startBtn = document.getElementById('startBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.toggleFlashBtn = document.getElementById('toggleFlash');
        this.resultsList = document.getElementById('resultsList');
        this.loadingEl = document.getElementById('loading');
        this.toast = document.getElementById('toast');
        this.detailModal = document.getElementById('detailModal');
        this.modalBody = document.getElementById('modalBody');
        this.modalClose = document.querySelector('.modal-close');

        this.scanning = false;
        this.scannedResults = [];
        this.flashActive = false;
        this.lastScannedCode = null;
        this.dedupeTime = 5000;
        this.qrScanner = null;

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadScannedResults();
        this.registerServiceWorker();
    }

    setupEventListeners() {
        this.startBtn.addEventListener('click', () => this.startScanning());
        this.stopBtn.addEventListener('click', () => this.stopScanning());
        this.toggleFlashBtn.addEventListener('click', () => this.toggleFlash());
        this.modalClose.addEventListener('click', () => this.closeModal());
        this.detailModal.addEventListener('click', (e) => {
            if (e.target === this.detailModal) this.closeModal();
        });
    }

    async startScanning() {
        try {
            if (!window.QrScanner) throw new Error('QrScanner library is not loaded');

            this.loadingEl.classList.remove('hidden');
            this.startBtn.disabled = true;

            if (!this.qrScanner) {
                this.qrScanner = new QrScanner(
                    this.video,
                    (result) => this.handleQRCode(typeof result === 'string' ? result : result?.data),
                    {
                        preferredCamera: 'environment',
                        highlightScanRegion: false,
                        maxScansPerSecond: 12,
                        returnDetailedScanResult: true
                    }
                );
            }

            await this.qrScanner.start();
            this.scanning = true;

            this.startBtn.classList.add('hidden');
            this.stopBtn.classList.remove('hidden');
            this.startBtn.disabled = false;
            this.toggleFlashBtn.disabled = !(await this.qrScanner.hasFlash());
            this.loadingEl.classList.add('hidden');
            this.showToast('📹 Камера включена. Наведите на QR код устройства Matter', 'success');
        } catch (error) {
            this.loadingEl.classList.add('hidden');
            this.startBtn.disabled = false;
            this.handleError(error);
        }
    }

    async stopScanning(showToast = true) {
        this.scanning = false;
        if (this.qrScanner) {
            await this.qrScanner.stop();
            if (this.flashActive) {
                try {
                    await this.qrScanner.turnFlashOff();
                } catch (_) {}
            }
        }

        this.startBtn.classList.remove('hidden');
        this.stopBtn.classList.add('hidden');
        this.toggleFlashBtn.disabled = true;
        this.flashActive = false;
        this.updateFlashButton();
        if (showToast) this.showToast('Сканирование остановлено', 'success');
    }

    async toggleFlash() {
        if (!this.qrScanner || !this.scanning) return;

        const hasFlash = await this.qrScanner.hasFlash();
        if (!hasFlash) {
            this.showToast('Вспышка не поддерживается', 'error');
            return;
        }

        this.flashActive = !this.flashActive;
        try {
            if (this.flashActive) {
                await this.qrScanner.turnFlashOn();
            } else {
                await this.qrScanner.turnFlashOff();
            }
            this.updateFlashButton();
            this.showToast(this.flashActive ? '💡 Вспышка включена' : '💡 Вспышка выключена', 'success');
        } catch (error) {
            this.flashActive = !this.flashActive;
            this.showToast('Ошибка управления вспышкой', 'error');
        }
    }

    normalizeQRData(qrData) {
        if (typeof qrData !== 'string') return '';
        return qrData.trim().replace(/\s+/g, '');
    }

    handleQRCode(qrData) {
        const normalizedData = this.normalizeQRData(qrData);
        if (!normalizedData) return;

        if (this.lastScannedCode === normalizedData) return;
        this.lastScannedCode = normalizedData;
        setTimeout(() => {
            this.lastScannedCode = null;
        }, this.dedupeTime);

        const result = {
            id: Date.now(),
            data: normalizedData,
            timestamp: new Date(),
            type: this.detectMatterType(normalizedData),
            raw: this.parseQRCode(normalizedData)
        };

        const isDuplicate = this.scannedResults.some(r => r.data === normalizedData);
        if (isDuplicate) return;

        this.scannedResults.unshift(result);
        this.saveScannedResults();
        this.renderResults();
        this.playBeep();

        this.stopScanning(false);
        this.showToast('✅ QR код успешно отсканирован!', 'success');
        setTimeout(() => this.showDetail(result.id), 300);
    }

    detectMatterType(qrData) {
        if (!qrData) return '📱 QR Code';
        if (qrData.toUpperCase().startsWith('MT:')) return '🔗 Matter Device';
        if (qrData.toLowerCase().startsWith('http')) return '🌐 URL';
        return '📱 QR Code';
    }

    parseQRCode(qrData) {
        const result = { raw: qrData, isMatter: false, matterData: null };
        if (qrData && qrData.toUpperCase().startsWith('MT:')) {
            const payload = qrData.slice(qrData.indexOf(':') + 1);
            result.isMatter = true;
            result.matterData = {
                prefix: 'MT:',
                payload,
                length: payload.length,
                components: this.parseMatterPayload(payload)
            };
        }
        return result;
    }

    parseMatterPayload(payload) {
        try {
            const parts = payload.split(/[-. ]+/);
            return {
                segments: parts,
                segmentCount: parts.length,
                version: parts[0]?.[0],
                possiblePin: parts[parts.length - 1]?.slice(-6)
            };
        } catch (_) {
            return null;
        }
    }

    renderResults() { /* unchanged rendering logic */
        if (this.scannedResults.length === 0) {
            this.resultsList.innerHTML = '<p class="empty-state">Сканированные коды будут отображены здесь</p>';
            return;
        }
        this.resultsList.innerHTML = this.scannedResults.map((result) => `
            <div class="result-item" onclick="scanner.showDetail(${result.id})">
                <div class="result-header">
                    <span><strong>${result.type}</strong></span>
                    <span class="result-time">${this.formatTime(result.timestamp)}</span>
                </div>
                <div class="result-data">${this.truncate(result.data, 100)}</div>
                <div class="result-actions">
                    <button class="btn-small btn-copy" onclick="scanner.copyToClipboard(${result.id}); event.stopPropagation();">📋 Копировать</button>
                    <button class="btn-small btn-delete" onclick="scanner.deleteResult(${result.id}); event.stopPropagation();">🗑️ Удалить</button>
                </div>
            </div>
        `).join('');
    }

    showDetail(resultId) { /* unchanged */
        const result = this.scannedResults.find(r => r.id === resultId);
        if (!result) return;
        const isMatter = result.raw && result.raw.isMatter;
        let matterInfo = '';
        if (isMatter && result.raw.matterData) {
            matterInfo = `
                <h4>📊 Данные Matter:</h4>
                <div style="background-color: var(--bg-secondary); padding: 12px; border-radius: 4px; margin-bottom: 12px;">
                    <p><strong>Prefix:</strong> <code>${result.raw.matterData.prefix}</code></p>
                    <p><strong>Payload:</strong> <code>${this.escapeHtml(result.raw.matterData.payload)}</code></p>
                    <p><strong>Длина:</strong> ${result.raw.matterData.length} символов</p>
                    <p><strong>Версия:</strong> ${result.raw.matterData.components?.version || 'Неизвестна'}</p>
                    <p><strong>Возможный PIN:</strong> <code>${result.raw.matterData.components?.possiblePin || 'Неизвестен'}</code></p>
                    <p><strong>Сегменты:</strong> ${result.raw.matterData.components?.segmentCount || 0}</p>
                </div>`;
        }
        this.modalBody.innerHTML = `
            <h3>${result.type}</h3>
            <p><strong>Время:</strong> ${result.timestamp.toLocaleString('ru-RU')}</p>
            <h4>Полные данные QR кода:</h4>
            <pre style="word-break: break-all; white-space: pre-wrap; background-color: var(--bg-secondary); padding: 12px; border-radius: 4px; margin-bottom: 12px;">${this.escapeHtml(result.data)}</pre>
            ${matterInfo}
            <button class="btn btn-primary" style="width: 100%; margin-top: 12px;" onclick="scanner.copyToClipboard(${resultId})">📋 Копировать в буфер обмена</button>`;
        this.detailModal.classList.remove('hidden');
    }

    closeModal() { this.detailModal.classList.add('hidden'); }
    updateFlashButton() {
        this.toggleFlashBtn.style.opacity = this.flashActive ? '1' : '0.7';
        this.toggleFlashBtn.style.backgroundColor = this.flashActive ? 'var(--warning-color)' : '';
    }
    showToast(message, type = 'info') {
        this.toast.textContent = message;
        this.toast.className = `toast ${type}`;
        this.toast.classList.remove('hidden');
        setTimeout(() => this.toast.classList.add('hidden'), 3000);
    }
    playBeep() { try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination); osc.frequency.value = 800;
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.3);
    } catch (_) {} }
    formatTime(date) {
        const diff = Date.now() - date;
        const s = Math.floor(diff / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60);
        if (s < 60) return 'только что'; if (m < 60) return `${m} мин назад`; if (h < 24) return `${h} ч назад`;
        return date.toLocaleDateString('ru-RU');
    }
    truncate(str, length) { return str.length > length ? str.substring(0, length) + '...' : str; }
    escapeHtml(text) { const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }
    copyToClipboard(resultId) {
        const result = this.scannedResults.find(r => r.id === resultId);
        if (!result) return;
        navigator.clipboard.writeText(result.data)
            .then(() => this.showToast('✅ Скопировано в буфер обмена', 'success'))
            .catch(() => this.showToast('❌ Ошибка при копировании', 'error'));
    }
    deleteResult(resultId) {
        this.scannedResults = this.scannedResults.filter(r => r.id !== resultId);
        this.saveScannedResults();
        this.renderResults();
        this.showToast('Результат удален', 'success');
    }
    saveScannedResults() {
        localStorage.setItem('matterQRScans', JSON.stringify(this.scannedResults.map(r => ({ ...r, timestamp: r.timestamp.toISOString() }))));
    }
    loadScannedResults() {
        const data = localStorage.getItem('matterQRScans');
        if (!data) return;
        try {
            this.scannedResults = JSON.parse(data).map(r => ({ ...r, timestamp: new Date(r.timestamp) }));
            this.renderResults();
        } catch (e) { console.error('Ошибка при загрузке результатов:', e); }
    }
    async registerServiceWorker() {
        if (!('serviceWorker' in navigator)) return;
        try { await navigator.serviceWorker.register('sw.js'); } catch (e) { console.error(e); }
    }
    handleError(error) {
        let message = 'Неизвестная ошибка';
        if (error.name === 'NotAllowedError') message = 'Вы запретили доступ к камере. Разрешите в настройках браузера.';
        else if (error.name === 'NotFoundError') message = 'Камера не найдена. Проверьте устройство.';
        else if (error.name === 'NotReadableError') message = 'Камера занята другим приложением.';
        else if (error.name === 'OverconstrainedError') message = 'Камера не поддерживает запрашиваемые параметры.';
        else if (String(error.message || '').includes('QrScanner')) message = 'Библиотека сканера не загрузилась. Проверьте интернет и перезапустите приложение.';
        this.showToast(`❌ ${message}`, 'error');
        console.error(error);
    }
}

let scanner;
window.addEventListener('DOMContentLoaded', () => {
    scanner = new MatterQRScanner();
});
