/**
 * StereoLab MTS — Ядро рендеринга стереограмм (CPU)
 * Реализует построчный 2D TIM (Thimbleby-Inglis-McIntosh) алгоритм с
 * левоориентированной моделью HSR и поддержкой Left/Middle базовых полос.
 */

(function () {
    const StereoCore = {
        /**
         * Генерирует пиксели стереограммы
         * @param {Object} opts Параметры рендеринга
         * @returns {Uint8ClampedArray} RGBA пиксели для Canvas
         */
        generate: function (opts) {
            const width = opts.width;
            const height = opts.height;
            const depthData = opts.depthData; // 2D массив [y][x] значений от 0 до 255
            const type = opts.type || 'mts'; // 'mts', 'rds', 'mask'
            const eyeSep = opts.eyeSep || 140; // Расстояние между глазами в пикселях
            const maxDepth = opts.maxDepth || 25; // Максимальный сдвиг глубины
            const viewMode = opts.viewMode || 'wall-eyed'; // 'wall-eyed' | 'cross-eyed'
            const textureData = opts.textureData; // ImageData объекта текстуры
            const colorsPalette = opts.colors || null; // Массив цветов для RDS
            const subpixels = opts.subpixels || 1; // Количество субпикселей (1 для превью, 3 для качества)
            const mainStripeMode = opts.mainStripeMode || 'middle'; // 'left' | 'middle'

            const W = width * subpixels;
            const pixels = new Uint8ClampedArray(width * height * 4);

            const texW = textureData ? textureData.width : 0;
            const texH = textureData ? textureData.height : 0;
            const texData = textureData ? textureData.data : null;

            // Вычисляем границы базовой полосы в субпикселях
            const stripeWidth = eyeSep * subpixels;
            const stripeLeft = mainStripeMode === 'left' ? 0 : Math.round((W / 2) - stripeWidth / 2);
            const stripeRight = stripeLeft + stripeWidth;

            // Хелпер для извлечения глубины
            const getDepth = (x_sub) => {
                const x_pixel = x_sub / subpixels;
                if (x_pixel < 0 || x_pixel >= width) return 0;
                let d = 0;
                if (subpixels > 1) {
                    const x0 = Math.floor(x_pixel);
                    const x1 = Math.min(width - 1, x0 + 1);
                    const tx = x_pixel - x0;
                    d = depthData[y][x0] * (1 - tx) + depthData[y][x1] * tx;
                } else {
                    d = depthData[y][Math.min(width - 1, Math.floor(x_pixel))];
                }
                return viewMode === 'cross-eyed' ? 255.0 - d : d;
            };

            let y = 0; // Определяем y в области видимости генератора

            for (y = 0; y < height; y++) {
                const same = new Int32Array(W);
                for (let x = 0; x < W; x++) same[x] = x;

                const minSep = (eyeSep - maxDepth) * subpixels;

                // 1. Построение карты связей пикселей (Center-Out)
                // Левая часть: распространение от центра к левому краю (справа налево)
                for (let x = stripeLeft - 1; x >= 0; x--) {
                    const d = getDepth(x);
                    const sep = Math.round((eyeSep - (d / 255.0) * maxDepth) * subpixels);
                    const left = x;
                    const right = left + sep;

                    if (left >= 0 && right < W) {
                        let visible = true;

                        if (opts.useHSR !== false) {
                            // Оптимизированный интервал проверки окклюзии (HSR)
                            const tStart = Math.ceil(left + minSep + 1);
                            const tEnd = Math.floor(right - 1);

                            for (let t = tStart; t <= tEnd; t++) {
                                const d_t = getDepth(t);
                                const sep_t = Math.round((eyeSep - (d_t / 255.0) * maxDepth) * subpixels);
                                if (t - sep_t > left) {
                                    visible = false;
                                    break;
                                }
                            }
                        }

                        if (visible) {
                            let k = left;
                            while (same[k] !== k && same[k] !== right) {
                                k = same[k];
                            }
                            same[k] = right;
                        } else {
                            // Fallback to background shift to ensure texture continuity behind occlusions
                            const bg_right = left + stripeWidth;
                            if (bg_right < W) {
                                let k = left;
                                while (same[k] !== k && same[k] !== bg_right) {
                                    k = same[k];
                                }
                                same[k] = bg_right;
                            }
                        }
                    }
                }

                // Правая часть: распространение от центра к правому краю (слева направо)
                for (let x = stripeRight; x < W; x++) {
                    // 1-step corrector для определения левой границы
                    const approx_d = getDepth(x - stripeWidth);
                    const approx_sep = Math.round((eyeSep - (approx_d / 255.0) * maxDepth) * subpixels);
                    
                    const d = getDepth(x - approx_sep);
                    const sep = Math.round((eyeSep - (d / 255.0) * maxDepth) * subpixels);
                    const left = x - sep;
                    const right = x;

                    if (left >= 0 && right < W) {
                        let visible = true;

                        if (opts.useHSR !== false) {
                            // Оптимизированный интервал проверки окклюзии (HSR)
                            const tStart = Math.ceil(left + minSep + 1);
                            const tEnd = Math.floor(right - 1);

                            for (let t = tStart; t <= tEnd; t++) {
                                const d_t = getDepth(t);
                                const sep_t = Math.round((eyeSep - (d_t / 255.0) * maxDepth) * subpixels);
                                if (t - sep_t > left) {
                                    visible = false;
                                    break;
                                }
                            }
                        }

                        if (visible) {
                            let k = right;
                            while (same[k] !== k && same[k] !== left) {
                                k = same[k];
                            }
                            same[k] = left;
                        } else {
                            // Fallback to background shift to ensure texture continuity behind occlusions
                            const bg_left = right - stripeWidth;
                            if (bg_left >= 0) {
                                let k = right;
                                while (same[k] !== k && same[k] !== bg_left) {
                                    k = same[k];
                                }
                                same[k] = bg_left;
                            }
                        }
                    }
                }

                // 2. Разрешение цветов и субпиксельное сглаживание
                if (type === 'mask') {
                    const classSizes = new Int32Array(W);
                    for (let x = 0; x < W; x++) {
                        let root = x;
                        while (same[root] !== root) root = same[root];
                        classSizes[root]++;
                    }
                    for (let px = 0; px < width; px++) {
                        const startSub = px * subpixels;
                        let maxClassSize = 0;
                        for (let n = 0; n < subpixels; n++) {
                            let root = startSub + n;
                            while (same[root] !== root) root = same[root];
                            if (classSizes[root] > maxClassSize) {
                                maxClassSize = classSizes[root];
                            }
                        }
                        const colorVal = (maxClassSize > subpixels) ? 255 : 0;
                        const outIdx = (y * width + px) * 4;
                        pixels[outIdx] = colorVal;
                        pixels[outIdx + 1] = colorVal;
                        pixels[outIdx + 2] = colorVal;
                        pixels[outIdx + 3] = 255;
                    }
                } else {
                    const rowColors = new Uint8ClampedArray(W * 3);
                    const resolvedColor = new Map();

                    for (let x = 0; x < W; x++) {
                        let root = x;
                        while (same[root] !== root) {
                            root = same[root];
                        }

                        if (!resolvedColor.has(root)) {
                            let r = 0, g = 0, b = 0;

                            if (type === 'rds') {
                                if (colorsPalette && colorsPalette.length > 0) {
                                    const c = colorsPalette[Math.floor(Math.random() * colorsPalette.length)];
                                    r = c[0];
                                    g = c[1];
                                    b = c[2];
                                } else {
                                    r = Math.floor(Math.random() * 256);
                                    g = Math.floor(Math.random() * 256);
                                    b = Math.floor(Math.random() * 256);
                                }
                            } else { // 'mts'
                                if (textureData) {
                                    // Сдвигаем координату сэмплирования паттерна на величину stripeLeft для точной синхронизации
                                    const pixelX = (root - stripeLeft) / subpixels;
                                    const tx = ((pixelX % texW) + texW) % texW;
                                    const ty = y % texH;
                                    
                                    const tx0 = Math.floor(tx);
                                    const tx1 = (tx0 + 1) % texW;
                                    const ty0 = Math.floor(ty);
                                    const ty1 = (ty0 + 1) % texH;
                                    
                                    const kx = tx - tx0;
                                    const ky = ty - ty0;
                                    
                                    const idx00 = (ty0 * texW + tx0) * 4;
                                    const idx10 = (ty0 * texW + tx1) * 4;
                                    const idx01 = (ty1 * texW + tx0) * 4;
                                    const idx11 = (ty1 * texW + tx1) * 4;
                                    
                                    const r0 = texData[idx00] * (1 - kx) + texData[idx10] * kx;
                                    const r1 = texData[idx01] * (1 - kx) + texData[idx11] * kx;
                                    r = r0 * (1 - ky) + r1 * ky;
                                    
                                    const g0 = texData[idx00 + 1] * (1 - kx) + texData[idx10 + 1] * kx;
                                    const g1 = texData[idx01 + 1] * (1 - kx) + texData[idx11 + 1] * kx;
                                    g = g0 * (1 - ky) + g1 * ky;
                                    
                                    const b0 = texData[idx00 + 2] * (1 - kx) + texData[idx10 + 2] * kx;
                                    const b1 = texData[idx01 + 2] * (1 - kx) + texData[idx11 + 2] * kx;
                                    b = b0 * (1 - ky) + b1 * ky;
                                } else {
                                    const pixelX = Math.floor((root - stripeLeft) / subpixels);
                                    const colorVal = (((pixelX % 60) + 60) % 60 < 30) ? 200 : 50;
                                    r = colorVal;
                                    g = 100;
                                    b = 150;
                                }
                            }

                            resolvedColor.set(root, [r, g, b]);
                        }

                        const col = resolvedColor.get(root);
                        const idx = x * 3;
                        rowColors[idx] = col[0];
                        rowColors[idx + 1] = col[1];
                        rowColors[idx + 2] = col[2];
                    }

                    // Даунсэмплинг для антиалиасинга
                    for (let px = 0; px < width; px++) {
                        let sumR = 0, sumG = 0, sumB = 0;
                        const startSub = px * subpixels;
                        for (let n = 0; n < subpixels; n++) {
                            const idx = (startSub + n) * 3;
                            sumR += rowColors[idx];
                            sumG += rowColors[idx + 1];
                            sumB += rowColors[idx + 2];
                        }
                        const outIdx = (y * width + px) * 4;
                        pixels[outIdx] = Math.round(sumR / subpixels);
                        pixels[outIdx + 1] = Math.round(sumG / subpixels);
                        pixels[outIdx + 2] = Math.round(sumB / subpixels);
                        pixels[outIdx + 3] = 255;
                    }
                }
            }

            return pixels;
        }
    };

    window.StereoCore = StereoCore;
})();
