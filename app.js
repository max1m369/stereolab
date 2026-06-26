/**
 * StereoLab MTS — Основная логика интерфейса и интеграции
 * Управляет вкладками, редактором карт глубины, генератором и декодером.
 * Поддерживает авто-генерацию превью в реальном времени и экспорт в форматах 4:3 / 3:4.
 */

document.addEventListener('DOMContentLoaded', () => {
    // -------------------------------------------------------------
    // 1. АВТО-РЕНДЕРИНГ И ДЕБАУНС (МОМЕНТАЛЬНО НА ПРОЦЕССОРЕ)
    // -------------------------------------------------------------
    let autoRenderTimer = null;

    function triggerAutoRender(delay = 50) {
        if (autoRenderTimer) clearTimeout(autoRenderTimer);
        autoRenderTimer = setTimeout(() => {
            generateAndDraw(true);
        }, delay);
    }

    // -------------------------------------------------------------
    // 2. ИНИЦИАЛИЗАЦИЯ И УПРАВЛЕНИЕ ВКЛАДКАМИ
    // -------------------------------------------------------------
    const navItems = document.querySelectorAll('.app-tabs-nav .tab-nav-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    const controlContents = document.querySelectorAll('.sidebar-tab-content');
    let activeTab = 'tab-generator';

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetTab = item.getAttribute('data-tab');
            
            // Смена активного класса на кнопках навигации
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            
            // Смена активной вкладки контента
            tabContents.forEach(content => content.classList.remove('active'));
            document.getElementById(targetTab).classList.add('active');
            
            // Смена активного блока параметров в сайдбаре
            controlContents.forEach(ctrl => ctrl.classList.remove('active'));
            const targetControlId = targetTab === 'tab-generator' ? 'control-tab-generator' : 'control-tab-editor';
            const targetControl = document.getElementById(targetControlId);
            if (targetControl) targetControl.classList.add('active');
            
            activeTab = targetTab;
            
            // Если переходим на вкладку Генератор, можем синхронизировать превью
            if (targetTab === 'tab-generator') {
                updateInputsPreview();
                triggerAutoRender(0); // сразу обновляем превью при возврате
            }
        });
    });

    // Взгляд: всегда Параллельный
    const viewMode = 'wall-eyed';

    // Режим полос (Stripe Mode)
    let stripesMode = 'adaptive'; // 'adaptive' | 'fixed'
    let stripesCount = 10;

    function getEyeSepPixels(w) {
        if (stripesMode === 'fixed') {
            return Math.round(w / (stripesCount + 1));
        } else {
            const physicalWidth = aspectRatio === 'landscape' ? 297 : 210;
            const scale = w / physicalWidth;
            return Math.round(parseFloat(sliderEyeSep.value) * scale);
        }
    }

    // -------------------------------------------------------------
    // 3. ИНИЦИАЛИЗАЦИЯ РЕДАКТОРА КАРТЫ ГЛУБИНЫ
    // -------------------------------------------------------------
    const depthEditor = new DepthEditor('canvas-editor');

    // Кнопки инструментов (Кисть, Ластик, Пипетка, Текст, Фигуры)
    const btnToolBrush = document.getElementById('btn-tool-brush');
    const btnToolEraser = document.getElementById('btn-tool-eraser');
    const btnToolEyedropper = document.getElementById('btn-tool-eyedropper');
    const btnToolText = document.getElementById('btn-tool-text');
    const btnToolShapes = document.getElementById('btn-tool-shapes');
    
    const settingsBrush = document.getElementById('settings-brush');
    const settingsText = document.getElementById('settings-text');
    const settingsShapes = document.getElementById('settings-shapes');

    const switchTool = (toolName) => {
        depthEditor.currentTool = toolName;
        depthEditor.isEraserMode = (toolName === 'eraser');
        
        // Смена активного класса на кнопках инструментов
        if (btnToolBrush) btnToolBrush.classList.remove('active');
        if (btnToolEraser) btnToolEraser.classList.remove('active');
        if (btnToolEyedropper) btnToolEyedropper.classList.remove('active');
        if (btnToolText) btnToolText.classList.remove('active');
        if (btnToolShapes) btnToolShapes.classList.remove('active');
        
        settingsBrush.classList.add('hidden');
        settingsText.classList.add('hidden');
        settingsShapes.classList.add('hidden');

        if (toolName === 'brush' || toolName === 'eraser') {
            const activeBtn = toolName === 'brush' ? btnToolBrush : btnToolEraser;
            if (activeBtn) activeBtn.classList.add('active');
            settingsBrush.classList.remove('hidden');
        } else if (toolName === 'eyedropper') {
            if (btnToolEyedropper) btnToolEyedropper.classList.add('active');
            settingsBrush.classList.remove('hidden'); // показываем настройки, чтобы видеть текущую высоту
        } else if (toolName === 'text') {
            if (btnToolText) btnToolText.classList.add('active');
            settingsText.classList.remove('hidden');
        } else if (toolName === 'shapes') {
            if (btnToolShapes) btnToolShapes.classList.add('active');
            settingsShapes.classList.remove('hidden');
        }
        
        updateBrushDisplay();
    };

    if (btnToolBrush) btnToolBrush.addEventListener('click', () => switchTool('brush'));
    if (btnToolEraser) btnToolEraser.addEventListener('click', () => switchTool('eraser'));
    if (btnToolEyedropper) btnToolEyedropper.addEventListener('click', () => switchTool('eyedropper'));
    if (btnToolText) btnToolText.addEventListener('click', () => switchTool('text'));
    if (btnToolShapes) btnToolShapes.addEventListener('click', () => switchTool('shapes'));

    // Настройки кисти
    const sliderBrushHeight = document.getElementById('slider-brush-height');
    const valBrushHeight = document.getElementById('val-brush-height');
    const sliderBrushSize = document.getElementById('slider-brush-size');
    const valBrushSize = document.getElementById('val-brush-size');
    const sliderBrushBlur = document.getElementById('slider-brush-blur');
    const valBrushBlur = document.getElementById('val-brush-blur');
    const brushInfo = document.getElementById('brush-info');
    const presetButtons = document.querySelectorAll('.depth-preset-btn');

    const updateBrushDisplay = () => {
        valBrushHeight.textContent = sliderBrushHeight.value;
        valBrushSize.textContent = sliderBrushSize.value + ' px';
        valBrushBlur.textContent = sliderBrushBlur.value + ' px';
        
        let toolText = 'Кисть';
        if (depthEditor.isEraserMode) {
            toolText = 'Ластик';
        } else if (depthEditor.currentTool === 'eyedropper') {
            toolText = 'Пипетка';
        }
        
        brushInfo.textContent = `${toolText}: ${sliderBrushSize.value}px (Размытие: ${sliderBrushBlur.value}px, Глубина: ${sliderBrushHeight.value})`;
        
        depthEditor.brushHeight = parseInt(sliderBrushHeight.value);
        depthEditor.brushSize = parseInt(sliderBrushSize.value);
        depthEditor.brushBlur = parseInt(sliderBrushBlur.value);
    };

    sliderBrushHeight.addEventListener('input', updateBrushDisplay);
    sliderBrushSize.addEventListener('input', updateBrushDisplay);
    sliderBrushBlur.addEventListener('input', updateBrushDisplay);

    presetButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            presetButtons.forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            sliderBrushHeight.value = btn.getAttribute('data-val');
            updateBrushDisplay();
        });
    });

    // Форма кисти (Круг, Квадрат, Ромб)
    const brushShapeButtons = document.querySelectorAll('[data-brush-shape]');
    brushShapeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            brushShapeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            depthEditor.brushShape = btn.getAttribute('data-brush-shape');
            updateBrushDisplay();
        });
    });

    // Профиль кисти (Plane, Sphere, Inset)
    const brushProfileButtons = document.querySelectorAll('[data-brush-profile]');
    brushProfileButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            brushProfileButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            depthEditor.brushProfile = btn.getAttribute('data-brush-profile');
            updateBrushDisplay();
        });
    });

    // Настройки наклона/инкремента
    const chkBrushSlopeEnabled = document.getElementById('chk-brush-slope-enabled');
    const controlBrushSlopeStep = document.getElementById('control-brush-slope-step');
    const sliderBrushSlopeStep = document.getElementById('slider-brush-slope-step');
    const valBrushSlopeStep = document.getElementById('val-brush-slope-step');

    if (chkBrushSlopeEnabled && controlBrushSlopeStep && sliderBrushSlopeStep && valBrushSlopeStep) {
        chkBrushSlopeEnabled.addEventListener('change', () => {
            const enabled = chkBrushSlopeEnabled.checked;
            depthEditor.depthIncrementEnabled = enabled;
            if (enabled) {
                controlBrushSlopeStep.classList.remove('hidden');
            } else {
                controlBrushSlopeStep.classList.add('hidden');
            }
        });

        sliderBrushSlopeStep.addEventListener('input', () => {
            const stepVal = parseFloat(sliderBrushSlopeStep.value);
            depthEditor.depthIncrementValue = stepVal;
            valBrushSlopeStep.textContent = (stepVal > 0 ? '+' : '') + stepVal.toFixed(1);
        });
    }

    // Авто-рендер при завершении рисования кистью
    const canvasEditor = document.getElementById('canvas-editor');
    canvasEditor.addEventListener('draw-end', () => {
        updateInputsPreview();
        triggerAutoRender(0);
    });
    // Сохраняем обратную совместимость для старых сценариев
    canvasEditor.addEventListener('mouseup', () => {
        updateInputsPreview();
        triggerAutoRender(0);
    });
    canvasEditor.addEventListener('touchend', () => {
        updateInputsPreview();
        triggerAutoRender(0);
    });

    // Настройки текста
    const input3DText = document.getElementById('input-3d-text');
    const selectTextFont = document.getElementById('select-text-font');
    const sliderTextSize = document.getElementById('slider-text-size');
    const valTextSize = document.getElementById('val-text-size');
    const sliderTextLineSpacing = document.getElementById('slider-text-line-spacing');
    const valTextLineSpacing = document.getElementById('val-text-line-spacing');
    const selectTextProfile = document.getElementById('select-text-profile');
    const btnAddText = document.getElementById('btn-add-text');

    if (sliderTextSize && valTextSize) {
        sliderTextSize.addEventListener('input', () => {
            valTextSize.textContent = sliderTextSize.value + ' px';
        });
    }

    if (sliderTextLineSpacing && valTextLineSpacing) {
        sliderTextLineSpacing.addEventListener('input', () => {
            valTextLineSpacing.textContent = sliderTextLineSpacing.value;
        });
    }

    if (input3DText) {
        // Ограничение ввода до 6 строк
        input3DText.addEventListener('input', () => {
            const lines = input3DText.value.split('\n');
            if (lines.length > 6) {
                input3DText.value = lines.slice(0, 6).join('\n');
            }
        });

        input3DText.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const lines = input3DText.value.split('\n');
                if (lines.length >= 6) {
                    e.preventDefault();
                }
            }
        });
    }

    if (btnAddText) {
        btnAddText.addEventListener('click', () => {
            depthEditor.textString = input3DText.value;
            depthEditor.textFont = selectTextFont.value;
            depthEditor.textSize = parseInt(sliderTextSize.value);
            depthEditor.textLineSpacing = sliderTextLineSpacing ? parseFloat(sliderTextLineSpacing.value) : 1.2;
            depthEditor.textProfile = selectTextProfile.value;
            depthEditor.brushHeight = parseInt(sliderBrushHeight.value); // высота для текста

            depthEditor.add3DText();
            updateInputsPreview();
            triggerAutoRender(0);
        });
    }

    // Настройки фигур
    const shapeButtons = document.querySelectorAll('.shape-select-btn');
    const sliderShapeHeight = document.getElementById('slider-shape-height');
    const valShapeHeight = document.getElementById('val-shape-height');
    const btnAddShape = document.getElementById('btn-add-shape');

    sliderShapeHeight.addEventListener('input', () => {
        valShapeHeight.textContent = sliderShapeHeight.value;
    });

    shapeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            shapeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            depthEditor.selectedShape = btn.getAttribute('data-shape');
        });
    });

    btnAddShape.addEventListener('click', () => {
        depthEditor.shapeHeight = parseInt(sliderShapeHeight.value);
        depthEditor.addShapeInteractive();
        updateInputsPreview();
        triggerAutoRender(0);
    });

    // Действия холста редактора
    document.getElementById('btn-editor-undo').addEventListener('click', () => { depthEditor.undo(); updateInputsPreview(); triggerAutoRender(0); });
    document.getElementById('btn-editor-redo').addEventListener('click', () => { depthEditor.redo(); updateInputsPreview(); triggerAutoRender(0); });
    document.getElementById('btn-editor-blur').addEventListener('click', () => { depthEditor.blur(); updateInputsPreview(); triggerAutoRender(0); });
    document.getElementById('btn-editor-invert').addEventListener('click', () => { depthEditor.invert(); updateInputsPreview(); triggerAutoRender(0); });
    
    document.getElementById('btn-editor-clear').addEventListener('click', () => {
        if (confirm('Вы уверены, что хотите полностью очистить холст?')) {
            depthEditor.clearCanvas();
            depthEditor.saveState();
            updateInputsPreview();
            triggerAutoRender(0);
        }
    });

    // Инициализация отображения кисти
    updateBrushDisplay();

    // -------------------------------------------------------------
    // 4. ИНИЦИАЛИЗАЦИЯ И УПРАВЛЕНИЕ ГЕНЕРАТОРОМ
    // -------------------------------------------------------------
    const typeButtons = document.querySelectorAll('.type-selector .type-btn');
    let selectedType = 'mts'; // по умолчанию

    typeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            typeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedType = btn.getAttribute('data-type');
            
            // Скрываем или показываем настройки сглаживания/текстуры
            const groupTexture = document.getElementById('group-texture-source');
            const controlSmoothing = document.getElementById('control-smoothing-pass');
            
            if (selectedType === 'mts') {
                groupTexture.classList.remove('hidden');
                controlSmoothing.classList.remove('hidden');
            } else if (selectedType === 'rds') {
                groupTexture.classList.add('hidden');
                controlSmoothing.classList.add('hidden');
            } else if (selectedType === 'mask') {
                groupTexture.classList.add('hidden');
                controlSmoothing.classList.add('hidden');
            }

            triggerAutoRender(0);
        });
    });

    // Соотношение сторон (Aspect Ratio): landscape (A4) или portrait (A4)
    let aspectRatio = 'landscape';
    const ratioButtons = document.querySelectorAll('.ratio-selector .ratio-btn');
    const canvasOutput = document.getElementById('canvas-output');
    const canvasDepthView = document.getElementById('canvas-depth-view');
    const canvasOutputWebGL = document.getElementById('canvas-output-webgl');
    const tabView3d = document.getElementById('tab-view-3d');
    const tabViewDepth = document.getElementById('tab-view-depth');

    // Инициализация WebGL рендерера
    let webglRenderer = null;
    if (canvasOutputWebGL) {
        webglRenderer = new WebGLStereoRenderer(canvasOutputWebGL);
        if (webglRenderer.gl) {
            canvasOutputWebGL.classList.add('active-stereo');
            window.webglRenderer = webglRenderer;
        } else {
            webglRenderer = null;
        }
    }

    if (tabView3d && tabViewDepth && canvasOutput && canvasDepthView && canvasOutputWebGL) {
        tabView3d.addEventListener('click', () => {
            tabView3d.classList.add('active');
            tabViewDepth.classList.remove('active');
            canvasDepthView.classList.add('hidden');
            
            // Показываем активный холст стереограммы
            if (canvasOutputWebGL.classList.contains('active-stereo')) {
                canvasOutputWebGL.classList.remove('hidden');
                canvasOutput.classList.add('hidden');
            } else {
                canvasOutput.classList.remove('hidden');
                canvasOutputWebGL.classList.add('hidden');
            }
            
            const dotsWrapper = document.getElementById('guide-dots-wrapper');
            if (dotsWrapper) dotsWrapper.classList.remove('hidden');
        });

        tabViewDepth.addEventListener('click', () => {
            tabViewDepth.classList.add('active');
            tabView3d.classList.remove('active');
            canvasDepthView.classList.remove('hidden');
            canvasOutput.classList.add('hidden');
            const dotsWrapper = document.getElementById('guide-dots-wrapper');
            if (dotsWrapper) dotsWrapper.classList.add('hidden');
            drawDepthView();
        });
    }

    ratioButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            ratioButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            aspectRatio = btn.getAttribute('data-ratio');
            
            syncCanvasResolution();
        });
    });

    function syncCanvasResolution(isInit = false) {
        const selectPrintDpi = document.getElementById('select-print-dpi');
        const printDPI = selectPrintDpi ? parseInt(selectPrintDpi.value) : 171;
        let outWidth = 2000;
        let outHeight = 1414;
        
        if (aspectRatio === 'portrait') {
            if (printDPI === 300) {
                outWidth = 2480;
                outHeight = 3508;
            } else {
                outWidth = 1414;
                outHeight = 2000;
            }
        } else {
            if (printDPI === 300) {
                outWidth = 3508;
                outHeight = 2480;
            } else {
                outWidth = 2000;
                outHeight = 1414;
            }
        }

        // Фиксированное оптимизированное разрешение для холста редактора, чтобы кисть работала плавно без лагов
        let editorWidth = aspectRatio === 'portrait' ? 1414 : 2000;
        let editorHeight = aspectRatio === 'portrait' ? 2000 : 1414;

        const prevOutWidth = canvasOutput.width;
        const prevOutHeight = canvasOutput.height;

        if (!isInit && prevOutWidth === outWidth && prevOutHeight === outHeight) return;

        let tempCanvas = null;
        if (!isInit && depthEditor && depthEditor.canvas) {
            tempCanvas = document.createElement('canvas');
            tempCanvas.width = depthEditor.canvas.width;
            tempCanvas.height = depthEditor.canvas.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(depthEditor.canvas, 0, 0);
        }

        canvasOutput.width = outWidth;
        canvasOutput.height = outHeight;
        if (canvasOutputWebGL) {
            canvasOutputWebGL.width = outWidth;
            canvasOutputWebGL.height = outHeight;
        }
        if (canvasDepthView) {
            canvasDepthView.width = outWidth;
            canvasDepthView.height = outHeight;
        }
        if (depthEditor && depthEditor.canvas) {
            const prevEditorW = depthEditor.canvas.width;
            const prevEditorH = depthEditor.canvas.height;
            
            depthEditor.canvas.width = editorWidth;
            depthEditor.canvas.height = editorHeight;
            
            if (tempCanvas) {
                depthEditor.ctx.fillStyle = '#000000';
                depthEditor.ctx.fillRect(0, 0, editorWidth, editorHeight);
                depthEditor.ctx.drawImage(tempCanvas, 0, 0, prevEditorW, prevEditorH, 0, 0, editorWidth, editorHeight);
                depthEditor.saveState();
            } else {
                depthEditor.clearCanvas();
                depthEditor.saveState();
            }
        }

        if (typeof updateRenderParamsDisplay === 'function') {
            updateRenderParamsDisplay();
        }
        updateInputsPreview();
        triggerAutoRender(0);
    }

    // Источник карты глубин
    const selectDepthSource = document.getElementById('select-depth-source');
    const depthUploadBox = document.getElementById('depth-upload-box');
    const inputDepthFile = document.getElementById('input-depth-file');
    const depthFileInfo = document.getElementById('depth-file-info');
    const lblDepthFilename = document.getElementById('lbl-depth-filename');
    const btnRemoveDepthFile = document.getElementById('btn-remove-depth-file');
    const btnEditDepthFile = document.getElementById('btn-edit-depth-file');
    let uploadedDepthImg = null;

    function updateDepthUploadVisibility() {
        if (selectDepthSource.value === 'upload') {
            if (uploadedDepthImg) {
                depthUploadBox.classList.add('hidden');
                depthFileInfo.classList.remove('hidden');
            } else {
                depthUploadBox.classList.remove('hidden');
                depthFileInfo.classList.add('hidden');
            }
        } else {
            depthUploadBox.classList.add('hidden');
            depthFileInfo.classList.add('hidden');
        }
    }

    selectDepthSource.addEventListener('change', () => {
        updateDepthUploadVisibility();
        updateInputsPreview();
        triggerAutoRender(0);
    });

    inputDepthFile.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            lblDepthFilename.textContent = file.name;
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    if (img.width === 0 || img.height === 0) {
                        alert("Ошибка: Загруженное изображение имеет нулевой размер или повреждено.");
                        return;
                    }
                    uploadedDepthImg = img;
                    updateDepthUploadVisibility();
                    updateInputsPreview();
                    triggerAutoRender(0);
                };
                img.onerror = () => {
                    alert("Ошибка: Не удалось загрузить или декодировать изображение карты глубины.");
                };
                img.src = event.target.result;
            };
            reader.onerror = () => {
                alert("Ошибка чтения файла.");
            };
            reader.readAsDataURL(file);
        }
    });

    btnRemoveDepthFile.addEventListener('click', () => {
        uploadedDepthImg = null;
        inputDepthFile.value = '';
        updateDepthUploadVisibility();
        updateInputsPreview();
        triggerAutoRender(0);
    });

    if (btnEditDepthFile) {
        btnEditDepthFile.addEventListener('click', () => {
            if (!uploadedDepthImg) return;

            const canvasW = depthEditor.canvas.width;
            const canvasH = depthEditor.canvas.height;
            const imgW = uploadedDepthImg.width;
            const imgH = uploadedDepthImg.height;

            const scale = Math.min(canvasW / imgW, canvasH / imgH);
            const drawW = imgW * scale;
            const drawH = imgH * scale;
            const x = (canvasW - drawW) / 2;
            const y = (canvasH - drawH) / 2;

            depthEditor.ctx.fillStyle = '#000000';
            depthEditor.ctx.fillRect(0, 0, canvasW, canvasH);
            depthEditor.ctx.drawImage(uploadedDepthImg, x, y, drawW, drawH);

            depthEditor.saveState();

            selectDepthSource.value = 'editor';
            updateDepthUploadVisibility();
            updateInputsPreview();
            triggerAutoRender(0);

            const editorTabBtn = document.querySelector('.tab-nav-btn[data-tab="tab-editor"]');
            if (editorTabBtn) {
                editorTabBtn.click();
            }
        });
    }

    // Источник текстуры
    const selectTextureSource = document.getElementById('select-texture-source');
    const textureUploadBox = document.getElementById('texture-upload-box');
    const inputTextureFile = document.getElementById('input-texture-file');
    const textureFileInfo = document.getElementById('texture-file-info');
    const lblTextureFilename = document.getElementById('lbl-texture-filename');
    const btnRemoveTextureFile = document.getElementById('btn-remove-texture-file');
    let uploadedTextureImg = null;

    function updateTextureUploadVisibility() {
        const texSource = selectTextureSource.value;
        const controlFog = document.getElementById('control-fog-density');
        
        if (texSource === 'preset-pattern-perlin') {
            if (controlFog) controlFog.classList.remove('hidden');
        } else {
            if (controlFog) controlFog.classList.add('hidden');
        }

        if (texSource === 'upload') {
            if (uploadedTextureImg) {
                textureUploadBox.classList.add('hidden');
                textureFileInfo.classList.remove('hidden');
            } else {
                textureUploadBox.classList.remove('hidden');
                textureFileInfo.classList.add('hidden');
            }
        } else {
            textureUploadBox.classList.add('hidden');
            textureFileInfo.classList.add('hidden');
        }
    }

    selectTextureSource.addEventListener('change', () => {
        updateTextureUploadVisibility();
        updateInputsPreview();
        triggerAutoRender(0);
    });

    inputTextureFile.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            lblTextureFilename.textContent = file.name;
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    if (img.width === 0 || img.height === 0) {
                        alert("Ошибка: Загруженное изображение имеет нулевой размер или повреждено.");
                        return;
                    }
                    uploadedTextureImg = img;
                    updateTextureUploadVisibility();
                    updateInputsPreview();
                    triggerAutoRender(0);
                };
                img.onerror = () => {
                    alert("Ошибка: Не удалось загрузить или декодировать изображение текстуры.");
                };
                img.src = event.target.result;
            };
            reader.onerror = () => {
                alert("Ошибка чтения файла.");
            };
            reader.readAsDataURL(file);
        }
    });

    btnRemoveTextureFile.addEventListener('click', () => {
        uploadedTextureImg = null;
        inputTextureFile.value = '';
        updateTextureUploadVisibility();
        updateInputsPreview();
        triggerAutoRender(0);
    });

    // Настройки 3D эффекта
    const sliderEyeSep = document.getElementById('slider-eye-sep');
    const valEyeSep = document.getElementById('val-eye-sep');
    const sliderMaxDepth = document.getElementById('slider-max-depth');
    const valMaxDepth = document.getElementById('val-max-depth');
    const selectPrintDpi = document.getElementById('select-print-dpi');
    const sliderSmoothing = document.getElementById('slider-smoothing');
    const valSmoothing = document.getElementById('val-smoothing');
    const sliderObsDist = document.getElementById('slider-obs-dist');
    const valObsDist = document.getElementById('val-obs-dist');
    const sliderPhysicalEyeSep = document.getElementById('slider-physical-eye-sep');
    const valPhysicalEyeSep = document.getElementById('val-physical-eye-sep');
    const sliderGeometryBlur = document.getElementById('slider-geometry-blur');
    const valGeometryBlur = document.getElementById('val-geometry-blur');
    const guideDotsWrapper = document.getElementById('guide-dots-wrapper');

    // Режим полос (Stripe Mode) DOM элементы
    const btnStripesAdaptive = document.getElementById('btn-stripes-adaptive');
    const btnStripesFixed = document.getElementById('btn-stripes-fixed');
    const controlEyeSep = document.getElementById('control-eye-sep');
    const controlStripesCount = document.getElementById('control-stripes-count');
    const sliderStripesCount = document.getElementById('slider-stripes-count');
    const valStripesCount = document.getElementById('val-stripes-count');

    const updateRenderParamsDisplay = () => {
        // Расчет пикселей для превью (на основе ширины холста)
        const previewW = canvasOutput.width;
        const physicalWidth = aspectRatio === 'landscape' ? 297 : 210;
        const previewScale = previewW / physicalWidth;
        
        let previewEyeSep;
        let pStep;
        if (stripesMode === 'fixed') {
            previewEyeSep = Math.round(previewW / (stripesCount + 1));
            pStep = previewEyeSep / previewScale;
        } else {
            pStep = parseFloat(sliderEyeSep.value);
            previewEyeSep = Math.round(pStep * previewScale);
        }

        const pDepth = parseFloat(sliderMaxDepth.value);
        const previewMaxDepth = Math.round(pDepth * previewScale);
        const previewMaxDepthPercent = Math.round((pDepth / pStep) * 100);

        valEyeSep.textContent = pStep.toFixed(1) + ' мм (~' + previewEyeSep + ' px на экране)';
        valMaxDepth.textContent = pDepth.toFixed(1) + ' мм (~' + previewMaxDepth + ' px / ' + previewMaxDepthPercent + '%)';
        
        if (valStripesCount && sliderStripesCount) {
            valStripesCount.textContent = stripesCount + ' (~' + previewEyeSep + ' px / полоса)';
        }

        valSmoothing.textContent = sliderSmoothing.value;
        if (valObsDist && sliderObsDist) {
            valObsDist.textContent = sliderObsDist.value + ' см';
        }
        if (valPhysicalEyeSep && sliderPhysicalEyeSep) {
            valPhysicalEyeSep.textContent = sliderPhysicalEyeSep.value + ' мм';
        }
        if (valGeometryBlur && sliderGeometryBlur) {
            valGeometryBlur.textContent = sliderGeometryBlur.value + ' px';
        }
        
        // Синхронизируем расстояние вспомогательных точек с ползунком Eye Sep!
        guideDotsWrapper.style.gap = previewEyeSep + 'px';
    };

    // Режимы базовой полосы (Main Stripe)
    let mainStripeMode = 'middle';
    const btnStripeMiddle = document.getElementById('btn-stripe-middle');
    const btnStripeLeft = document.getElementById('btn-stripe-left');

    if (btnStripeMiddle && btnStripeLeft) {
        btnStripeMiddle.addEventListener('click', () => {
            mainStripeMode = 'middle';
            btnStripeMiddle.classList.add('active');
            btnStripeLeft.classList.remove('active');
            triggerAutoRender(0);
        });

        btnStripeLeft.addEventListener('click', () => {
            mainStripeMode = 'left';
            btnStripeLeft.classList.add('active');
            btnStripeMiddle.classList.remove('active');
            triggerAutoRender(0);
        });
    }

    // События input (движение ползунка) вызывают авто-рендер с задержкой (150ms), чтобы не перегружать процессор
    sliderEyeSep.addEventListener('input', () => { updateRenderParamsDisplay(); triggerAutoRender(150); });
    sliderMaxDepth.addEventListener('input', () => { updateRenderParamsDisplay(); triggerAutoRender(150); });
    if (selectPrintDpi) {
        selectPrintDpi.addEventListener('change', () => { syncCanvasResolution(); });
    }
    sliderSmoothing.addEventListener('input', () => { updateRenderParamsDisplay(); triggerAutoRender(150); });
    if (sliderObsDist) {
        sliderObsDist.addEventListener('input', () => { updateRenderParamsDisplay(); triggerAutoRender(150); });
    }
    if (sliderPhysicalEyeSep) {
        sliderPhysicalEyeSep.addEventListener('input', () => { updateRenderParamsDisplay(); triggerAutoRender(150); });
    }
    if (sliderGeometryBlur) {
        sliderGeometryBlur.addEventListener('input', () => { updateRenderParamsDisplay(); triggerAutoRender(150); });
    }
    
    // События change (когда отпускают мышь с ползунка) мгновенно запускают рендер
    sliderEyeSep.addEventListener('change', () => triggerAutoRender(0));
    sliderMaxDepth.addEventListener('change', () => triggerAutoRender(0));
    sliderSmoothing.addEventListener('change', () => triggerAutoRender(0));
    if (sliderObsDist) {
        sliderObsDist.addEventListener('change', () => triggerAutoRender(0));
    }
    if (sliderPhysicalEyeSep) {
        sliderPhysicalEyeSep.addEventListener('change', () => triggerAutoRender(0));
    }
    if (sliderGeometryBlur) {
        sliderGeometryBlur.addEventListener('change', () => triggerAutoRender(0));
    }
    
    updateRenderParamsDisplay();

    // Слайдер тумана
    const sliderFogDensity = document.getElementById('slider-fog-density');
    const valFogDensity = document.getElementById('val-fog-density');

    if (sliderFogDensity && valFogDensity) {
        sliderFogDensity.addEventListener('input', () => {
            valFogDensity.textContent = sliderFogDensity.value + '%';
            triggerAutoRender(150);
        });
        sliderFogDensity.addEventListener('change', () => triggerAutoRender(0));
    }

    const chkUseHSR = document.getElementById('chk-use-hsr');
    if (chkUseHSR) {
        chkUseHSR.addEventListener('change', () => {
            triggerAutoRender(0);
        });
    }

    let activeAlgo = 'stereolab';
    const btnAlgoStereoLab = document.getElementById('btn-algo-stereolab');
    const btnAlgoSteer = document.getElementById('btn-algo-steer');
    if (btnAlgoStereoLab && btnAlgoSteer) {
        btnAlgoStereoLab.addEventListener('click', () => {
            activeAlgo = 'stereolab';
            btnAlgoStereoLab.classList.add('active');
            btnAlgoSteer.classList.remove('active');
            triggerAutoRender(0);
        });
        btnAlgoSteer.addEventListener('click', () => {
            activeAlgo = 'steer';
            btnAlgoSteer.classList.add('active');
            btnAlgoStereoLab.classList.remove('active');
            triggerAutoRender(0);
        });
    }

    const chkUseYShift = document.getElementById('chk-use-yshift');
    if (chkUseYShift) {
        chkUseYShift.addEventListener('change', () => {
            triggerAutoRender(0);
        });
    }

    const chkUseRetouch = document.getElementById('chk-use-retouch');
    if (chkUseRetouch) {
        chkUseRetouch.addEventListener('change', () => {
            triggerAutoRender(0);
        });
    }

    // Режим полос (Адаптивная / Весь экран)

    const updateStripesModeUI = () => {
        if (stripesMode === 'adaptive') {
            if (btnStripesAdaptive) btnStripesAdaptive.classList.add('active');
            if (btnStripesFixed) btnStripesFixed.classList.remove('active');
            if (controlEyeSep) controlEyeSep.classList.remove('hidden');
            if (controlStripesCount) controlStripesCount.classList.add('hidden');
        } else {
            if (btnStripesFixed) btnStripesFixed.classList.add('active');
            if (btnStripesAdaptive) btnStripesAdaptive.classList.remove('active');
            if (controlEyeSep) controlEyeSep.classList.add('hidden');
            if (controlStripesCount) controlStripesCount.classList.remove('hidden');
        }
    };

    if (btnStripesAdaptive && btnStripesFixed) {
        btnStripesAdaptive.addEventListener('click', () => {
            stripesMode = 'adaptive';
            updateStripesModeUI();
            updateRenderParamsDisplay();
            triggerAutoRender(0);
        });

        btnStripesFixed.addEventListener('click', () => {
            stripesMode = 'fixed';
            updateStripesModeUI();
            updateRenderParamsDisplay();
            triggerAutoRender(0);
        });
    }

    if (sliderStripesCount) {
        sliderStripesCount.addEventListener('input', () => {
            stripesCount = parseInt(sliderStripesCount.value);
            if (valStripesCount) valStripesCount.textContent = stripesCount;
            updateRenderParamsDisplay();
            triggerAutoRender(150);
        });
        sliderStripesCount.addEventListener('change', () => triggerAutoRender(0));
    }

    // Кэш для процедурных и загруженных текстур
    let patternCache = {
        key: null,
        canvas: null
    };

    // Хелпер для получения текстуры/паттерна
    function getPatternCanvas(w, h) {
        const texSource = selectTextureSource.value;
        const isProcedural = texSource !== 'upload';

        // Вычисляем ширину полосы повторения (eyeSep) для текущего разрешения
        const eyeSepPixels = getEyeSepPixels(w);
        const patternW = isProcedural ? eyeSepPixels : w;

        const sliderFog = document.getElementById('slider-fog-density');
        const fogDensity = sliderFog ? parseFloat(sliderFog.value) : 30;

        // Создаем ключ кэша на основе всех параметров текстуры
        const cacheKey = `${selectedType}_${texSource}_${patternW}_${w}_${h}_${fogDensity}_${uploadedTextureImg ? uploadedTextureImg.src : 'none'}`;

        if (patternCache.key === cacheKey && patternCache.canvas) {
            return patternCache.canvas;
        }

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = patternW;
        tempCanvas.height = h;
        const tempCtx = tempCanvas.getContext('2d');

        if (selectedType === 'mts') {
            if (texSource === 'upload' && uploadedTextureImg && uploadedTextureImg.width > 0 && uploadedTextureImg.height > 0) {
                tempCtx.drawImage(uploadedTextureImg, 0, 0, patternW, h);
            } else {
                const patternData = getProceduralTexture(texSource, patternW, h);
                tempCtx.putImageData(patternData, 0, 0);
            }
        } else if (selectedType === 'rds') {
            const noiseImg = tempCtx.createImageData(patternW, h);
            const noiseData = noiseImg.data;
            for (let i = 0; i < noiseData.length; i += 4) {
                noiseData[i] = Math.floor(Math.random() * 256);
                noiseData[i+1] = Math.floor(Math.random() * 256);
                noiseData[i+2] = Math.floor(Math.random() * 256);
                noiseData[i+3] = 255;
            }
            tempCtx.putImageData(noiseImg, 0, 0);
        } else if (selectedType === 'mask') {
            tempCtx.fillStyle = '#000000';
            tempCtx.fillRect(0, 0, patternW, h);
            tempCtx.fillStyle = '#ffffff';
            tempCtx.fillRect(Math.floor(patternW / 2) - 2, 0, 4, h);
        }

        patternCache.key = cacheKey;
        patternCache.canvas = tempCanvas;
        return tempCanvas;
    }

    // Карта глубин и текстурные превью на вкладке генератора
    const canvasPreviewDepth = document.getElementById('canvas-preview-depth');
    const canvasPreviewTexture = document.getElementById('canvas-preview-texture');

    function updateInputsPreview() {
        // Рендерим карту глубин в превью
        const pCtxD = canvasPreviewDepth.getContext('2d');
        pCtxD.fillStyle = '#000';
        pCtxD.fillRect(0, 0, canvasPreviewDepth.width, canvasPreviewDepth.height);
        
        const source = selectDepthSource.value;
        if (source === 'editor') {
            pCtxD.drawImage(depthEditor.canvas, 0, 0, canvasPreviewDepth.width, canvasPreviewDepth.height);
        } else if (source === 'upload' && uploadedDepthImg && uploadedDepthImg.width > 0 && uploadedDepthImg.height > 0) {
            pCtxD.drawImage(uploadedDepthImg, 0, 0, canvasPreviewDepth.width, canvasPreviewDepth.height);
        } else {
            // Отрисовка встроенного шаблона
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = canvasOutput.width;
            tempCanvas.height = canvasOutput.height;
            const tempEditor = new DepthEditor(tempCanvas);
            
            if (source === 'preset-pyramid') tempEditor.drawPresetShape('pyramid', 255);
            else if (source === 'preset-sphere') tempEditor.drawPresetShape('sphere', 255);
            else if (source === 'preset-text') {
                tempEditor.textString = "STEREO";
                tempEditor.textSize = canvasOutput.width < 1000 ? 100 : 140; // адаптируем под портретный режим
                tempEditor.textProfile = "beveled";
                tempEditor.add3DText();
            }
            pCtxD.drawImage(tempEditor.canvas, 0, 0, canvasPreviewDepth.width, canvasPreviewDepth.height);
        }

        // Рендерим паттерн текстуры в превью
        const pCtxT = canvasPreviewTexture.getContext('2d');
        pCtxT.fillStyle = '#000';
        pCtxT.fillRect(0, 0, canvasPreviewTexture.width, canvasPreviewTexture.height);
        
        const filteredPattern = getPatternCanvas(canvasPreviewTexture.width, canvasPreviewTexture.height);
        pCtxT.drawImage(filteredPattern, 0, 0);

        // Синхронизируем вкладку "Карта глубин" с текущим состоянием
        drawDepthView();
    }

    // Отрисовка карты глубин на основном холсте просмотра
    function drawDepthView() {
        if (!canvasDepthView) return;
        const w = canvasOutput.width;
        const h = canvasOutput.height;
        if (canvasDepthView.width !== w || canvasDepthView.height !== h) {
            canvasDepthView.width = w;
            canvasDepthView.height = h;
        }

        const ctx = canvasDepthView.getContext('2d');
        
        // Очищаем и настраиваем фильтр размытия геометрии
        ctx.save();
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, w, h);
        
        const geometryBlur = parseInt(sliderGeometryBlur.value);
        if (geometryBlur > 0) {
            ctx.filter = `blur(${geometryBlur}px)`;
        } else {
            ctx.filter = 'none';
        }

        const source = selectDepthSource.value;
        if (source === 'editor') {
            ctx.drawImage(depthEditor.canvas, 0, 0, w, h);
        } else if (source === 'upload' && uploadedDepthImg && uploadedDepthImg.width > 0 && uploadedDepthImg.height > 0) {
            ctx.drawImage(uploadedDepthImg, 0, 0, w, h);
        } else {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = w;
            tempCanvas.height = h;
            const tempEditor = new DepthEditor(tempCanvas);
            if (source === 'preset-pyramid') tempEditor.drawPresetShape('pyramid', 255);
            else if (source === 'preset-sphere') tempEditor.drawPresetShape('sphere', 255);
            else if (source === 'preset-text') {
                tempEditor.textString = "STEREO";
                tempEditor.textSize = w < 1000 ? 100 : 140;
                tempEditor.textProfile = "beveled";
                tempEditor.add3DText();
            }
            ctx.drawImage(tempCanvas, 0, 0, w, h);
        }
        ctx.restore();
    }

    // Вспомогательный генератор текстур/шума
    function getProceduralTexture(type, w, h) {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        
        if (type === 'preset-dots-blue-color' || type === 'preset-dots-blue-mono') {
            // Генерируем белый шум
            const wCanvas = document.createElement('canvas');
            wCanvas.width = w;
            wCanvas.height = h;
            const wCtx = wCanvas.getContext('2d');
            const wImg = wCtx.createImageData(w, h);
            const wData = wImg.data;
            for (let i = 0; i < wData.length; i += 4) {
                wData[i] = Math.floor(Math.random() * 256);
                wData[i+1] = Math.floor(Math.random() * 256);
                wData[i+2] = Math.floor(Math.random() * 256);
                wData[i+3] = 255;
            }
            wCtx.putImageData(wImg, 0, 0);

            // Размываем его (низкочастотная фильтрация)
            const bCanvas = document.createElement('canvas');
            bCanvas.width = w;
            bCanvas.height = h;
            const bCtx = bCanvas.getContext('2d');
            bCtx.filter = 'blur(2px)';
            bCtx.drawImage(wCanvas, 0, 0);
            
            const origData = wData;
            const blurredData = bCtx.getImageData(0, 0, w, h).data;
            
            const finalImg = ctx.createImageData(w, h);
            const finalData = finalImg.data;
            
            const isMono = type === 'preset-dots-blue-mono';
            
            for (let i = 0; i < finalData.length; i += 4) {
                // Вычитаем размытие (высокочастотный фильтр)
                let r = (origData[i] - blurredData[i]) * 2.8 + 128;
                let g = (origData[i+1] - blurredData[i+1]) * 2.8 + 128;
                let b = (origData[i+2] - blurredData[i+2]) * 2.8 + 128;
                
                r = Math.max(0, Math.min(255, r));
                g = Math.max(0, Math.min(255, g));
                b = Math.max(0, Math.min(255, b));
                
                if (isMono) {
                    const gray = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
                    finalData[i] = gray;
                    finalData[i+1] = gray;
                    finalData[i+2] = gray;
                } else {
                    finalData[i] = r;
                    finalData[i+1] = g;
                    finalData[i+2] = b;
                }
                finalData[i+3] = 255;
            }
            return finalImg;
        } else if (type === 'preset-pattern-perlin') {
            const finalImg = ctx.createImageData(w, h);
            const finalData = finalImg.data;

            // Вспомогательные функции для нового шума Перлина
            function smoothstep(t) {
                return t * t * (3.0 - 2.0 * t);
            }
            function lerp(t, a, b) {
                return a + t * (b - a);
            }

            // Класс фабрики шума Перлина, переведенный с Python
            class PerlinNoiseFactory {
                constructor(dimension, octaves = 1, tile = [], unbias = false) {
                    this.dimension = dimension;
                    this.octaves = octaves;
                    this.tile = [...tile];
                    while (this.tile.length < dimension * 2) this.tile.push(0);
                    this.unbias = unbias;
                    this.scale_factor = 2.0 * Math.pow(dimension, -0.5);
                    this.gradient = {};
                }
                _generate_gradient() {
                    if (this.dimension === 1) return [Math.random() * 2.0 - 1.0];
                    const random_point = [];
                    for (let i = 0; i < this.dimension; i++) {
                        let u = 0, v = 0;
                        while (u === 0) u = Math.random();
                        while (v === 0) v = Math.random();
                        const num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
                        random_point.push(num);
                    }
                    const sumSq = random_point.reduce((sum, n) => sum + n * n, 0);
                    const scale = sumSq === 0 ? 1 : Math.pow(sumSq, -0.5);
                    return random_point.map(coord => coord * scale);
                }
                get_plain_noise(point, o2) {
                    if (point.length !== this.dimension) {
                        throw new Error(`Expected ${this.dimension} values, got ${point.length}`);
                    }

                    const minX = Math.floor(point[0]);
                    const maxX = minX + 1;
                    const minY = Math.floor(point[1]);
                    const maxY = minY + 1;
                    const grid_coords = [[minX, maxX], [minY, maxY]];
                    const grid_points = [[minX, minY], [minX, maxY], [maxX, minY], [maxX, maxY]];

                    const dots = [];
                    for (let grid_point of grid_points) {
                        // Оборачиваем координаты сетки для бесшовного зацикливания
                        const wrapped_grid_point = grid_point.map((c, i) => {
                            if (this.tile[i]) {
                                const mod = this.tile[i] * o2;
                                let val = c % mod;
                                if (val < 0) val += mod;
                                return val;
                            }
                            return c;
                        });
                        const key = wrapped_grid_point.join(',');
                        if (!this.gradient[key]) this.gradient[key] = this._generate_gradient();
                        const gradient = this.gradient[key];
                        let dot = gradient[0] * (point[0] - grid_point[0]) + gradient[1] * (point[1] - grid_point[1]);
                        dots.push(dot);
                    }

                    let dim = this.dimension;
                    let activeDots = [...dots];
                    while (activeDots.length > 1) {
                        dim -= 1;
                        const s = smoothstep(point[dim] - grid_coords[dim][0]);
                        const next_dots = [];
                        while (activeDots.length > 0) {
                            next_dots.push(lerp(s, activeDots.shift(), activeDots.shift()));
                        }
                        activeDots = next_dots;
                    }
                    return activeDots[0] * this.scale_factor;
                }
                call(...point) {
                    let ret = 0;
                    for (let o = 0; o < this.octaves; o++) {
                        const o2 = 1 << o;
                        const new_point = [];
                        for (let i = 0; i < point.length; i++) {
                            let coord = point[i] * o2;
                            if (this.tile[i]) {
                                coord = coord % (this.tile[i] * o2);
                            }
                            new_point.push(coord);
                        }
                        ret += this.get_plain_noise(new_point, o2) / o2;
                    }
                    ret /= 2.0 - Math.pow(2.0, 1.0 - this.octaves);
                    if (this.unbias) {
                        let r = (ret + 1.0) / 2.0;
                        const limit = Math.floor(this.octaves / 2.0 + 0.5);
                        for (let i = 0; i < limit; i++) r = smoothstep(r);
                        ret = r * 2.0 - 1.0;
                    }
                    return ret;
                }
            }

            // Масштабируем шум относительно ширины полосы повторения w (eyeSep)
            const tileX = 4;
            const scale = tileX / w;
            const pnf = new PerlinNoiseFactory(2, 4, [tileX, 0], true);

            const sliderFog = document.getElementById('slider-fog-density');
            const fogDensity = sliderFog ? parseFloat(sliderFog.value) / 100 : 0.3;

            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const idx = (y * w + x) * 4;
                    
                    // Переводим пиксельные координаты в изотропные координаты шума
                    const nx = x * scale;
                    const ny = y * scale;
                    
                    let val = pnf.call(nx, ny);
                    val = val * 0.5 + 0.5; // мапим диапазон [-1, 1] в [0, 1]

                    let gray = Math.round(val * 255);
                    if (fogDensity > 0) {
                        gray = Math.round(gray * (1 - fogDensity) + 240 * fogDensity);
                    }

                    finalData[idx] = gray;
                    finalData[idx + 1] = gray;
                    finalData[idx + 2] = gray;
                    finalData[idx + 3] = 255;
                }
            }
            return finalImg;
        } else if (type === 'preset-dots-color') {
            // Цветной случайный шум
            const imgData = ctx.createImageData(w, h);
            for (let i = 0; i < imgData.data.length; i += 4) {
                imgData.data[i] = Math.floor(Math.random() * 256);
                imgData.data[i + 1] = Math.floor(Math.random() * 256);
                imgData.data[i + 2] = Math.floor(Math.random() * 256);
                imgData.data[i + 3] = 255;
            }
            return imgData;
        } else if (type === 'preset-dots-mono') {
            // Черно-белый шум
            const imgData = ctx.createImageData(w, h);
            for (let i = 0; i < imgData.data.length; i += 4) {
                const val = Math.floor(Math.random() * 256);
                imgData.data[i] = val;
                imgData.data[i + 1] = val;
                imgData.data[i + 2] = val;
                imgData.data[i + 3] = 255;
            }
            return imgData;
        } else if (type === 'preset-pattern-brick') {
            // Паттерн: Кирпичная кладка
            ctx.fillStyle = '#b7410e'; // красный кирпич
            ctx.fillRect(0, 0, w, h);
            
            ctx.strokeStyle = '#cccccc'; // цемент
            ctx.lineWidth = 2;
            
            const brickH = 20;
            const brickW = 40;
            
            for (let y = 0; y < h; y += brickH) {
                // Горизонтальный шов
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(w, y);
                ctx.stroke();
                
                // Вертикальные швы
                const offset = ((y / brickH) % 2) * (brickW / 2);
                for (let x = -brickW; x < w + brickW; x += brickW) {
                    ctx.beginPath();
                    ctx.moveTo(x + offset, y);
                    ctx.lineTo(x + offset, y + brickH);
                    ctx.stroke();
                }
            }
            return ctx.getImageData(0, 0, w, h);
        } else if (type === 'preset-pattern-grass') {
            // Паттерн: Трава (процедурный шум зеленых тонов)
            ctx.fillStyle = '#2d5a27'; // темно-зеленый
            ctx.fillRect(0, 0, w, h);
            
            // Добавляем травинки
            ctx.strokeStyle = '#4e9a06';
            ctx.lineWidth = 1;
            for (let i = 0; i < 3000; i++) {
                const x = Math.random() * w;
                const y = Math.random() * h;
                const len = 5 + Math.random() * 12;
                const angle = (Math.random() - 0.5) * 0.3;
                
                ctx.beginPath();
                ctx.moveTo(x, y);
                ctx.lineTo(x + Math.sin(angle) * len, y - Math.cos(angle) * len);
                ctx.stroke();
            }
            return ctx.getImageData(0, 0, w, h);
        } else if (type === 'preset-pattern-water') {
            // Паттерн: Вода (синие волны)
            ctx.fillStyle = '#0f4c81';
            ctx.fillRect(0, 0, w, h);
            
            ctx.strokeStyle = '#3a86c8';
            ctx.lineWidth = 2;
            for (let y = 0; y < h; y += 15) {
                ctx.beginPath();
                for (let x = 0; x < w; x++) {
                    const dy = Math.sin((x / 15) + (y / 5)) * 3;
                    if (x === 0) ctx.moveTo(x, y + dy);
                    else ctx.lineTo(x, y + dy);
                }
                ctx.stroke();
            }
            return ctx.getImageData(0, 0, w, h);
        }
        
        return ctx.createImageData(w, h);
    }

    // Переключение видимости исходников внизу
    const btnToggleInputs = document.getElementById('btn-toggle-inputs');
    const inputsPreviewPanel = document.getElementById('inputs-preview-panel');
    btnToggleInputs.addEventListener('click', () => {
        inputsPreviewPanel.classList.toggle('hidden');
    });

    // -------------------------------------------------------------
    // РЕНДЕРИНГ СТЕРЕОГРАММЫ
    // -------------------------------------------------------------
    const btnDownload = document.getElementById('btn-download');
    const renderPlaceholder = document.getElementById('render-placeholder');

    function generateAndDraw(isPreview = false) {
        const w = canvasOutput.width;
        const h = canvasOutput.height;
        
        // 0. Получаем исходную карту глубины без размытия
        let rawDepthElement = null;
        const depthSource = selectDepthSource.value;
        let tempCanvasDepth = null;

        if (depthSource === 'editor') {
            rawDepthElement = depthEditor.canvas;
        } else {
            tempCanvasDepth = document.createElement('canvas');
            tempCanvasDepth.width = w;
            tempCanvasDepth.height = h;
            const tempEditor = new DepthEditor(tempCanvasDepth);
            
            if (depthSource === 'upload' && uploadedDepthImg && uploadedDepthImg.width > 0 && uploadedDepthImg.height > 0) {
                tempEditor.ctx.drawImage(uploadedDepthImg, 0, 0, w, h);
            } else if (depthSource === 'preset-pyramid') {
                tempEditor.drawPresetShape('pyramid', 255);
            } else if (depthSource === 'preset-sphere') {
                tempEditor.drawPresetShape('sphere', 255);
            } else if (depthSource === 'preset-text') {
                tempEditor.textString = "STEREO";
                tempEditor.textSize = w < 1000 ? 100 : 150;
                tempEditor.textProfile = "beveled";
                tempEditor.add3DText();
            }
            rawDepthElement = tempCanvasDepth;
        }

        // Применяем неразрушающее сглаживание (Geometry Blur), масштабируя его относительно ширины холста (базовая ширина 1200px)
        const rawBlur = parseFloat(sliderGeometryBlur.value);
        const scaledBlur = rawBlur * (w / 1200);
        let depthSourceElement = null;
        if (scaledBlur > 0) {
            const blurCanvas = document.createElement('canvas');
            blurCanvas.width = w;
            blurCanvas.height = h;
            const blurCtx = blurCanvas.getContext('2d');
            blurCtx.filter = `blur(${scaledBlur}px)`;
            blurCtx.drawImage(rawDepthElement, 0, 0, w, h);
            depthSourceElement = blurCanvas;
        } else {
            // Если размытия нет, нам все равно нужно убедиться, что для WebGL/2D текстура имеет правильный размер w x h
            if (rawDepthElement.width !== w || rawDepthElement.height !== h) {
                const scaleCanvas = document.createElement('canvas');
                scaleCanvas.width = w;
                scaleCanvas.height = h;
                const scaleCtx = scaleCanvas.getContext('2d');
                scaleCtx.drawImage(rawDepthElement, 0, 0, w, h);
                depthSourceElement = scaleCanvas;
            } else {
                depthSourceElement = rawDepthElement;
            }
        }

        // 1. Если это интерактивный превью и WebGL доступен — рендерим на GPU!
        if (isPreview && webglRenderer) {
            renderPlaceholder.classList.add('hidden');
            canvasOutputWebGL.classList.remove('hidden');
            canvasOutputWebGL.classList.add('active-stereo');
            canvasOutput.classList.add('hidden');
            canvasOutput.classList.remove('active-stereo');

            // 1.2 Получаем источник текстуры/паттерна
            let patternSourceElement = null;
            const physicalWidth = aspectRatio === 'landscape' ? 297 : 210;
            const scale = w / physicalWidth;
            const eyeSepPixels = getEyeSepPixels(w);

            if (selectedType === 'mts') {
                patternSourceElement = getPatternCanvas(w, h);
            } else if (selectedType === 'rds') {
                const noiseCanvas = document.createElement('canvas');
                noiseCanvas.width = eyeSepPixels;
                noiseCanvas.height = h;
                const noiseCtx = noiseCanvas.getContext('2d');
                const noiseImg = noiseCtx.createImageData(noiseCanvas.width, noiseCanvas.height);
                const noiseData = noiseImg.data;
                for (let i = 0; i < noiseData.length; i += 4) {
                    noiseData[i] = Math.floor(Math.random() * 256);
                    noiseData[i+1] = Math.floor(Math.random() * 256);
                    noiseData[i+2] = Math.floor(Math.random() * 256);
                    noiseData[i+3] = 255;
                }
                noiseCtx.putImageData(noiseImg, 0, 0);
                patternSourceElement = noiseCanvas;
            } else if (selectedType === 'mask') {
                const maskCanvas = document.createElement('canvas');
                maskCanvas.width = eyeSepPixels;
                maskCanvas.height = h;
                const maskCtx = maskCanvas.getContext('2d');
                maskCtx.fillStyle = '#000000';
                maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
                maskCtx.fillStyle = '#ffffff';
                maskCtx.fillRect(Math.floor(eyeSepPixels / 2) - 2, 0, 4, h);
                patternSourceElement = maskCanvas;
            }

            // Вычисляем макс. сдвиг в пикселях пропорционально физической глубине в мм
            const pixelShift = Math.round(parseFloat(sliderMaxDepth.value) * scale);
            const useHSR = chkUseHSR ? chkUseHSR.checked : true;
            const useYShift = chkUseYShift ? chkUseYShift.checked : true;
            const yShift = Math.max(1, Math.round((w / (physicalWidth / 25.4)) / 16));

            // 1.3 Передаем текстуры в WebGL и рендерим
            if (depthSourceElement && patternSourceElement) {
                try {
                    webglRenderer.updateDepthTexture(depthSourceElement);
                    webglRenderer.updatePatternTexture(patternSourceElement);
                    webglRenderer.render({
                        eyeSep: eyeSepPixels,
                        maxDepth: pixelShift,
                        viewMode: viewMode,
                        mainStripeMode: mainStripeMode,
                        useHSR: useHSR,
                        algorithm: activeAlgo,
                        useYShift: useYShift, // Используем реальное значение чекбокса
                        yShift: yShift
                    });
                } catch (glError) {
                    console.error("Ошибка WebGL рендеринга, переключение на CPU:", glError);
                    // Фолбек на CPU в случае краша WebGL
                    webglRenderer = null;
                    generateAndDraw(isPreview);
                    return;
                }
            }

            btnDownload.disabled = false;
            return;
        }

        // 2. Медленный CPU рендер для финальной картинки (без лесенок, с субпикселями)
        const depthCtx = depthSourceElement.getContext('2d');
        const depthImgData = depthCtx.getImageData(0, 0, w, h);
        const depthDataArray = depthImgData.data;
        const depthMap = [];
        for (let y = 0; y < h; y++) {
            const row = new Uint8Array(w);
            for (let x = 0; x < w; x++) {
                const idx = (y * w + x) * 4;
                row[x] = depthDataArray[idx]; // берем R канал
            }
            depthMap.push(row);
        }

        // Получаем текстуру (ImageData) для MTS
        let textureData = null;
        if (selectedType === 'mts') {
            const filteredPattern = getPatternCanvas(w, h);
            textureData = filteredPattern.getContext('2d').getImageData(0, 0, filteredPattern.width, filteredPattern.height);
        }

        const physicalWidth = aspectRatio === 'landscape' ? 297 : 210;
        const scale = w / physicalWidth;
        const eyeSepVal = getEyeSepPixels(w);
        const pixelShift = Math.round(parseFloat(sliderMaxDepth.value) * scale);
        const useHSR = chkUseHSR ? chkUseHSR.checked : true;
        const useYShift = chkUseYShift ? chkUseYShift.checked : true;
        const useRetouch = chkUseRetouch ? chkUseRetouch.checked : true;
        const yShift = Math.max(1, Math.round((w / (physicalWidth / 25.4)) / 16));

        const renderOpts = {
            width: w,
            height: h,
            depthData: depthMap,
            type: selectedType,
            eyeSep: eyeSepVal,
            maxDepth: pixelShift,
            smoothing: parseInt(sliderSmoothing.value),
            viewMode: viewMode,
            textureData: textureData,
            subpixels: isPreview ? 1 : (parseInt(sliderSmoothing.value) > 0 ? 3 : 1),
            distanceToEyes: sliderObsDist ? parseInt(sliderObsDist.value) / 100 : 0.5,
            distanceBetweenEyes: sliderPhysicalEyeSep ? parseInt(sliderPhysicalEyeSep.value) / 1000 : 0.065,
            mainStripeMode: mainStripeMode,
            useHSR: useHSR,
            algorithm: activeAlgo,
            useYShift: useYShift,
            yShift: yShift,
            useRetouch: useRetouch
        };

        const resultPixels = StereoCore.generate(renderOpts);

        // Отрисовываем результат на результирующем Canvas
        const outCtx = canvasOutput.getContext('2d');
        const outImgData = outCtx.createImageData(w, h);
        outImgData.data.set(resultPixels);
        outCtx.putImageData(outImgData, 0, 0);

        // Показываем 2D холст, скрываем WebGL холст
        renderPlaceholder.classList.add('hidden');
        canvasOutput.classList.remove('hidden');
        canvasOutput.classList.add('active-stereo');
        canvasOutputWebGL.classList.add('hidden');
        canvasOutputWebGL.classList.remove('active-stereo');

        btnDownload.disabled = false;
    }

    // Сохранение изображения (Экспорт)
    btnDownload.addEventListener('click', () => {
        console.log('Download clicked, active canvas:', getActive3DCanvas() ? getActive3DCanvas().id : 'none');
        try {
            const activeCanvas = getActive3DCanvas();
            if (!activeCanvas) {
                alert("Ошибка: нет активного холста для сохранения.");
                return;
            }
            
            const w = activeCanvas.width;
            const h = activeCanvas.height;

            const link = document.createElement('a');
            link.download = `stereogram_${w}x${h}_${Date.now()}.png`;
            link.href = activeCanvas.toDataURL('image/png');
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (err) {
            console.error("Ошибка при экспорте:", err);
            alert("Произошла ошибка при экспорте стереограммы.");
        }
    });

    // Инициализация превью при загрузке
    updateTextureUploadVisibility();
    updateDepthUploadVisibility();
    syncCanvasResolution(true);

    // -------------------------------------------------------------
    // 5. ИНИЦИАЛИЗАЦИЯ И УПРАВЛЕНИЕ ДЕКОДЕРОМ
    // -------------------------------------------------------------
    const inputDecoderFile = document.getElementById('input-decoder-file');
    if (inputDecoderFile) {
        const decoderUploadBox = document.getElementById('decoder-upload-box');
        const decoderFileInfo = document.getElementById('decoder-file-info');
        const lblDecoderFilename = document.getElementById('lbl-decoder-filename');
        const btnRemoveDecoderFile = document.getElementById('btn-remove-decoder-file');

        const canvasDecInput = document.getElementById('canvas-decoder-input');
        const canvasDecOutput = document.getElementById('canvas-decoder-output');
        
        const decInputPlaceholder = document.getElementById('decoder-input-placeholder');
        const decOutputPlaceholder = document.getElementById('decoder-output-placeholder');
        
        const btnDecode = document.getElementById('btn-decode');
        const btnDownloadDecoded = document.getElementById('btn-download-decoded');

        const sliderDecSep = document.getElementById('slider-dec-sep');
        const valDecSep = document.getElementById('val-dec-sep');
        const sliderDecContrast = document.getElementById('slider-dec-contrast');
        const valDecContrast = document.getElementById('val-dec-contrast');
        const controlDecContrast = document.getElementById('control-dec-contrast');

        let uploadedDecoderImg = null;
        let decoderMode = 'diff'; // 'diff' или 'depth'

        // Выбор режима декодирования
        const btnDecModeDiff = document.getElementById('btn-dec-mode-diff');
        const btnDecModeDepth = document.getElementById('btn-dec-mode-depth');

        btnDecModeDiff.addEventListener('click', () => {
            decoderMode = 'diff';
            btnDecModeDiff.classList.add('active');
            btnDecModeDepth.classList.remove('active');
            controlDecContrast.classList.remove('hidden');
        });

        btnDecModeDepth.addEventListener('click', () => {
            decoderMode = 'depth';
            btnDecModeDepth.classList.add('active');
            btnDecModeDiff.classList.remove('active');
            controlDecContrast.classList.add('hidden'); // Режим корреляции не требует ручного контраста
        });

        // Настройка слайдеров декодера
        sliderDecSep.addEventListener('input', () => {
            valDecSep.textContent = sliderDecSep.value + ' px';
            if (uploadedDecoderImg && decoderMode === 'diff') {
                // Для быстрого дифференциального декодера делаем рендер в реальном времени!
                runDecoding();
            }
        });

        sliderDecContrast.addEventListener('input', () => {
            valDecContrast.textContent = 'x' + (sliderDecContrast.value / 10).toFixed(1);
            if (uploadedDecoderImg && decoderMode === 'diff') {
                runDecoding();
            }
        });

        // Загрузка файла в декодер
        inputDecoderFile.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                lblDecoderFilename.textContent = file.name;
                decoderUploadBox.classList.add('hidden');
                decoderFileInfo.classList.remove('hidden');
                
                const reader = new FileReader();
                reader.onload = (event) => {
                    const img = new Image();
                    img.onload = () => {
                        if (img.width === 0 || img.height === 0) {
                            alert("Ошибка: Загруженное изображение имеет нулевой размер или повреждено.");
                            return;
                        }
                        uploadedDecoderImg = img;
                        
                        // Отрисовываем картинку на входной холст декодера
                        const ctx = canvasDecInput.getContext('2d');
                        ctx.clearRect(0, 0, canvasDecInput.width, canvasDecInput.height);
                        ctx.drawImage(img, 0, 0, canvasDecInput.width, canvasDecInput.height);
                        
                        decInputPlaceholder.classList.add('hidden');
                        btnDecode.disabled = false;
                        
                        // Автоматически запускаем первый проход декодирования
                        runDecoding();
                    };
                    img.onerror = () => {
                        alert("Ошибка: Не удалось загрузить или декодировать изображение для декодера.");
                    };
                    img.src = event.target.result;
                };
                reader.onerror = () => {
                    alert("Ошибка чтения файла.");
                };
                reader.readAsDataURL(file);
            }
        });

        btnRemoveDecoderFile.addEventListener('click', () => {
            uploadedDecoderImg = null;
            inputDecoderFile.value = '';
            decoderUploadBox.classList.remove('hidden');
            decoderFileInfo.classList.add('hidden');
            
            // Очищаем холсты
            const ctxIn = canvasDecInput.getContext('2d');
            ctxIn.clearRect(0, 0, canvasDecInput.width, canvasDecInput.height);
            const ctxOut = canvasDecOutput.getContext('2d');
            ctxOut.clearRect(0, 0, canvasDecOutput.width, canvasDecOutput.height);
            
            decInputPlaceholder.classList.remove('hidden');
            decOutputPlaceholder.classList.remove('hidden');
            
            btnDecode.disabled = true;
            btnDownloadDecoded.disabled = true;
        });

        btnDecode.addEventListener('click', () => {
            if (!uploadedDecoderImg) return;
            
            const spinner = btnDecode.querySelector('.btn-spinner');
            spinner.classList.remove('hidden');
            btnDecode.disabled = true;
            
            setTimeout(() => {
                try {
                    runDecoding();
                } finally {
                    spinner.classList.add('hidden');
                    btnDecode.disabled = false;
                }
            }, 50);
        });

        function runDecoding() {
            const w = canvasDecInput.width;
            const h = canvasDecInput.height;
            const ctxIn = canvasDecInput.getContext('2d');
            const imgData = ctxIn.getImageData(0, 0, w, h);
            
            const sep = parseInt(sliderDecSep.value);
            const contrast = parseInt(sliderDecContrast.value) / 10;
            
            let resultPixels;
            
            if (decoderMode === 'diff') {
                resultPixels = StereoDecoder.decodeDiff(imgData, sep, contrast);
            } else {
                resultPixels = StereoDecoder.reconstructDepth(imgData, sep);
            }
            
            const ctxOut = canvasDecOutput.getContext('2d');
            const outImgData = ctxOut.createImageData(w, h);
            outImgData.data.set(resultPixels);
            ctxOut.putImageData(outImgData, 0, 0);
            
            decOutputPlaceholder.classList.add('hidden');
            btnDownloadDecoded.disabled = false;
        }

        // Сохранение декодированной карты
        btnDownloadDecoded.addEventListener('click', () => {
            const link = document.createElement('a');
            link.download = `decoded_depthmap_${Date.now()}.png`;
            link.href = canvasDecOutput.toDataURL('image/png');
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });
    }

    function getActive3DCanvas() {
        if (canvasOutputWebGL && canvasOutputWebGL.classList.contains('active-stereo') && !canvasOutputWebGL.classList.contains('hidden')) {
            return canvasOutputWebGL;
        }
        return canvasOutput;
    }
});
