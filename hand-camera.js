const fingers = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [5, 9, 10, 11, 12], [9, 13, 14, 15, 16], [13, 17, 18, 19, 20], [0, 17]];

function cameraError(error, stage) {
    if (stage === 'model') return '手势模型加载失败，请刷新页面后重试。';
    if (stage === 'video') return '摄像头还没有返回画面，请检查镜头或重试。';
    switch (error.name) {
        case 'NotAllowedError':
        case 'SecurityError':
            return '摄像头被禁止，请在浏览器站点权限中允许摄像头后重试。';
        case 'NotFoundError':
        case 'OverconstrainedError':
            return '找不到可用的摄像头，请连接或开启摄像头后重试。';
        case 'NotReadableError':
        case 'AbortError':
            return '摄像头无法读取，请关闭占用镜头的应用或检查系统设置。';
        default:
            return '摄像头启动失败，请检查权限和设备后重试。';
    }
}

export function createHandCamera({ video, preview, maxHands, onStatus, onHands }) {
    const ctx = preview.getContext('2d');
    let modelPromise;
    let session;

    function loadModel() {
        if (!modelPromise) {
            modelPromise = import('@mediapipe/tasks-vision').then(async ({ FilesetResolver, HandLandmarker }) => {
                const vision = await FilesetResolver.forVisionTasks('./shared/mediapipe/wasm');
                return HandLandmarker.createFromOptions(vision, {
                    baseOptions: { modelAssetPath: './shared/mediapipe/hand_landmarker.task', delegate: 'CPU' },
                    runningMode: 'VIDEO',
                    numHands: maxHands,
                });
            }).catch(error => {
                modelPromise = null;
                throw error;
            });
        }
        return modelPromise;
    }

    function release(mode, message) {
        const current = session;
        session = null;
        if (current) {
            cancelAnimationFrame(current.frame);
            clearTimeout(current.timeout);
            current.stream?.getTracks().forEach(track => track.stop());
            current.finish?.(false);
        }
        video.srcObject = null;
        ctx.clearRect(0, 0, preview.width, preview.height);
        onHands([], performance.now());
        onStatus(mode, message);
    }

    function drawPreview(hands) {
        const w = preview.width;
        const h = Math.max(1, Math.round(w * video.videoHeight / video.videoWidth));
        if (preview.height !== h) preview.height = h;
        ctx.save();
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, w, h);
        ctx.lineWidth = 1.35;
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#8df5d2';
        ctx.fillStyle = '#effff6';
        for (const hand of hands) {
            for (const chain of fingers) {
                ctx.beginPath();
                chain.forEach((joint, index) => {
                    const p = hand[joint];
                    if (index === 0) ctx.moveTo(p.x * w, p.y * h);
                    else ctx.lineTo(p.x * w, p.y * h);
                });
                ctx.stroke();
            }
            for (const p of hand) {
                ctx.beginPath();
                ctx.arc(p.x * w, p.y * h, 1.5, 0, 2 * Math.PI);
                ctx.fill();
            }
        }
        ctx.restore();
    }

    function readFrame(current, now) {
        if (session !== current) return;
        if (video.readyState >= 2 && video.videoWidth && video.currentTime !== current.videoTime
            && now - current.lastSample >= 34) {
            current.videoTime = video.currentTime;
            current.lastSample = now;
            try {
                const { landmarks: hands, worldLandmarks } = current.detector.detectForVideo(video, now);
                if (!current.reading) {
                    clearTimeout(current.timeout);
                    current.reading = true;
                    onStatus('live', '');
                    current.finish(true);
                }
                if (!preview.hidden) drawPreview(hands);
                onHands(hands, now, worldLandmarks, video.videoWidth / video.videoHeight);
            } catch (error) {
                console.warn('Hand tracking stopped', error);
                modelPromise = null;
                release('error', '摄像头画面已打开，但手势识别运行失败，请重试。');
                current.detector.close();
                return;
            }
        } else if (current.reading && now - current.lastSample > 4000) {
            release('error', '摄像头画面中断，请重试。');
            return;
        }
        current.frame = requestAnimationFrame(time => readFrame(current, time));
    }

    async function start() {
        if (session) return false;
        if (!navigator.mediaDevices?.getUserMedia) {
            const message = window.isSecureContext
                ? '当前浏览器无法打开摄像头。请用系统浏览器重试。'
                : '请用 HTTPS 试玩链接开启摄像头。';
            onStatus('error', message);
            return false;
        }
        const current = { frame: 0, lastSample: -Infinity };
        session = current;
        onStatus('starting', '正在请求摄像头，请留意浏览器权限提示。');
        let stage = 'permission';
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
            });
            if (session !== current) {
                stream.getTracks().forEach(track => track.stop());
                return false;
            }
            current.stream = stream;
            stream.getVideoTracks().forEach(track => track.addEventListener('ended', () => {
                if (session === current) release('error', '摄像头已断开，请重试。');
            }, { once: true }));
            video.srcObject = stream;
            const playback = video.play().then(() => true, error => {
                if (session === current) release('error', cameraError(error, 'video'));
                return false;
            });
            stage = 'model';
            onStatus('starting', '正在加载手势模型，首次打开可能稍慢。');
            current.timeout = setTimeout(() => {
                if (session === current) release('error', '手势模型启动超时，请重试。');
            }, 45000);
            const [detector, videoReady] = await Promise.all([loadModel(), playback]);
            clearTimeout(current.timeout);
            if (session !== current || !videoReady) return false;
            current.detector = detector;
            return await new Promise(resolve => {
                current.finish = resolve;
                current.timeout = setTimeout(() => {
                    if (session === current) release('error', cameraError({}, 'video'));
                }, 8000);
                current.frame = requestAnimationFrame(time => readFrame(current, time));
            });
        } catch (error) {
            if (session === current) {
                console.warn('Camera could not start', error);
                release('error', cameraError(error, stage));
            }
            return false;
        }
    }

    return { start, stop: () => release('off', '') };
}
