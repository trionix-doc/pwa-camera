// QR Scanner App
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
        this.dedupeTime = 5000; // 5 секунд для дедупликации

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
    }

    async startScanning() {
        try {
            this.loadingEl.classList.remove('hidden');
            this.startBtn.disabled = true;

            const constraints = {
                video: {
                    facingMode: 'environment',
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: false
            };

            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.video.srcObject = this.stream;

            // Добавляем обработчик события onplay вместо onloadedmetadata
            this.video.onplay = () => {
                console.log('📹 Видео запущено');
                this.scanning = true;
                this.startBtn.classList.add('hidden');
                this.stopBtn.classList.remove('hidden');
                this.toggleFlashBtn.disabled = false;
                this.loadingEl.classList.add('hidden');
                this.showToast('Камера включена', 'success');
                // Начинаем сканирование
                this.scanQRCode();
            };

            // Пытаемся воспроизвести видео
            await this.video.play();

        } catch (error) {
            this.loadingEl.classList.add('hidden');
            this.startBtn.disabled = false;
            this.handleError(error);
        }
    }

    stopScanning() {
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
            console.log('⏳ Видео еще загружается...');
            this.scanningFrameId = requestAnimationFrame(() => this.scanQRCode());
            return;
        }

        try {
            this.canvas.width = this.video.videoWidth;
            this.canvas.height = this.video.videoHeight;
            
            // Рисуем текущий кадр из видео
            this.canvasContext.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);

            // Получаем данные изображения
            const imageData = this.canvasContext.getImageData(
                0, 0, this.canvas.width, this.canvas.height
            );

            // Сканируем QR код
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: 'dontInvert'
            });

            if (code) {
                console.log('✅ QR код найден:', code.data);
                this.handleQRCode(code.data);
                // Не останавливаем сканирование автоматически, даём пользователю время
            }

        } catch (error) {
            console.error('❌ Ошибка при сканировании:', error);
        }

        this.scanningFrameId = requestAnimationFrame(() => this.scanQRCode());
    }

    handleQRCode(qrData) {
        // Дедупликация - не добавляем одинаковые коды в течение 5 секунд
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
            type: this.detectMatterType(qrData)
        };

        // Проверяем, есть ли уже такой код в истории
        if (!this.scannedResults.some(r => r.data === qrData)) {
            this.scannedResults.unshift(result);
            this.saveScannedResults();
            this.renderResults();
            this.showToast('✅ QR код успешно отсканирован!', 'success');
            this.playBeep();
            console.log('💾 Результат сохранен:', result);
        } else {
            console.log('ℹ️ Этот код уже в истории');
        }
    }

    detectMatterType(qrData) {
        // Попытка определить тип устройства Matter по содержимому QR кода
        if (qrData.includes('MT:')) return 'Matter Device';
        if (qrData.includes('https://matter.')) return 'Matter Link';
        return 'QR Code';
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
        if (!result) return;

        const matterData = this.parseMatterData(result.data);
        this.modalBody.innerHTML = `
            <h3>📱 ${result.type}</h3>
            <p><strong>Время сканирования:</strong> ${result.timestamp.toLocaleString('ru-RU')}</p>
            <h4>Данные QR кода:</h4>
            <pre>${this.escapeHtml(result.data)}</pre>
            ${matterData ? `
                <h4>Распознанные данные Matter:</h4>
                <div style="background-color: var(--bg-secondary); padding: 12px; border-radius: 4px; margin-bottom: 12px;">
                    ${matterData}
                </div>
            ` : ''}
            <button class="btn btn-primary" style="width: 100%;" onclick="scanner.copyToClipboard(${resultId})">📋 Копировать в буфер обмена</button>
        `;
        this.detailModal.classList.remove('hidden');
    }

    parseMatterData(data) {
        // Простой парсинг Matter данных
        try {
            if (data.startsWith('MT:')) {
                const parts = data.substring(3).split('/');
                let html = '';
                parts.forEach((part, i) => {
                    if (part) html += `<p><code>${this.escapeHtml(part)}</code></p>`;
                });
                return html;
            }
            return null;
        } catch (e) {
            return null;
        }
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
            this.showToast(this.flashActive ? 'Вспышка включена' : 'Вспышка выключена', 'success');
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
            console.log('Audio context error (this is ok):', error);
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
            } catch (e) {
                console.error('Ошибка при загрузке результатов:', e);
            }
        }
    }

    async registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            try {
                await navigator.serviceWorker.register('sw.js');
                console.log('Service Worker зарегистрирован');
            } catch (error) {
                console.error('Ошибка регистрации Service Worker:', error);
            }
        }
    }

    handleError(error) {
        console.error('Ошибка:', error);
        let message = 'Неизвестная ошибка';

        if (error.name === 'NotAllowedError') {
            message = 'Вы запретили доступ к камере. Пожалуйста, разрешите доступ в настройках.';
        } else if (error.name === 'NotFoundError') {
            message = 'Камера не найдена. Проверьте устройство.';
        } else if (error.name === 'NotReadableError') {
            message = 'Камера занята другим приложением.';
        }

        this.showToast(`❌ ${message}`, 'error');
    }
}

// Инициализация приложения
let scanner;
window.addEventListener('DOMContentLoaded', () => {
    scanner = new MatterQRScanner();
});
