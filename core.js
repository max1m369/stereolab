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
            const getDepth = (x_sub, y) => {
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

            const algorithm = opts.algorithm || 'stereolab';
            const useYShift = opts.useYShift !== false;
            const yShift = opts.yShift || 0;
            const useRetouch = opts.useRetouch !== false;

            for (let y = 0; y < height; y++) {
                const same = new Int32Array(W);
                for (let x = 0; x < W; x++) same[x] = x;

                const minSep = (eyeSep - maxDepth) * subpixels;

                if (algorithm === 'steer') {
                    // --- 1. АЛГОРИТМ ЭНДРЮ СТИРА (Связи и HSR) ---
                    const lookL = new Int32Array(W);
                    const lookR = new Int32Array(W);
                    for (let x = 0; x < W; x++) {
                        lookL[x] = x;
                        lookR[x] = x;
                    }

                    for (let x = 0; x < W; x++) {
                        const d = getDepth(x, y);
                        const sep = Math.round((eyeSep - (d / 255.0) * maxDepth) * subpixels);
                        const left = x - Math.floor(sep / 2);
                        const right = left + sep;
                        let vis = true;

                        if (left >= 0 && right < W) {
                            if (opts.useHSR !== false) {
                                if (lookL[right] !== right) {
                                    if (lookL[right] < left) {
                                        lookR[lookL[right]] = lookL[right];
                                        lookL[right] = right;
                                    } else {
                                        vis = false;
                                    }
                                }
                                if (lookR[left] !== left) {
                                    if (lookR[left] > right) {
                                        lookL[lookR[left]] = lookR[left];
                                        lookR[left] = left;
                                    } else {
                                        vis = false;
                                    }
                                }
                            }
                            if (vis) {
                                lookL[right] = left;
                                lookR[left] = right;
                            }
                        }
                    }

                    if (type === 'mask') {
                        for (let x = 0; x < W; x++) {
                            if (lookL[x] !== x) {
                                let r1 = x; while (same[r1] !== r1) r1 = same[r1];
                                let r2 = lookL[x]; while (same[r2] !== r2) r2 = same[r2];
                                if (r1 !== r2) same[r1] = r2;
                            }
                            if (lookR[x] !== x) {
                                let r1 = x; while (same[r1] !== r1) r1 = same[r1];
                                let r2 = lookR[x]; while (same[r2] !== r2) r2 = same[r2];
                                if (r1 !== r2) same[r1] = r2;
                            }
                        }
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
                                if (classSizes[root] > maxClassSize) maxClassSize = classSizes[root];
                            }
                            const colorVal = (maxClassSize > subpixels) ? 255 : 0;
                            const outIdx = (y * width + px) * 4;
                            pixels[outIdx] = pixels[outIdx+1] = pixels[outIdx+2] = colorVal;
                            pixels[outIdx + 3] = 255;
                        }
                    } else {
                        const rowColors = new Uint8ClampedArray(W * 3);
                        const vmaxsep = stripeWidth;
                        const s = stripeLeft;
                        const poffset = vmaxsep - (s % vmaxsep);

                        const getPatternColor = (xCoord, yCoord) => {
                            let r = 0, g = 0, b = 0;
                            if (type === 'rds') {
                                if (colorsPalette && colorsPalette.length > 0) {
                                    const c = colorsPalette[Math.floor(Math.random() * colorsPalette.length)];
                                    r = c[0]; g = c[1]; b = c[2];
                                } else {
                                    r = Math.floor(Math.random() * 256); g = Math.floor(Math.random() * 256); b = Math.floor(Math.random() * 256);
                                }
                            } else {
                                if (textureData) {
                                    const tx = ((xCoord % texW) + texW) % texW;
                                    const ty = ((yCoord % texH) + texH) % texH;
                                    const tx0 = Math.floor(tx); const tx1 = (tx0 + 1) % texW;
                                    const ty0 = Math.floor(ty); const ty1 = (ty0 + 1) % texH;
                                    const kx = tx - tx0; const ky = ty - ty0;
                                    const idx00 = (ty0 * texW + tx0) * 4; const idx10 = (ty0 * texW + tx1) * 4;
                                    const idx01 = (ty1 * texW + tx0) * 4; const idx11 = (ty1 * texW + tx1) * 4;
                                    r = (texData[idx00] * (1 - kx) + texData[idx10] * kx) * (1 - ky) + (texData[idx01] * (1 - kx) + texData[idx11] * kx) * ky;
                                    g = (texData[idx00 + 1] * (1 - kx) + texData[idx10 + 1] * kx) * (1 - ky) + (texData[idx01 + 1] * (1 - kx) + texData[idx11 + 1] * kx) * ky;
                                    b = (texData[idx00 + 2] * (1 - kx) + texData[idx10 + 2] * kx) * (1 - ky) + (texData[idx01 + 2] * (1 - kx) + texData[idx11 + 2] * kx) * ky;
                                } else {
                                    const colorVal = (((Math.floor(xCoord) % 60) + 60) % 60 < 30) ? 200 : 50;
                                    r = colorVal; g = 100; b = 150;
                                }
                            }
                            return [r, g, b];
                        };

                        for (let x = s; x < W; x++) {
                            if (lookL[x] === x || lookL[x] < s) {
                                if (useRetouch && x > s && lookL[x] === x && lookL[x-1] !== x-1) {
                                    rowColors[x*3] = rowColors[(x-1)*3]; rowColors[x*3+1] = rowColors[(x-1)*3+1]; rowColors[x*3+2] = rowColors[(x-1)*3+2];
                                } else {
                                    const repeatIndex = Math.floor((x - s) / vmaxsep);
                                    const col = getPatternColor(((x - s) % vmaxsep) / subpixels, y + (useYShift ? repeatIndex * yShift : 0));
                                    rowColors[x*3] = col[0]; rowColors[x*3+1] = col[1]; rowColors[x*3+2] = col[2];
                                }
                            } else {
                                const l = lookL[x]; rowColors[x*3] = rowColors[l*3]; rowColors[x*3+1] = rowColors[l*3+1]; rowColors[x*3+2] = rowColors[l*3+2];
                            }
                        }
                        for (let x = s - 1; x >= 0; x--) {
                            if (lookR[x] === x) {
                                if (useRetouch && x < s - 1 && lookR[x] === x && lookR[x+1] !== x+1) {
                                    rowColors[x*3] = rowColors[(x+1)*3]; rowColors[x*3+1] = rowColors[(x+1)*3+1]; rowColors[x*3+2] = rowColors[(x+1)*3+2];
                                } else {
                                    const repeatIndex = Math.floor((s - x - 1) / vmaxsep) + 1;
                                    const col = getPatternColor(((x - s) % vmaxsep) / subpixels, y + (useYShift ? repeatIndex * yShift : 0));
                                    rowColors[x*3] = col[0]; rowColors[x*3+1] = col[1]; rowColors[x*3+2] = col[2];
                                }
                            } else {
                                const r = lookR[x]; rowColors[x*3] = rowColors[r*3]; rowColors[x*3+1] = rowColors[r*3+1]; rowColors[x*3+2] = rowColors[r*3+2];
                            }
                        }
                        for (let px = 0; px < width; px++) {
                            let sR = 0, sG = 0, sB = 0;
                            for (let n = 0; n < subpixels; n++) {
                                const idx = (px * subpixels + n) * 3;
                                sR += rowColors[idx]; sG += rowColors[idx+1]; sB += rowColors[idx+2];
                            }
                            const outIdx = (y * width + px) * 4;
                            pixels[outIdx] = sR / subpixels; pixels[outIdx+1] = sG / subpixels; pixels[outIdx+2] = sB / subpixels; pixels[outIdx+3] = 255;
                        }
                    }
                } else {
                    // --- 2. АЛГОРИТМ STEREOLAB DSU ---
                    for (let x = 0; x < W; x++) {
                        const d = getDepth(x, y);
                        const sep = Math.round((eyeSep - (d / 255.0) * maxDepth) * subpixels);
                        const left = x - sep;
                        if (left >= 0) {
                            let k = x; while (same[k] !== k && same[k] !== left) k = same[k];
                            same[k] = left;
                        }
                    }
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
                                if (classSizes[root] > maxClassSize) maxClassSize = classSizes[root];
                            }
                            const colorVal = (maxClassSize > subpixels) ? 255 : 0;
                            const outIdx = (y * width + px) * 4;
                            pixels[outIdx] = pixels[outIdx+1] = pixels[outIdx+2] = colorVal;
                            pixels[outIdx+3] = 255;
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
                                        r = c[0]; g = c[1]; b = c[2];
                                    } else {
                                        r = Math.floor(Math.random() * 256); g = Math.floor(Math.random() * 256); b = Math.floor(Math.random() * 256);
                                    }
                                } else { // 'mts'
                                    if (textureData) {
                                        const pixelX = (root - stripeLeft) / subpixels;
                                        const tx = ((pixelX % texW) + texW) % texW;
                                        const repeatIndex = Math.floor((root - stripeLeft) / stripeWidth);
                                        const shiftedY = y + (useYShift ? repeatIndex * yShift : 0);
                                        const ty = ((shiftedY % texH) + texH) % texH;

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

                                        r = (texData[idx00] * (1 - kx) + texData[idx10] * kx) * (1 - ky) + (texData[idx01] * (1 - kx) + texData[idx11] * kx) * ky;
                                        g = (texData[idx00 + 1] * (1 - kx) + texData[idx10 + 1] * kx) * (1 - ky) + (texData[idx01 + 1] * (1 - kx) + texData[idx11 + 1] * kx) * ky;
                                        b = (texData[idx00 + 2] * (1 - kx) + texData[idx10 + 2] * kx) * (1 - ky) + (texData[idx01 + 2] * (1 - kx) + texData[idx11 + 2] * kx) * ky;
                                    } else {
                                        const pixelX = Math.floor((root - stripeLeft) / subpixels);
                                        const colorVal = (((pixelX % 60) + 60) % 60 < 30) ? 200 : 50;
                                        r = colorVal; g = 100; b = 150;
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
            }

            return pixels;
        }
    };

    window.StereoCore = StereoCore;
})();
