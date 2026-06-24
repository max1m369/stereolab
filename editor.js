/**
 * StereoLab MTS — Встроенный редактор карт глубины
 * Реализует:
 * 1. Рисование кистью (сглаживание, жесткость, высота).
 * 2. Генератор простых 3D-форм (сфера, пирамида, конус, склон).
 * 3. Генератор 3D-текста (distance transform: flat, beveled, rounded).
 * 4. Стек отмены/повтора (Undo/Redo), размытие и инверсию.
 */

class DepthEditor {
    constructor(canvasIdOrElement) {
        this.canvas = typeof canvasIdOrElement === 'string' ? document.getElementById(canvasIdOrElement) : canvasIdOrElement;
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
        
        // Настройки кисти по умолчанию
        this.brushSize = 40;
        this.brushBlur = 20;
        this.brushHeight = 255; // Белый по умолчанию (близко)
        this.isDrawing = false;
        this.lastX = 0;
        this.lastY = 0;
        
        // Стек отмены/повтора
        this.undoStack = [];
        this.redoStack = [];
        this.maxStackSize = 20;
        
        // Выбранный инструмент ('brush', 'text', 'shapes')
        this.currentTool = 'brush';
        // Выбранная 3D фигура для рисования ('pyramid', 'cone', 'sphere', 'slope')
        this.selectedShape = 'pyramid';
        this.shapeHeight = 255;
        
        // Настройки 3D текста
        this.textString = "3D TEXT";
        this.textFont = "Outfit";
        this.textSize = 120;
        this.textLineSpacing = 1.2;
        this.textProfile = "beveled"; // 'flat', 'beveled', 'rounded'
        
        // Инициализация холста
        this.clearCanvas();
        this.saveState(); // Сохраняем исходное пустое состояние
        
        this.initEvents();
    }
    
    initEvents() {
        // События мыши для рисования
        this.canvas.addEventListener('mousedown', (e) => {
            if (this.currentTool !== 'brush') return;
            this.isDrawing = true;
            const rect = this.canvas.getBoundingClientRect();
            const x = (e.clientX - rect.left) * (this.canvas.width / rect.width);
            const y = (e.clientY - rect.top) * (this.canvas.height / rect.height);
            this.lastX = x;
            this.lastY = y;
            
            this.drawBrushCircle(x, y);
        });
        
        window.addEventListener('mousemove', (e) => {
            if (!this.isDrawing || this.currentTool !== 'brush') return;
            const rect = this.canvas.getBoundingClientRect();
            const x = (e.clientX - rect.left) * (this.canvas.width / rect.width);
            const y = (e.clientY - rect.top) * (this.canvas.height / rect.height);
            
            this.drawBrushLine(this.lastX, this.lastY, x, y);
            this.lastX = x;
            this.lastY = y;
        });
        
        const stopDrawing = () => {
            if (this.isDrawing) {
                this.isDrawing = false;
                this.saveState();
                
                // Оповещаем о завершении рисования
                const event = new CustomEvent('draw-end');
                this.canvas.dispatchEvent(event);
            }
        };
        
        window.addEventListener('mouseup', stopDrawing);
        
        // Поддержка Touch-экранов (мобильные устройства)
        this.canvas.addEventListener('touchstart', (e) => {
            if (this.currentTool !== 'brush') return;
            e.preventDefault();
            this.isDrawing = true;
            const rect = this.canvas.getBoundingClientRect();
            const touch = e.touches[0];
            const x = (touch.clientX - rect.left) * (this.canvas.width / rect.width);
            const y = (touch.clientY - rect.top) * (this.canvas.height / rect.height);
            this.lastX = x;
            this.lastY = y;
            this.drawBrushCircle(x, y);
        });
        
        this.canvas.addEventListener('touchmove', (e) => {
            if (!this.isDrawing || this.currentTool !== 'brush') return;
            e.preventDefault();
            const rect = this.canvas.getBoundingClientRect();
            const touch = e.touches[0];
            const x = (touch.clientX - rect.left) * (this.canvas.width / rect.width);
            const y = (touch.clientY - rect.top) * (this.canvas.height / rect.height);
            this.drawBrushLine(this.lastX, this.lastY, x, y);
            this.lastX = x;
            this.lastY = y;
        });
        
        this.canvas.addEventListener('touchend', stopDrawing);
    }
    
