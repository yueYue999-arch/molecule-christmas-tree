import { createHandCamera } from './hand-camera.js';
import { createMoleculeAlbum } from './molecule-album.js';

const loader = document.getElementById('system-loader');
const setup = document.getElementById('setup-screen');
const launch = document.getElementById('init-btn');
const enter = document.getElementById('start-magic');
const toggle = document.getElementById('gesture-toggle');
const gestureStatus = document.getElementById('gesture-status');
const setupStatus = document.getElementById('setup-status');
const preview = document.getElementById('webcam-preview');
const previewToggle = document.getElementById('camera-preview-toggle');
const musicInput = document.getElementById('music-input');
const musicButton = document.getElementById('music-btn');
const inWeChat = /MicroMessenger/i.test(navigator.userAgent);
let cameraMode = 'off';
let showCameraPreview = true;
let scene;
let music;
let musicUrl;

function updateCameraPreview() {
    const isLive = cameraMode === 'live';
    const isVisible = isLive && showCameraPreview;
    preview.hidden = !isVisible;
    previewToggle.disabled = !isLive;
    previewToggle.setAttribute('aria-expanded', String(isVisible));
    previewToggle.textContent = showCameraPreview ? '隐藏摄像头画面' : '显示摄像头画面';
}

const album = createMoleculeAlbum(sources => scene?.setPhotoSources(sources));
const camera = createHandCamera({
    video: document.getElementById('webcam'),
    preview,
    maxHands: 1,
    onStatus(mode, message) {
        cameraMode = mode;
        const starting = mode === 'starting';
        launch.disabled = toggle.disabled = starting;
        launch.textContent = starting ? '正在启动…' : mode === 'error' ? '重试开启手势' : '开启手势识别';
        toggle.textContent = mode === 'live' ? '关闭手势识别' : launch.textContent;
        updateCameraPreview();
        if (mode === 'off' || mode === 'error') scene?.resetHands();
        let note = message || (mode === 'live' ? '请将整只手放入镜头。' : '手势识别未开启。');
        if (mode === 'error' && inWeChat) note += '可点微信右上角「…」，选择「在浏览器打开」。';
        document.getElementById('sys-status').textContent = note;
        gestureStatus.textContent = note;
    },
    onHands(hands, now, world, aspect) {
        if (!scene || cameraMode !== 'live') return;
        scene.hand(hands, now, world, aspect);
        const note = scene.handFeedback(hands.length);
        if (gestureStatus.textContent !== note) gestureStatus.textContent = note;
    },
});

launch.disabled = false;
document.getElementById('sys-status').textContent = '开启摄像头，用手势点亮圣诞树。';
launch.addEventListener('click', async () => {
    if (!await camera.start()) return;
    loader.hidden = true;
    setup.hidden = false;
});
toggle.addEventListener('click', () => {
    if (cameraMode === 'live') camera.stop();
    else camera.start();
});
previewToggle.addEventListener('click', () => {
    showCameraPreview = !showCameraPreview;
    updateCameraPreview();
});

musicButton.addEventListener('click', () => musicInput.click());
musicInput.addEventListener('change', () => {
    musicButton.classList.toggle('selected', Boolean(musicInput.files.length));
    musicButton.textContent = musicInput.files.length ? '已选择音乐' : '选择音乐';
});

function stopMusic() {
    music?.pause();
    if (musicUrl) URL.revokeObjectURL(musicUrl);
    music = null;
    musicUrl = null;
}

enter.addEventListener('click', async () => {
    enter.disabled = true;
    setupStatus.hidden = false;
    setupStatus.textContent = '正在加载圣诞场景…';
    const file = musicInput.files[0];
    if (file) {
        musicUrl = URL.createObjectURL(file);
        music = new Audio(musicUrl);
        music.loop = true;
        music.volume = 0.5;
        music.play().catch(stopMusic);
    }
    try {
        const { startMoleculeScene } = await import('./molecule-scene.js');
        scene = startMoleculeScene(album.sources());
        setup.hidden = true;
        document.getElementById('gesture-panel').hidden = false;
    } catch (error) {
        stopMusic();
        enter.disabled = false;
        setupStatus.textContent = '场景无法启动，请用系统浏览器打开后重试。';
        console.error(error);
    }
});

addEventListener('pagehide', () => {
    camera.stop();
    stopMusic();
});
