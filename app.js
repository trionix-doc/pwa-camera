// QR Scanner App with improved focus and Matter device detection
class MatterQRScanner {
    constructor() {
        this.video = document.getElementById('video');
        this.canvas = document.getElementById('canvas');
        this.canvasContext = this.canvas.getContext('2d', { willReadFrequently: true });
        this.startBtn = document.getElementById('startBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.toggleFlashBtn = document.getElementById('toggleFlash');
        this.resultsList = document.getElementById('resultsList');
        this.loadingEl = document.getElementById('loading');
        this.toast = document.getElementById('toast');
        this.detailModal = document.getElementById('detailModal');
        this.modalBody = document.getElementById('modalBody');
        this.modalClose = document.querySelector('.modal-close');

        this.stream = null;
        this.scanning = false;
        this.scannedResults = [];
        this.scanningFrameId = null;
        this.flashActive = false;
        this.lastScannedCode = null;
        this.dedupeTime = 5000;
        
        // Canvas для обработки изображения
        this.processingCanvas = document.createElement('canvas');
        this.processingContext = this.processingCanvas.getContext('2d', { willReadFrequently: true });

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
            if (e.target === this.detailModal) {
                this.closeModal();
            }
        });
        // Добавляем tap-to-focus для Android
        this.video.addEventListener('click', () => this.triggerFocus());
    }

    async startScanning() {
        try {
            this.loadingEl.classList.remove('hidden');
            this.startBtn.disabled = true;

            // Максимально высокое разрешение для лучшей фокусировки
            const constraints = {
                video: {
                    facingMode: { exact: 'environment' },
                    width: { ideal: 1920, min: 640 },
                    height: { ideal: 1080, min: 480 },
                    // Пытаемся установить continuous focus
                    focusMode: { ideal: 'continuous' },
                    advanced: [
                        { focusMode: 'continuous' },
                        { zoom: { ideal: 1 } }
                    ]
                },
                audio: false
            };

            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.video.srcObject = this.stream;

            // Применяем фокусировку после получения потока
            await this.applyFocusConstraints();

            this.video.onplay = () => {
                console.log('📹 Видео запущено', {
                    width: this.video.videoWidth,
                    height: this.video.videoHeight,
                    facingMode: this.stream.getVideoTracks()[0].getSettings().facingMode
                });
                this.scanning = true;
                this.startBtn.classList.add('hidden');
                this.stopBtn.classList.remove('hidden');
                this.toggleFlashBtn.disabled = false;
                this.loadingEl.classList.add('hidden');
                this.showToast('📹 Камера включена. Подносите QR код к центру рамки', 'success');
                // Начинаем сканирование
                this.scanQRCode();
            };

            await this.video.play();

        } catch (error) {
            this.loadingEl.classList.add('hidden');
            this.startBtn.disabled = false;
            this.handleError(error);
        }
    }

    // Пытаемся применить фокусировку
    async applyFocusConstraints() {
        try {
            const videoTrack = this.stream.getVideoTracks()[0];
            if (!videoTrack) return;

            const capabilities = videoTrack.getCapabilities();
            console.log('📷 Возможности камеры:', {
                focusMode: capabilities.focusMode,
                zoom: capabilities.zoom,
                torch: capabilities.torch
            });

            // Пытаемся установить continuous focus
            if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
                await videoTrack.applyConstraints({
                    advanced: [{ focusMode: 'continuous' }]
                });
                console.log('✅ Continuous focus установлен');
            }
        } catch (error) {
            console.log('ℹ️ Focus constraints не поддерживаются:', error.message);
        }
    }

    // Trigger focus при клике (Android)
    triggerFocus() {
        console.log('👆 Попытка фокусировки...');
        this.applyFocusConstraints();
    }

    stopScanning() {
        console.log('🛑 Останавливаем сканирование...');
        this.scanning = false;
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        if (this.scanningFrameId) {
            cancelAnimationFrame(this.scanningFrameId);
        }
        this.startBtn.classList.remove('hidden');
        this.stopBtn.classList.add('hidden');
        this.startBtn.disabled = false;
        this.toggleFlashBtn.disabled = true;
        this.flashActive = false;
        this.updateFlashButton();
        this.showToast('Сканирование остановлено', 'success');
    }

    scanQRCode() {
        if (!this.scanning) return;

        // Проверяем, что видео готово
        if (this.video.videoWidth === 0 || this.video.videoHeight === 0) {
            this.scanningFrameId = requestAnimationFrame(() => this.scanQRCode());
            return;
        }

        try {
            this.canvas.width = this.video.videoWidth;
            this.canvas.height = this.video.videoHeight;
            
            // Рисуем текущий кадр из видео
            this.canvasContext.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
            const imageData = this.canvasContext.getImageData(0, 0, this.canvas.width, this.canvas.height);

            // Пытаемся распознать QR с обычным изображением
            let code = jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: 'attemptBoth'
            });

            // Если не нашли, пытаемся с обработанным изображением
            if (!code) {
                const processedData = this.preprocessImage(imageData);
                code = jsQR(processedData.data, processedData.width, processedData.height, {
                    inversionAttempts: 'attemptBoth'
                });
            }

            if (code) {
                console.log('✅ QR код найден:', code.data);
                this.handleQRCode(code.data);
                return; // Выходим из цикла сканирования
            }

        } catch (error) {
            console.error('❌ Ошибка при сканировании:', error);
        }

        this.scanningFrameId = requestAnimationFrame(() => this.scanQRCode());
    }

    // Предварительная обработка изображения для улучшения распознавания
    preprocessImage(imageData) {
        const data = imageData.data;
        const width = imageData.width;
        const height = imageData.height;

        // Преобразуем в grayscale + увеличиваем контраст
        const processedData = new Uint8ClampedArray(data.length);

        for (let i = 0; i < data.length; i += 4) {
            // Grayscale преобразование (luminosity method)
            const gray = Math.round(
                0.299 * data[i] +      // R
                0.587 * data[i + 1] +  // G
                0.114 * data[i + 2]    // B
            );

            // Увеличиваем контраст (contrast = 1.5)
            const contrast = 1.5;
            const adjusted = Math.round((gray - 128) * contrast + 128);
            const clamped = Math.max(0, Math.min(255, adjusted));

            // Копируем в новый массив
            processedData[i] = clamped;      // R
            processedData[i + 1] = clamped;  // G
            processedData[i + 2] = clamped;  // B
            processedData[i + 3] = data[i + 3]; // A (alpha)
        }

        return new ImageData(processedData, width, height);
    }

    handleQRCode(qrData) {
        if (!qrData || qrData.trim() === '') {
            console.warn('⚠️ Получен пустой QR код');
            return;
        }

        // Дедупликация
        if (this.lastScannedCode === qrData) {
            console.log('⏭️ Пропускаем дублирующийся код');
            return;
        }

        this.lastScannedCode = qrData;
        setTimeout(() => {
            this.lastScannedCode = null;
        }, this.dedupeTime);

        const result = {
            id: Date.now(),
            data: qrData,
            timestamp: new Date(),
            type: this.detectMatterType(qrData),
            raw: this.parseQRCode(qrData)
        };

        console.log('📊 Результат:', result);

        // Проверяем, есть ли уже такой код в истории
        const isDuplicate = this.scannedResults.some(r => r.data === qrData);
        
        if (!isDuplicate) {
            this.scannedResults.unshift(result);
            this.saveScannedResults();
            this.renderResults();
            this.showToast('✅ QR код успешно отсканирован!', 'success');
            this.playBeep();
            console.log('💾 Результат сохранен в массив. Всего результатов:', this.scannedResults.length);
            
            // Останавливаем сканирование
            this.stopScanning();
            
            // Показываем результат в модальном окне
            setTimeout(() => {
                this.showDetail(result.id);
            }, 500);
        } else {
            console.log('ℹ️ Этот код уже в истории');
        }
    }

    detectMatterType(qrData) {
        if (!qrData) return '📱 QR Code';
        if (qrData.startsWith('MT:')) return '🔗 Matter Device';
        if (qrData.includes('https://matter.')) return '🔗 Matter Link';
        if (qrData.startsWith('http')) return '🌐 URL';
        return '📱 QR Code';
    }

    // Парсим Matter QR код
    parseQRCode(qrData) {
        const result = {
            raw: qrData,
            isMatter: false,
            matterData: null
        };

        if (qrData && qrData.startsWith('MT:')) {
            result.isMatter = true;
            try {
                const payload = qrData.substring(3);
                result.matterData = {
                    prefix: 'MT:',
                    payload: payload,
                    length: payload.length,
                    // Простой парсинг компонентов
                    components: this.parseMatterPayload(payload)
                };
            } catch (e) {
                console.error('Ошибка при парсинге Matter:', e);
            }
        }

        return result;
    }

    // Парсим Matter payload (base38 кодированный)
    parseMatterPayload(payload) {
        try {
            // Matter использует base38 кодирование
            // Попытаемся выделить компоненты
            const parts = payload.split(/[-. ]+/);
            return {
                segments: parts,
                segmentCount: parts.length,
                // Первый символ часто версия
                version: parts[0]?.[0],
                // Последние 4-6 символов часто PIN код
                possiblePin: parts[parts.length - 1]?.slice(-6)
            };
        } catch (e) {
            return null;
        }
    }

    renderResults() {
        if (this.scannedResults.length === 0) {
            this.resultsList.innerHTML = '<p class="empty-state">Сканированные коды будут отображены здесь</p>';
            return;
        }

        this.resultsList.innerHTML = this.scannedResults.map((result, index) => `
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
            console.log('📋 Доступные результаты:', this.scannedResults.map(r => r.id));
            return;
        }

        console.log('📖 Показываем детали для:', result);

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
                </div>
            `;
        }

        this.modalBody.innerHTML = `
            <h3>${result.type}</h3>
            <p><strong>Время:</strong> ${result.timestamp.toLocaleString('ru-RU')}</p>
            <h4>Полные данные QR кода:</h4>
            <pre style="word-break: break-all; white-space: pre-wrap; background-color: var(--bg-secondary); padding: 12px; border-radius: 4px; margin-bottom: 12px;">${this.escapeHtml(result.data)}</pre>
            ${matterInfo}
            <button class="btn btn-primary" style="width: 100%; margin-top: 12px;" onclick="scanner.copyToClipboard(${resultId})">📋 Копировать в буфер обмена</button>
        `;
        this.detailModal.classList.remove('hidden');
    }

    closeModal() {
        this.detailModal.classList.add('hidden');
    }

    copyToClipboard(resultId) {
        const result = this.scannedResults.find(r => r.id === resultId);
        if (result) {
            navigator.clipboard.writeText(result.data).then(() => {
                this.showToast('✅ Скопировано в буфер обмена', 'success');
            }).catch(() => {
                this.showToast('❌ Ошибка при копировании', 'error');
            });
        }
    }

    deleteResult(resultId) {
        this.scannedResults = this.scannedResults.filter(r => r.id !== resultId);
        this.saveScannedResults();
        this.renderResults();
        this.showToast('Результат удален', 'success');
    }

    toggleFlash() {
        if (!this.stream) return;

        const videoTrack = this.stream.getVideoTracks()[0];
        const capabilities = videoTrack.getCapabilities();

        if (!capabilities.torch) {
            this.showToast('Вспышка не поддерживается', 'error');
            return;
        }

        this.flashActive = !this.flashActive;
        videoTrack.applyConstraints({
            advanced: [{ torch: this.flashActive }]
        }).then(() => {
            this.updateFlashButton();
            this.showToast(this.flashActive ? '💡 Вспышка включена' : '💡 Вспышка выключена', 'success');
        }).catch(() => {
            this.showToast('Ошибка управления вспышкой', 'error');
            this.flashActive = !this.flashActive;
        });
    }

    updateFlashButton() {
        this.toggleFlashBtn.style.opacity = this.flashActive ? '1' : '0.7';
        this.toggleFlashBtn.style.backgroundColor = this.flashActive ? 'var(--warning-color)' : '';
    }

    showToast(message, type = 'info') {
        this.toast.textContent = message;
        this.toast.className = `toast ${type}`;
        this.toast.classList.remove('hidden');

        setTimeout(() => {
            this.toast.classList.add('hidden');
        }, 3000);
    }

    playBeep() {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.frequency.value = 800;
            oscillator.type = 'sine';

            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.5);
        } catch (error) {
            console.log('Audio context ошибка (это нормально):', error.message);
        }
    }

    formatTime(date) {
        const now = new Date();
        const diffMs = now - date;
        const diffSecs = Math.floor(diffMs / 1000);
        const diffMins = Math.floor(diffSecs / 60);
        const diffHours = Math.floor(diffMins / 60);

        if (diffSecs < 60) return 'только что';
        if (diffMins < 60) return `${diffMins} мин назад`;
        if (diffHours < 24) return `${diffHours} ч назад`;
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

    saveScannedResults() {
        const data = this.scannedResults.map(r => ({
            ...r,
            timestamp: r.timestamp.toISOString()
        }));
        localStorage.setItem('matterQRScans', JSON.stringify(data));
    }

    loadScannedResults() {
        const data = localStorage.getItem('matterQRScans');
        if (data) {
            try {
                this.scannedResults = JSON.parse(data).map(r => ({
                    ...r,
                    timestamp: new Date(r.timestamp)
                }));
                this.renderResults();
                console.log('📂 Загружено результатов:', this.scannedResults.length);
            } catch (e) {
                console.error('Ошибка при загрузке результатов:', e);
            }
        }
    }

    async registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            try {
                await navigator.serviceWorker.register('sw.js');
                console.log('✅ Service Worker зарегистрирован');
            } catch (error) {
                console.error('❌ Ошибка регистрации Service Worker:', error);
            }
        }
    }

    handleError(error) {
        console.error('Ошибка:', error);
        let message = 'Неизвестная ошибка';

        if (error.name === 'NotAllowedError') {
            message = 'Вы запретили доступ к камере. Разрешите в настройках браузера.';
        } else if (error.name === 'NotFoundError') {
            message = 'Камера не найдена. Проверьте устройство.';
        } else if (error.name === 'NotReadableError') {
            message = 'Камера занята другим приложением.';
        } else if (error.name === 'OverconstrainedError') {
            message = 'Камера не поддерживает запрашиваемые параметры. Пытаемся с меньшим разрешением...';
        }

        this.showToast(`❌ ${message}`, 'error');
    }
}

// Инициализация приложения
let scanner;
window.addEventListener('DOMContentLoaded', () => {
    scanner = new MatterQRScanner();
});
