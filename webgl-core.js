/**
 * StereoLab WebGL — Высокопроизводительный GPU-движок для превью стереограмм
 * Позволяет рендерить стереограммы на GPU со скоростью 60 кадров/сек.
 */

class WebGLStereoRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = canvas.getContext('webgl2', { antialias: false, depth: false, preserveDrawingBuffer: true }) || 
                  canvas.getContext('webgl', { antialias: false, depth: false, preserveDrawingBuffer: true }) || 
                  canvas.getContext('experimental-webgl', { antialias: false, depth: false, preserveDrawingBuffer: true });
        
        if (!this.gl) {
            console.warn('WebGL не поддерживается в данном браузере.');
            return;
        }

        this.initShaders();
        this.initBuffers();
        this.initTextures();
    }

    initShaders() {
        const gl = this.gl;

        const vsSource = `
            attribute vec2 aPosition;
            varying vec2 vUv;
            void main() {
                vUv = aPosition * 0.5 + 0.5;
                // Флипаем Y для соответствия 2D canvas координатам
                vUv.y = 1.0 - vUv.y;
                gl_Position = vec4(aPosition, 0.0, 1.0);
            }
        `;

        const fsSource = `
            precision mediump float;
            varying vec2 vUv;
            uniform sampler2D uDepthTexture;
            uniform sampler2D uPatternTexture;
            uniform float uEyeSep;
            uniform float uMaxDepth;
            uniform float uInvertDepth;
            uniform float uPixelSize;
            uniform float uMainStripeMode;
            uniform float uUseHSR;

            void main() {
                float x = vUv.x;
                float y = vUv.y;
                
                float stripeWidth = uEyeSep;
                float stripeLeft = uMainStripeMode > 0.5 ? (0.5 - stripeWidth * 0.5) : 0.0;
                float stripeRight = uMainStripeMode > 0.5 ? (0.5 + stripeWidth * 0.5) : stripeWidth;
                
                // Алгоритм распространения сдвигов по строке с HSR
                for (int i = 0; i < 30; i++) {
                    if (x < stripeLeft) {
                        float lookupX = clamp(x, 0.0, 1.0);
                        vec4 depthCol = texture2D(uDepthTexture, vec2(lookupX, y));
                        float d = dot(depthCol.rgb, vec3(0.299, 0.587, 0.114));
                        if (uInvertDepth > 0.5) {
                            d = 1.0 - d;
                        }
                        float sep = uEyeSep - d * uMaxDepth;
                        
                        // Occlusion check
                        bool occluded = false;
                        if (uUseHSR > 0.5) {
                            float minSep = uEyeSep - uMaxDepth;
                            float tStart = minSep;
                            float tEnd = sep;
                            if (tStart < tEnd) {
                                float searchW = tEnd - tStart;
                                for (int j = 1; j < 50; j++) {
                                    float offset = float(j) * uPixelSize;
                                    if (offset >= searchW) break;
                                    float t_coord = x + tStart + offset;
                                    vec4 dCol_t = texture2D(uDepthTexture, vec2(clamp(t_coord, 0.0, 1.0), y));
                                    float d_t = dot(dCol_t.rgb, vec3(0.299, 0.587, 0.114));
                                    if (uInvertDepth > 0.5) {
                                        d_t = 1.0 - d_t;
                                    }
                                    float sep_t = uEyeSep - d_t * uMaxDepth;
                                    if (t_coord - sep_t > x) {
                                        occluded = true;
                                        break;
                                    }
                                }
                            }
                        }
                        
                        if (occluded) {
                            x += uEyeSep;
                            continue;
                        }
                        x += sep;
                    } else if (x >= stripeRight) {
                        // 1-step corrector to sample depth at left endpoint x - sep
                        float d_approx = dot(texture2D(uDepthTexture, vec2(clamp(x - uEyeSep, 0.0, 1.0), y)).rgb, vec3(0.299, 0.587, 0.114));
                        if (uInvertDepth > 0.5) {
                            d_approx = 1.0 - d_approx;
                        }
                        float sep_approx = uEyeSep - d_approx * uMaxDepth;
                        float leftX = clamp(x - sep_approx, 0.0, 1.0);
                        
                        vec4 depthCol = texture2D(uDepthTexture, vec2(leftX, y));
                        float d = dot(depthCol.rgb, vec3(0.299, 0.587, 0.114));
                        if (uInvertDepth > 0.5) {
                            d = 1.0 - d;
                        }
                        float sep = uEyeSep - d * uMaxDepth;
                        
                        // Occlusion check
                        bool occluded = false;
                        if (uUseHSR > 0.5) {
                            float minSep = uEyeSep - uMaxDepth;
                            float tStart = minSep;
                            float tEnd = sep;
                            if (tStart < tEnd) {
                                float searchW = tEnd - tStart;
                                for (int j = 1; j < 50; j++) {
                                    float offset = float(j) * uPixelSize;
                                    if (offset >= searchW) break;
                                    float t_coord = x - sep + tStart + offset;
                                    vec4 dCol_t = texture2D(uDepthTexture, vec2(clamp(t_coord, 0.0, 1.0), y));
                                    float d_t = dot(dCol_t.rgb, vec3(0.299, 0.587, 0.114));
                                    if (uInvertDepth > 0.5) {
                                        d_t = 1.0 - d_t;
                                    }
                                    float sep_t = uEyeSep - d_t * uMaxDepth;
                                    if (t_coord - sep_t > x - sep) {
                                        occluded = true;
                                        break;
                                    }
                                }
                            }
                        }
                        
                        if (occluded) {
                            x -= uEyeSep;
                            continue;
                        }
                        x -= sep;
                    } else {
                        break;
                    }
                }
                
                float patternX = (x - stripeLeft) / stripeWidth;
                patternX = fract(patternX);
                
                gl_FragColor = texture2D(uPatternTexture, vec2(patternX, fract(y)));
            }
        `;

        this.program = this.createProgram(vsSource, fsSource);
        
        // Получаем ссылки на атрибуты и униформы
        this.locations = {
            aPosition: gl.getAttribLocation(this.program, 'aPosition'),
            uDepthTexture: gl.getUniformLocation(this.program, 'uDepthTexture'),
            uPatternTexture: gl.getUniformLocation(this.program, 'uPatternTexture'),
            uEyeSep: gl.getUniformLocation(this.program, 'uEyeSep'),
            uMaxDepth: gl.getUniformLocation(this.program, 'uMaxDepth'),
            uInvertDepth: gl.getUniformLocation(this.program, 'uInvertDepth'),
            uPixelSize: gl.getUniformLocation(this.program, 'uPixelSize'),
            uMainStripeMode: gl.getUniformLocation(this.program, 'uMainStripeMode'),
            uUseHSR: gl.getUniformLocation(this.program, 'uUseHSR')
        };
    }

    initBuffers() {
        const gl = this.gl;
        if (!gl) return;

        // Квад на весь экран
        const vertices = new Float32Array([
            -1.0, -1.0,
             1.0, -1.0,
            -1.0,  1.0,
            -1.0,  1.0,
             1.0, -1.0,
             1.0,  1.0
        ]);

        this.vertexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    }

    initTextures() {
        const gl = this.gl;
        if (!gl) return;

        // Создаем текстуру карты глубин (Текстурный юнит 0)
        this.depthTexture = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        // Создаем текстуру паттерна (Текстурный юнит 1)
        this.patternTexture = gl.createTexture();
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.patternTexture);
        
        const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
        const wrapMode = isWebGL2 ? gl.REPEAT : gl.CLAMP_TO_EDGE;
        
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapMode);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapMode);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }

    /**
     * Обновляет текстуру карты глубин на GPU
     * @param {HTMLCanvasElement|HTMLImageElement|ImageData} source Источник пикселей
     */
    updateDepthTexture(source) {
        const gl = this.gl;
        if (!gl) return;

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);

        if (source instanceof ImageData) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, source.width, source.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, source.data);
        } else {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        }
    }

    /**
     * Обновляет текстуру паттерна на GPU
     * @param {HTMLCanvasElement|HTMLImageElement|ImageData} source Источник пикселей
     */
    updatePatternTexture(source) {
        const gl = this.gl;
        if (!gl) return;

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.patternTexture);

        if (source instanceof ImageData) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, source.width, source.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, source.data);
        } else {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        }
    }

    /**
     * Выполняет отрисовку стереограммы на холсте
     * @param {Object} opts Настройки
     * @param {number} opts.eyeSep Ширина паттерна в пикселях
     * @param {number} opts.maxDepth Максимальный сдвиг в пикселях
     * @param {string} opts.viewMode Режим просмотра ('wall-eyed' | 'cross-eyed')
     */
    render(opts) {
        const gl = this.gl;
        if (!gl) return;

        // Устанавливаем viewport под текущие размеры холста
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(this.program);

        // Переводим пиксельные значения сдвигов в нормализованные текстурные координаты [0, 1]
        const normEyeSep = opts.eyeSep / this.canvas.width;
        const normMaxDepth = opts.maxDepth / this.canvas.width;
        const invertVal = opts.viewMode === 'cross-eyed' ? 1.0 : 0.0;

        // Привязываем униформы
        gl.uniform1f(this.locations.uEyeSep, Math.max(0.01, normEyeSep));
        gl.uniform1f(this.locations.uMaxDepth, normMaxDepth);
        gl.uniform1f(this.locations.uInvertDepth, invertVal);
        gl.uniform1f(this.locations.uPixelSize, 1.0 / this.canvas.width);
        
        const mainStripeVal = opts.mainStripeMode === 'left' ? 0.0 : 1.0;
        gl.uniform1f(this.locations.uMainStripeMode, mainStripeVal);
        
        const hsrVal = opts.useHSR ? 1.0 : 0.0;
        gl.uniform1f(this.locations.uUseHSR, hsrVal);

        // Привязываем текстурные юниты и текстуры
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
        gl.uniform1i(this.locations.uDepthTexture, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.patternTexture);
        gl.uniform1i(this.locations.uPatternTexture, 1);

        // Включаем вершинный буфер
        gl.enableVertexAttribArray(this.locations.aPosition);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.vertexAttribPointer(this.locations.aPosition, 2, gl.FLOAT, false, 0, 0);

        // Рисуем квад
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    // Вспомогательные функции компиляции шейдеров
    createShader(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Ошибка компиляции шейдера:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    createProgram(vsSource, fsSource) {
        const gl = this.gl;
        const vertexShader = this.createShader(gl, gl.VERTEX_SHADER, vsSource);
        const fragmentShader = this.createShader(gl, gl.FRAGMENT_SHADER, fsSource);
        
        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
        
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('Ошибка линковки шейдерной программы:', gl.getProgramInfoLog(program));
            return null;
        }
        return program;
    }
}

// Экспортируем в глобальную область видимости
window.WebGLStereoRenderer = WebGLStereoRenderer;
