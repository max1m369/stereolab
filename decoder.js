/**
 * StereoLab MTS — Декодер стереограмм
 * Реализует:
 * 1. Дифференциальный декодер (быстрый сдвиг-вычитание).
 * 2. Корреляционный декодер для полной реконструкции карты глубин.
 */

const StereoDecoder = {
    /**
     * Быстрое дифференциальное декодирование (вычитание смещенных пикселей)
     * @param {ImageData} inputData Исходное изображение стереограммы
     * @param {number} sep Сдвиг в пикселях
     * @param {number} contrast Множитель контраста (например, 1.5)
     * @returns {Uint8ClampedArray} Пиксели RGBA для вывода результата
     */
    decodeDiff: function (inputData, sep, contrast) {
        const width = inputData.width;
        const height = inputData.height;
        const src = inputData.data;
        const dest = new Uint8ClampedArray(width * height * 4);
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;
                
                // Проверяем пиксель на расстоянии сдвига sep
                if (x + sep < width) {
                    const shiftIdx = (y * width + (x + sep)) * 4;
                    
                    // Вычисляем абсолютную разность по каналам RGB
                    const dr = Math.abs(src[idx] - src[shiftIdx]);
                    const dg = Math.abs(src[idx + 1] - src[shiftIdx + 1]);
                    const db = Math.abs(src[idx + 2] - src[shiftIdx + 2]);
                    
                    // Средняя разность
                    let diff = (dr + dg + db) / 3;
                    
                    // Применяем контраст и нормализацию
                    diff = Math.min(255, diff * contrast);
                    
                    // Инвертируем: если пиксели СОВПАДАЮТ (разница 0), это фон (красим в белый/светлый)
                    // Если пиксели НЕ СОВПАДАЮТ (разница > 0), это край объекта (красим в темный)
                    // Либо наоборот, делаем скрытый объект ярким на темном фоне.
                    // Сделаем светлый силуэт на темном фоне:
                    dest[idx] = diff;
                    dest[idx + 1] = diff;
                    dest[idx + 2] = diff;
                    dest[idx + 3] = 255;
                } else {
                    // Пиксели у правого края, для которых нет сдвига
                    dest[idx] = 0;
                    dest[idx + 1] = 0;
                    dest[idx + 2] = 0;
                    dest[idx + 3] = 255;
                }
            }
        }
        return dest;
    },

    /**
     * Реконструкция карты глубины методом корреляционного сопоставления блоков
     * Сканирует диапазон сдвигов и находит наилучшее совпадение для каждого пикселя
     * @param {ImageData} inputData Исходное изображение стереограммы
     * @param {number} baseSep Базовый сдвиг (расстояние при нулевой глубине)
     * @returns {Uint8ClampedArray} Восстановленная карта глубины (RGBA)
     */
    reconstructDepth: function (inputData, baseSep) {
        const width = inputData.width;
        const height = inputData.height;
        const src = inputData.data;
        const dest = new Uint8ClampedArray(width * height * 4);
        
        // Диапазон поиска сдвигов (относительно baseSep)
        // Стереограмма обычно имеет сдвиги в меньшую сторону (для параллельного взгляда)
        // Ищем в диапазоне [baseSep - 35, baseSep + 5]
        const minSep = Math.max(10, baseSep - 35);
        const maxSep = Math.min(width - 1, baseSep + 5);
        const searchRange = maxSep - minSep;
        
        // Размер окна сопоставления (1D горизонтальное окно вокруг пикселя)
        const winRadius = 4; // Окно шириной 9 пикселей (-4 до +4)
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;
                
                // Если мы слишком близко к краям, пишем черный
                if (x < winRadius || x >= width - baseSep - winRadius) {
                    dest[idx] = 0;
                    dest[idx + 1] = 0;
                    dest[idx + 2] = 0;
                    dest[idx + 3] = 255;
                    continue;
                }
                
                let bestSep = baseSep;
                let minDiff = 999999;
                
                // Перебираем все возможные сдвиги в диапазоне
                for (let s = minSep; s <= maxSep; s++) {
                    let totalDiff = 0;
                    
                    // Считаем разность по горизонтальному окну
                    for (let dx = -winRadius; dx <= winRadius; dx++) {
                        const px1 = ((y * width) + (x + dx)) * 4;
                        const px2 = ((y * width) + (x + s + dx)) * 4;
                        
                        const dr = src[px1] - src[px2];
                        const dg = src[px1 + 1] - src[px2 + 1];
                        const db = src[px1 + 2] - src[px2 + 2];
                        
                        totalDiff += Math.abs(dr) + Math.abs(dg) + Math.abs(db);
                    }
                    
                    if (totalDiff < minDiff) {
                        minDiff = totalDiff;
                        bestSep = s;
                    }
                }
                
                // Преобразуем найденный сдвиг s в глубину (0-255)
                // Для параллельного взгляда: меньший сдвиг s = более близкий объект (белый)
                // Формула: чем меньше s относительно baseSep, тем выше глубина
                let depth = 0;
                if (bestSep < baseSep) {
                    // Нормализуем разность [0, baseSep - minSep] в диапазон [0, 255]
                    const maxDiffSep = baseSep - minSep;
                    const diffSep = baseSep - bestSep;
                    depth = Math.round((diffSep / maxDiffSep) * 255);
                }
                
                // Записываем серый пиксель глубины
                dest[idx] = depth;
                dest[idx + 1] = depth;
                dest[idx + 2] = depth;
                dest[idx + 3] = 255;
            }
        }
        
        // Дополнительный проход простого сглаживания шумов для более чистой Ч/Б карты глубин
        const temp = new Uint8ClampedArray(dest);
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = (y * width + x) * 4;
                
                // Проверяем только если это не края
                let sum = 0;
                // Берем среднее по кресту
                sum += temp[idx - 4]; // левый
                sum += temp[idx + 4]; // правый
                sum += temp[idx - width * 4]; // верхний
                sum += temp[idx + width * 4]; // нижний
                sum += temp[idx]; // центр
                
                const avg = Math.round(sum / 5);
                dest[idx] = avg;
                dest[idx + 1] = avg;
                dest[idx + 2] = avg;
            }
        }
        
        return dest;
    }
};

// Экспортируем в глобальную область видимости
window.StereoDecoder = StereoDecoder;
