// QR Scanner App with QrScanner library - Mobile Optimized
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
        this.cameraInitialized = false;

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadScannedResults();
        this.registerServiceWorker();
        this.applyBrowserCompatibilityHints();
        this.checkLibraryLoaded();
    }

    // ✅ Проверяем что библиотека загружена
    checkLibraryLoaded() {
        if (typeof window.QrScanner === 'undefined') {
            console.error('❌ QrScanner библиотека не загружена');
            this.showToast('⚠️ Библиотека сканирования не загружена. Перезагрузите страницу.', 'error');
            this.startBtn.disabled = true;
        } else {
            console.log('✅ QrScanner библиотека загружена:', window.QrScanner);
        }
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

    applyBrowserCompatibilityHints() {
        if (this.isSafari()) {
            console.log('📱 Обнаружен Safari');
            this.showToast('ℹ️ Safari: если камера не работает, проверьте разрешения в Настройки > Приватность > Камера', 'info');
        }
    }

    isSafari() {
        const ua = navigator.userAgent;
        return /Safari/i.test(ua) && /Apple Computer/i.test(navigator.vendor || '');
    }

    // ✅ Исправленный startScanning с лучшей обработкой ошибок
    async startScanning() {
        try {
            // Проверяем что библиотека загружена
            if (typeof window.QrScanner === 'undefined') {
                throw new Error('QrScanner library is not loaded');
            }

            this.loadingEl.classList.remove('hidden');
            this.startBtn.disabled = true;

            // Создаем QrScanner если еще не создан
            if (!this.qrScanner) {
                try {
                    this.qrScanner = new window.QrScanner(
                        this.video,
                        (result) => this.handleQRCodeResult(result),
                        {
                            // Опции для лучшей совместимости с мобилой
                            preferredCamera: 'environment',
                            highlightScanRegion: true,
                            highlightCodeOutline: true,
                            maxScansPerSecond: 30,              // ✅ Увеличено
                            returnDetailedScanResult: false     // ✅ Получаем просто строку
                        }
                    );
                    console.log('✅ QrScanner инициализирован');
                } catch (initError) {
                    console.error('❌ Ошибка инициализации QrScanner:', initError);
                    throw new Error(`QrScanner initialization failed: ${initError.message}`);
                }
            }

            // Стартуем сканирование с timeout
            try {
                const startPromise = this.qrScanner.start();
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Camera start timeout')), 5000)
                );
                await Promise.race([startPromise, timeoutPromise]);
                
                console.log('✅ Камера запущена');
                this.cameraInitialized = true;
            } catch (startError) {
                console.error('❌ Ошибка запуска камеры:', startError);
                throw new Error(`Camera start failed: ${startError.message}`);
            }

            // Проверяем что видео действительно работает
            await new Promise(resolve => {
                const checkVideo = setInterval(() => {
                    if (this.video.videoWidth > 0 && this.video.videoHeight > 0) {
                        clearInterval(checkVideo);
                        console.log('✅ Видео поток получен:', {
                            width: this.video.videoWidth,
                            height: this.video.videoHeight
                        });
                        resolve();
                    }
                }, 100);
                
                // Таймаут если видео не начнется
                setTimeout(() => {
                    clearInterval(checkVideo);
                    resolve(); // Продолжаем даже если видео не инициализировалось
                }, 3000);
            });

            this.scanning = true;
            this.startBtn.classList.add('hidden');
            this.stopBtn.classList.remove('hidden');
            
            // Проверяем вспышку
            try {
                const hasFlash = await this.qrScanner.hasFlash();
                this.toggleFlashBtn.disabled = !hasFlash;
                if (!hasFlash) console.log('ℹ️ Вспышка не поддерживается');
            } catch (e) {
                console.log('ℹ️ Не удалось проверить вспышку:', e);
                this.toggleFlashBtn.disabled = true;
            }

            this.loadingEl.classList.add('hidden');
            this.showToast('📹 Камера включена. Наведите на QR код', 'success');

        } catch (error) {
            this.loadingEl.classList.add('hidden');
            this.startBtn.disabled = false;
            this.handleError(error);
        }
    }

    // ✅ Обработка результата QR со страховкой
    handleQRCodeResult(result) {
        try {
            // Извлекаем данные из результата (может быть разный формат)
            let qrData = '';
            
            if (typeof result === 'string') {
                qrData = result;
            } else if (result && result.data) {
                qrData = typeof result.data === 'string' ? result.data : result.data.toString();
            } else if (result && result.rawData) {
                qrData = result.rawData;
            } else {
                console.warn('⚠️ Неизвестный формат результата:', result);
                return;
            }

            this.handleQRCode(qrData);
        } catch (error) {
            console.error('❌ Ошибка обработки результата QR:', error);
        }
    }

    async stopScanning(showToast = true) {
        try {
            this.scanning = false;
            if (this.qrScanner) {
                await this.qrScanner.stop();
                if (this.flashActive) {
                    try {
                        await this.qrScanner.turnFlashOff();
                    } catch (_) {}
                }
            }
        } catch (error) {
            console.error('❌ Ошибка при остановке сканирования:', error);
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

        try {
            const hasFlash = await this.qrScanner.hasFlash();
            if (!hasFlash) {
                this.showToast('Вспышка не поддерживается', 'error');
                return;
            }

            this.flashActive = !this.flashActive;
            if (this.flashActive) {
                await this.qrScanner.turnFlashOn();
            } else {
                await this.qrScanner.turnFlashOff();
            }
            this.updateFlashButton();
            this.showToast(this.flashActive ? '💡 Вспышка включена' : '💡 Вспышка выключена', 'success');
        } catch (error) {
            this.flashActive = !this.flashActive;
            console.error('❌ Ошибка управления вспышкой:', error);
            this.showToast('Ошибка управления вспышкой', 'error');
        }
    }

    // ✅ Нормализация QR данных
    normalizeQRData(qrData) {
        if (typeof qrData !== 'string') return '';
        return qrData.trim();
    }

    handleQRCode(qrData) {
        const normalizedData = this.normalizeQRData(qrData);
        if (!normalizedData) {
            console.warn('⚠️ Получены пустые данные QR');
            return;
        }

        console.log('📊 QR код обнаружен:', normalizedData);

        if (this.lastScannedCode === normalizedData) {
            console.log('⏭️ Дубликат кода, пропускаем');
            return;
        }

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
        if (isDuplicate) {
            console.log('ℹ️ Код уже в истории');
            return;
        }

        this.scannedResults.unshift(result);
        this.saveScannedResults();
        this.renderResults();
        this.playBeep();

        this.stopScanning(false);
        this.showToast('✅ QR код отсканирован!', 'success');
        console.log('💾 Результат сохранен:', result);
        
        setTimeout(() => this.showDetail(result.id), 300);
    }

    detectMatterType(qrData) {
        if (!qrData) return '📱 QR Code';
        const upper = qrData.toUpperCase();
        if (upper.startsWith('MT:')) return '🔗 Matter Device';
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

    renderResults() {
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

    showDetail(resultId) {
        const result = this.scannedResults.find(r => r.id === resultId);
        if (!result) {
            console.error('❌ Результат не найден:', resultId);
            return;
        }

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
                    <p><strong>PIN:</strong> <code>${result.raw.matterData.components?.possiblePin || 'Неизвестен'}</code></p>
                    <p><strong>Сегменты:</strong> ${result.raw.matterData.components?.segmentCount || 0}</p>
                </div>`;
        }

        this.modalBody.innerHTML = `
            <h3>${result.type}</h3>
            <p><strong>Время:</strong> ${result.timestamp.toLocaleString('ru-RU')}</p>
            <h4>Данные QR кода:</h4>
            <pre style="word-break: break-all; white-space: pre-wrap; background-color: var(--bg-secondary); padding: 12px; border-radius: 4px; margin-bottom: 12px;">${this.escapeHtml(result.data)}</pre>
            ${matterInfo}
            <button class="btn btn-primary" style="width: 100%; margin-top: 12px;" onclick="scanner.copyToClipboard(${resultId})">📋 Копировать</button>`;
        
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

    playBeep() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 800;
            gain.gain.setValueAtTime(0.3, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.3);
        } catch (_) {}
    }

    formatTime(date) {
        const diff = Date.now() - date;
        const s = Math.floor(diff / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60);
        if (s < 60) return 'только что';
        if (m < 60) return `${m} мин назад`;
        if (h < 24) return `${h} ч назад`;
        return date.toLocaleDateString('ru-RU');
    }

    truncate(str, length) {
        return str.length > length ? str.substring(0, length) + '...' : str;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async copyToClipboard(resultId) {
        const result = this.scannedResults.find(r => r.id === resultId);
        if (!result) return;

        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(result.data);
            } else {
                this.copyWithExecCommand(result.data);
            }
            this.showToast('✅ Скопировано', 'success');
        } catch (_) {
            this.showToast('❌ Ошибка копирования', 'error');
        }
    }

    copyWithExecCommand(text) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
    }

    deleteResult(resultId) {
        this.scannedResults = this.scannedResults.filter(r => r.id !== resultId);
        this.saveScannedResults();
        this.renderResults();
        this.showToast('Результат удален', 'success');
    }

    saveScannedResults() {
        localStorage.setItem('matterQRScans', JSON.stringify(
            this.scannedResults.map(r => ({ ...r, timestamp: r.timestamp.toISOString() }))
        ));
    }

    loadScannedResults() {
        const data = localStorage.getItem('matterQRScans');
        if (!data) return;
        try {
            this.scannedResults = JSON.parse(data).map(r => ({ ...r, timestamp: new Date(r.timestamp) }));
            this.renderResults();
            console.log('📂 Загружено результатов:', this.scannedResults.length);
        } catch (e) {
            console.error('Ошибка при загрузке результатов:', e);
        }
    }

    async registerServiceWorker() {
        if (!('serviceWorker' in navigator)) return;
        try {
            await navigator.serviceWorker.register('sw.js');
            console.log('✅ Service Worker зарегистрирован');
        } catch (e) {
            console.error('❌ SW ошибка:', e);
        }
    }

    handleError(error) {
        console.error('🔴 ОШИБКА:', error);
        let message = 'Неизвестная ошибка';
        
        if (error.message.includes('QrScanner library')) {
            message = 'Библиотека QR сканирования не загружена. Проверьте интернет и перезагрузите страницу.';
        } else if (error.message.includes('NotAllowedError') || error.name === 'NotAllowedError') {
            message = 'Вы запретили доступ к камере. Проверьте разрешения браузера.';
        } else if (error.message.includes('NotFoundError') || error.name === 'NotFoundError') {
            message = 'Камера не найдена на этом устройстве.';
        } else if (error.message.includes('NotReadableError') || error.name === 'NotReadableError') {
            message = 'Камера занята другим приложением. Закройте его и попробуйте снова.';
        } else if (error.message.includes('timeout')) {
            message = 'Камера не отвечает. Попробуйте еще раз или перезагрузите страницу.';
        } else if (error.message.includes('initialization failed')) {
            message = 'Не удалось инициализировать камеру. Проверьте совместимость браузера.';
        } else if (error.message.includes('Camera start failed')) {
            message = 'Ошибка запуска камеры. Убедитесь, что разрешили ��оступ и попробуйте еще раз.';
        }
        
        this.showToast(`❌ ${message}`, 'error');
    }
}

let scanner;
window.addEventListener('DOMContentLoaded', () => {
    scanner = new MatterQRScanner();
});