    // Рисование одной точки кисти
    drawBrushCircle(x, y) {
        const radius = this.brushSize / 2;
        const color = `rgb(${this.brushHeight}, ${this.brushHeight}, ${this.brushHeight})`;
        
        this.ctx.save();
        if (this.brushBlur > 0) {
            // Создаем радиальный градиент для мягкой кисти
            const grad = this.ctx.createRadialGradient(x, y, radius - this.brushBlur/2, x, y, radius + this.brushBlur/2);
            grad.addColorStop(0, color);
            grad.addColorStop(1, `rgba(${this.brushHeight}, ${this.brushHeight}, ${this.brushHeight}, 0)`);
            this.ctx.fillStyle = grad;
            
            this.ctx.beginPath();
            this.ctx.arc(x, y, radius + this.brushBlur/2, 0, Math.PI * 2);
            this.ctx.fill();
        } else {
            // Жесткая кисть
            this.ctx.fillStyle = color;
            this.ctx.beginPath();
            this.ctx.arc(x, y, radius, 0, Math.PI * 2);
            this.ctx.fill();
        }
        this.ctx.restore();
    }
    
    // Рисование непрерывной линии (интерполяция шагов)
    drawBrushLine(x0, y0, x1, y1) {
        const dist = Math.hypot(x1 - x0, y1 - y0);
        // Рисуем круги каждые 2 пикселя для непрерывности
        const steps = Math.ceil(dist / 2);
        for (let i = 0; i <= steps; i++) {
            const t = steps === 0 ? 0 : i / steps;
            const cx = x0 + (x1 - x0) * t;
            const cy = y0 + (y1 - y0) * t;
            this.drawBrushCircle(cx, cy);
        }
    }
    
    // Очистка холста фоновым черным цветом (глубина = 0)
    clearCanvas() {
        this.ctx.fillStyle = '#000000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    
    // Сохраняет текущее состояние холста в стек отмены (Undo)
    saveState() {
        const imgData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        this.undoStack.push(imgData);
        if (this.undoStack.length > this.maxStackSize) {
            this.undoStack.shift();
        }
        // Очищаем стек повтора при новом действии
        this.redoStack = [];
    }
    
    // Отмена (Undo)
    undo() {
        if (this.undoStack.length > 1) {
            const currentState = this.undoStack.pop();
            this.redoStack.push(currentState);
            const prevState = this.undoStack[this.undoStack.length - 1];
            this.ctx.putImageData(prevState, 0, 0);
        }
    }
    
    // Повтор (Redo)
    redo() {
        if (this.redoStack.length > 0) {
            const nextState = this.redoStack.pop();
            this.undoStack.push(nextState);
            this.ctx.putImageData(nextState, 0, 0);
        }
    }
    
    // Инвертирование карты глубин (выпуклое <-> вогнутое)
    invert() {
        const imgData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
            data[i] = 255 - data[i];       // R
            data[i + 1] = 255 - data[i + 1]; // G
            data[i + 2] = 255 - data[i + 2]; // B
        }
        this.ctx.putImageData(imgData, 0, 0);
        this.saveState();
    }
    
    // Размытие карты глубин (сглаживание переходов)
    blur() {
        this.ctx.save();
        // Используем встроенный фильтр размытия Canvas для быстрого сглаживания
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = this.canvas.width;
        tempCanvas.height = this.canvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(this.canvas, 0, 0);
        
        this.ctx.filter = 'blur(6px)';
        this.ctx.drawImage(tempCanvas, 0, 0);
        this.ctx.restore();
        this.saveState();
    }
    
    // Возвращает двумерный массив высот [y][x] для ядра рендеринга
    getDepthMap2D() {
        const imgData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        const data = imgData.data;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const map = [];
        
        for (let y = 0; y < h; y++) {
            const row = new Uint8Array(w);
            for (let x = 0; x < w; x++) {
                const idx = (y * w + x) * 4;
                // Карты глубины Ч/Б, берем просто красный канал
                row[x] = data[idx];
            }
            map.push(row);
        }
        return map;
    }
    
    // Отрисовка шаблона простой 3D фигуры по центру холста
    drawPresetShape(shapeName, maxH) {
        this.clearCanvas();
        const w = this.canvas.width;
        const h = this.canvas.height;
        const cx = w / 2;
        const cy = h / 2;
        const radius = Math.min(w, h) * 0.35; // 35% от размера
        
        const imgData = this.ctx.getImageData(0, 0, w, h);
        const data = imgData.data;
        
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const dx = x - cx;
                const dy = y - cy;
                const dist = Math.hypot(dx, dy);
                let val = 0;
                
                if (shapeName === 'sphere') {
                    if (dist < radius) {
                        // Сферический купол: полусфера
                        val = Math.sqrt(1 - Math.pow(dist / radius, 2)) * maxH;
                    }
                } else if (shapeName === 'cone') {
                    if (dist < radius) {
                        // Конус: линейный спуск от вершины к основанию
                        val = (1 - dist / radius) * maxH;
                    }
                } else if (shapeName === 'pyramid') {
                    // Пирамида с квадратным основанием
                    const maxDist = Math.max(Math.abs(dx), Math.abs(dy));
                    if (maxDist < radius) {
                        val = (1 - maxDist / radius) * maxH;
                    }
                } else if (shapeName === 'slope') {
                    // Наклонная плоскость (наклон сверху вниз)
                    val = (y / h) * maxH;
                }
                
                const idx = (y * w + x) * 4;
                const colorVal = Math.round(val);
                data[idx] = colorVal;
                data[idx + 1] = colorVal;
                data[idx + 2] = colorVal;
                data[idx + 3] = 255;
            }
        }
        
        this.ctx.putImageData(imgData, 0, 0);
        this.saveState();
    }
    
    // Вставка фигуры в произвольное (центральное) место без очистки холста (объединение)
    addShapeInteractive() {
        const w = this.canvas.width;
        const h = this.canvas.height;
        const cx = w / 2;
        const cy = h / 2;
        const radius = 150; // радиус фигуры
        
        const imgData = this.ctx.getImageData(0, 0, w, h);
        const data = imgData.data;
        
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const dx = x - cx;
                const dy = y - cy;
                const dist = Math.hypot(dx, dy);
                let val = 0;
                
                if (this.selectedShape === 'sphere') {
                    if (dist < radius) {
                        val = Math.sqrt(1 - Math.pow(dist / radius, 2)) * this.shapeHeight;
                    }
                } else if (this.selectedShape === 'cone') {
                    if (dist < radius) {
                        val = (1 - dist / radius) * this.shapeHeight;
                    }
                } else if (this.selectedShape === 'pyramid') {
                    const maxDist = Math.max(Math.abs(dx), Math.abs(dy));
                    if (maxDist < radius) {
                        val = (1 - maxDist / radius) * this.shapeHeight;
                    }
                } else if (this.selectedShape === 'slope') {
                    val = (y / h) * this.shapeHeight;
                }
                
                if (val > 0) {
                    const idx = (y * w + x) * 4;
                    // Объединяем через Math.max (чтобы более высокие детали накладывались сверху)
                    const finalVal = Math.max(data[idx], Math.round(val));
                    data[idx] = finalVal;
                    data[idx + 1] = finalVal;
                    data[idx + 2] = finalVal;
                    data[idx + 3] = 255;
                }
            }
        }
        
        this.ctx.putImageData(imgData, 0, 0);
        this.saveState();
    }
    
    // ГЕНЕРАТОР 3D ТЕКСТА НА ОСНОВЕ DISTANCE TRANSFORM
    add3DText() {
        const w = this.canvas.width;
        const h = this.canvas.height;
        
        // 1. Создаем скрытый временный холст для рендеринга 2D маски текста
        const textCanvas = document.createElement('canvas');
        textCanvas.width = w;
        textCanvas.height = h;
        const tCtx = textCanvas.getContext('2d');
        
        // Очищаем черным фоном
        tCtx.fillStyle = '#000000';
        tCtx.fillRect(0, 0, w, h);
        
        // Настраиваем шрифт
        tCtx.font = `bold ${this.textSize}px "${this.textFont}", sans-serif`;
        tCtx.fillStyle = '#ffffff';
        tCtx.textAlign = 'center';
        // Пишем текст по центру (с поддержкой переносов строк до 6 строк)
        const lines = this.textString.split('\n').slice(0, 6);
        const numLines = lines.length;
        const lineSpacingVal = this.textLineSpacing || 1.2;
        const lineHeight = this.textSize * lineSpacingVal;
        
        for (let i = 0; i < numLines; i++) {
            const offsetY = (i - (numLines - 1) / 2) * lineHeight;
            tCtx.fillText(lines[i], w / 2, h / 2 + offsetY);
        }
        
        // Извлекаем маску (белый текст на черном фоне)
        const maskData = tCtx.getImageData(0, 0, w, h);
        const mask = maskData.data;
        
        // 2. Алгоритм быстрого двумерного Chamfer Distance Transform (аппроксимация расстояния до края)
        const dist = new Float32Array(w * h);
        const maxVal = 999999;
        
        // Инициализация
        for (let i = 0; i < w * h; i++) {
            // Если пиксель черный (фон), расстояние 0. Если белый (буква), ставим бесконечность.
            dist[i] = (mask[i * 4] === 0) ? 0 : maxVal;
        }
        
        // Первый проход: сверху-вниз, слева-направо
        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const idx = y * w + x;
                if (dist[idx] > 0) {
                    const d1 = dist[idx - w] + 1;       // Верхний
                    const d2 = dist[idx - 1] + 1;       // Левый
                    const d3 = dist[idx - w - 1] + 1.4; // Верхне-левый
                    const d4 = dist[idx - w + 1] + 1.4; // Верхне-правый
                    dist[idx] = Math.min(dist[idx], d1, d2, d3, d4);
                }
            }
        }
        
        // Второй проход: снизу-вверх, справа-налево
        for (let y = h - 2; y >= 1; y--) {
            for (let x = w - 2; x >= 1; x--) {
                const idx = y * w + x;
                if (dist[idx] > 0) {
                    const d1 = dist[idx + w] + 1;       // Нижний
                    const d2 = dist[idx + 1] + 1;       // Правый
                    const d3 = dist[idx + w + 1] + 1.4; // Нижне-правый
                    const d4 = dist[idx + w - 1] + 1.4; // Нижне-левый
                    dist[idx] = Math.min(dist[idx], d1, d2, d3, d4);
                }
            }
        }
        
        // 3. Вычисление глубины на основе расстояния до края
        const canvasImgData = this.ctx.getImageData(0, 0, w, h);
        const canvasData = canvasImgData.data;
        
        // Задаем ширину скоса/закругления (bevel width) в пикселях.
        // Зависит от размера шрифта. Примерно 10% от размера шрифта.
        const bevelWidth = Math.max(5, Math.round(this.textSize * 0.12)); 
        const textDepthVal = this.brushHeight; // Максимальная глубина текста (по умолчанию 255)
        
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = y * w + x;
                const pixIdx = idx * 4;
                
                if (dist[idx] > 0) {
                    // Пиксель внутри буквы
                    let depth = textDepthVal;
                    
                    if (this.textProfile === 'beveled') {
                        // Скошенный край: линейный рост высоты у края
                        const t = Math.min(1.0, dist[idx] / bevelWidth);
                        depth = t * textDepthVal;
                    } else if (this.textProfile === 'rounded') {
                        // Округлый край: сферический купол
                        const t = Math.min(1.0, dist[idx] / bevelWidth);
                        depth = Math.sin(t * Math.PI / 2) * textDepthVal;
                    }
                    
                    // Объединяем с текущим изображением на холсте
                    const finalVal = Math.max(canvasData[pixIdx], Math.round(depth));
                    canvasData[pixIdx] = finalVal;
                    canvasData[pixIdx + 1] = finalVal;
                    canvasData[pixIdx + 2] = finalVal;
                    canvasData[pixIdx + 3] = 255;
                }
            }
        }
        
        this.ctx.putImageData(canvasImgData, 0, 0);
        this.saveState();
    }
}

// Экспортируем в глобальную область видимости
window.DepthEditor = DepthEditor;
