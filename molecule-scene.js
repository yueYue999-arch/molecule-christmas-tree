import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createMoleculeTree } from './molecule.js';
import { classifyCountdownGesture, classifyPhotoGesture, createMoleculeSequence } from './molecule-controls.js';

const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const TAU = Math.PI * 2;
const PHOTO_FADE = 460;
const MOLECULE_GATHER_SPEED = 2.9;
const MOLECULE_DISPERSE_SPEED = 3.5;
const SPARKS = ['#f6f8ff', '#c6ddff', '#c6ffe9', '#dbc4ff', '#ffc6e8', '#ffe0ac'];
const FIREWORK_PALETTES = [
    ['#ff3d73', '#ff8cc2', '#ffd18a'],
    ['#34caff', '#65ffe0', '#a8caff'],
    ['#9864ff', '#e483ff', '#ffa5e6'],
    ['#ffac3b', '#fff292', '#ff725d'],
];
const FIREWORK_COLORS = FIREWORK_PALETTES.flat();

function makeSparkSprites(colors) {
    return colors.map(color => {
        const sprite = document.createElement('canvas');
        sprite.width = sprite.height = 24;
        const ctx = sprite.getContext('2d');
        const glow = ctx.createRadialGradient(12, 12, 0, 12, 12, 12);
        glow.addColorStop(0, '#ffffff');
        glow.addColorStop(.23, color);
        glow.addColorStop(.49, color + 'aa');
        glow.addColorStop(1, color + '00');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, 24, 24);
        return sprite;
    });
}

function makeSky(scene) {
    const backdrop = document.createElement('canvas');
    backdrop.width = backdrop.height = 256;
    const ctx = backdrop.getContext('2d');
    const glow = ctx.createRadialGradient(128, 112, 10, 128, 125, 164);
    glow.addColorStop(0, '#101a3e');
    glow.addColorStop(.60, '#090d24');
    glow.addColorStop(1, '#02040d');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 256, 256);
    const texture = new THREE.CanvasTexture(backdrop);
    texture.colorSpace = THREE.SRGBColorSpace;
    scene.background = texture;
    const coords = new Float32Array(3300 * 3);
    for (let i = 0; i < coords.length; i += 3) {
        coords.set([rand(-130, 130), rand(-90, 90), rand(-64, -22)], i);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(coords, 3));
    const material = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 } },
        depthWrite: false, transparent: true,
        vertexShader: `
            uniform float uTime;
            uniform float uPixelRatio;
            varying float vAlpha;
            void main() {
                vec3 p = position;
                float seed = fract(sin(dot(position.xz, vec2(12.9898, 78.233))) * 43758.5453);
                p.y = mod(p.y + 90. - uTime * mix(1.25, 3.7, seed), 180.) - 90.;
                p.x += sin(.4 * uTime + position.y) * mix(.3, 1.9, seed);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.);
                gl_PointSize = mix(.8, 2.7, seed * seed) * uPixelRatio;
                vAlpha = mix(.24, .76, seed);
            }
        `,
        fragmentShader: `
            varying float vAlpha;
            void main() {
                float d = length(gl_PointCoord - vec2(.5));
                gl_FragColor = vec4(.92, .96, 1., vAlpha * (1. - smoothstep(.11, .5, d)));
            }
        `,
    });
    const stars = new THREE.Points(geometry, material);
    stars.frustumCulled = false;
    scene.add(stars);
    return stars;
}

function createBloom(x, y, radius, born, amount, paletteOffset) {
    const points = [];
    for (let i = 0; i < amount; i++) {
        const z = rand(-1, 1);
        const theta = rand(0, TAU);
        const projected = Math.sqrt(1 - z * z) * radius * rand(.59, 1.24);
        const tone = paletteOffset + (i % 7 === 0 ? 2 : i % 3 === 0 ? 1 : 0);
        points.push({
            dx: Math.cos(theta) * projected, dy: Math.sin(theta) * projected,
            size: rand(.80, 1.92),
            phase: rand(0, TAU), tone, trail: i % 9 === 0,
        });
    }
    return { x, y, born, points, paletteOffset };
}

export function classifyHand(landmarks) {
    const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
    const scale = distance(landmarks[0], landmarks[9]);
    if (scale < 0.0001) return 'neutral';
    const extended = [8, 12, 16, 20].map(tip =>
        distance(landmarks[tip], landmarks[0]) > distance(landmarks[tip - 2], landmarks[0]) + scale * 0.17
        && distance(landmarks[tip], landmarks[tip - 3]) > scale * 0.53
    );
    const gap = distance(landmarks[4], landmarks[8]) / scale;
    const [index, middle, ring, pinky] = extended;
    let pose = 'neutral';
    if (gap < 0.34 && (middle || ring || pinky)) pose = 'pinch';
    else if (index && middle && ring && pinky) pose = 'open';
    else if (index && middle && (ring || pinky)) pose = '3';
    else if (index && middle) pose = '2';
    else if (index) pose = '1';
    else if (!extended.some(Boolean) && distance(landmarks[8], landmarks[0]) < scale * 1.38) pose = 'fist';
    return pose;
}

export function startMoleculeScene(sources) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, .1, 1000);
    camera.position.set(0, 2, 50);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    const touchDevice = matchMedia('(pointer: coarse)').matches;
    const shortLandscape = matchMedia('(pointer: coarse) and (max-height: 500px) and (orientation: landscape)');
    const pixelRatio = Math.min(devicePixelRatio || 1, touchDevice ? 1.35 : 2);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(innerWidth, innerHeight, false);
    renderer.toneMapping = THREE.ReinhardToneMapping;
    renderer.toneMappingExposure = 1.3;

    const environment = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(environment, .04).texture;
    scene.environmentIntensity = .65;
    environment.dispose();
    pmrem.dispose();

    const group = new THREE.Group();
    scene.add(group, new THREE.AmbientLight(0xffffff, .7));
    const spotGold = new THREE.SpotLight(0xffcc66, 2000);
    spotGold.position.set(30, 40, 40);
    spotGold.angle = .5;
    spotGold.penumbra = .5;
    const spotBlue = new THREE.SpotLight(0x6688ff, 600);
    spotBlue.position.set(-30, 20, -30);
    const fill = new THREE.DirectionalLight(0xffeebb, .6);
    fill.position.set(0, 0, 50);
    scene.add(spotGold, spotBlue, fill);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), .48, .4, .45));
    document.getElementById('canvas-container').replaceChildren(renderer.domElement);

    const canvas = document.getElementById('fireworks-canvas');
    const story = document.getElementById('starlight-story');
    const count = document.getElementById('starlight-count');
    const wish = document.getElementById('starlight-wish');
    const photo = document.querySelector('#starlight-photo img');
    const albumDialog = document.getElementById('molecule-album-dialog');
    const gesturePanel = document.getElementById('gesture-panel');
    const ctx = canvas.getContext('2d');
    const sprites = makeSparkSprites([...SPARKS, ...FIREWORK_COLORS]);
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tree = createMoleculeTree(group);
    const stars = makeSky(scene);
    const openingBursts = [[-.25, .29, 0], [.24, .27, .19], [-.34, .43, .42], [.31, .47, .55],
        [-.27, .64, .84], [.29, .16, 1], [-.17, .18, 1.16], [.24, .64, 1.30]];
    const photoHalo = Array.from({ length: 144 }, (_, i) => ({
        side: i % 4, along: Math.random(), distance: Math.pow(Math.random(), 2) * 22,
        size: rand(.54, 1.32), phase: rand(0, TAU), tone: i % 3 === 0 ? 3 : i % 2,
    }));
    let width, height, ratio, compact, distance;
    let push = 0;
    let shownAt = null, photoAt = null, photoExitAt = null;
    let photos = [], photoIndex = -1, photoRevision = 0, bursts = [], photoClouds = [];
    let activePhoto, photoPoints, nextFireAt, fireSide = 1, firePalette = 0, photoExitOpacity = 1;
    const sequence = createMoleculeSequence({
        onPhase(phase) {
            document.body.dataset.moleculePhase = phase;
        },
        onCount: showCount,
        onFireworks(now) {
            shownAt = now;
            launchOpeningFireworks(now + 110);
            nextFireAt = now + 1560;
        },
        onWish() { wish.hidden = false; },
        onPhoto(open, now) {
            if (open && (!activePhoto || photoExitAt !== null)) nextPhoto();
            if (!open && activePhoto) closePhoto(now);
        },
    });

    function resize() {
        width = innerWidth;
        height = innerHeight;
        compact = width <= height;
        const landscapePhone = shortLandscape.matches;
        distance = compact ? Math.max(76, 32 * height / width) : landscapePhone ? 67 : 57;
        const dockInset = compact ? Math.max(0, parseFloat(getComputedStyle(gesturePanel).bottom) - 8) : 0;
        const viewHeight = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        const treeY = compact
            ? 1.25 - 2.15 * THREE.MathUtils.smoothstep(height, 560, 820) + dockInset * viewHeight / height
            : landscapePhone ? -2.8 : .85;
        group.position.set(compact ? 0 : .7, treeY, 0);
        ratio = pixelRatio;
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        tree.resize(ratio, height);
        photoPoints = null;
        stars.material.uniforms.uPixelRatio.value = ratio;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
        composer.setSize(width, height);
    }
    resize();

    function showCount(value) {
        count.textContent = value;
        count.hidden = !value;
        count.dataset.digit = value;
    }

    function vividBloom(x, y, radius, born, amount) {
        const paletteOffset = SPARKS.length + firePalette * FIREWORK_PALETTES[firePalette].length;
        firePalette = (firePalette + 1) % FIREWORK_PALETTES.length;
        return createBloom(width * x, height * y, Math.min(width, height) * radius, born, amount, paletteOffset);
    }

    function launchOpeningFireworks(now) {
        bursts = openingBursts.map(([offset, top, delay]) => {
            const side = compact ? offset * 1.23 : offset;
            return vividBloom(.5 + side, compact ? top * .79 : top, rand(.158, .228),
                now + delay * 850, touchDevice ? 245 : 350);
        });
    }

    function ongoingFireworks(now) {
        if (nextFireAt === undefined || now < nextFireAt) return;
        const offset = compact ? rand(.24, .36) : rand(.23, .36);
        const upper = rand(.15, compact ? .39 : .45);
        const lower = rand(compact ? .34 : .37, compact ? .58 : .65);
        bursts.push(
            vividBloom(.5 + offset * fireSide, upper, rand(.163, .233), now, touchDevice ? 190 : 275),
            vividBloom(.5 - rand(.22, .35) * fireSide, lower, rand(.123, .175),
                now + rand(145, 310), touchDevice ? 129 : 175),
        );
        fireSide *= -1;
        nextFireAt = now + rand(735, 940);
    }

    function retirePhoto(now) {
        if (!photo.hidden && photoExitAt === null) makePhotoCloud(now);
        photoRevision++;
        activePhoto = null;
        photoPoints = null;
        photo.hidden = true;
        photo.style.opacity = '';
        photoAt = null;
        photoExitAt = null;
    }

    function closePhoto(now) {
        if (photoExitAt !== null) return;
        if (photo.hidden) {
            retirePhoto(now);
            return;
        }
        photoExitAt = now;
        photoExitOpacity = Number(photo.style.opacity);
        makePhotoCloud(now);
    }

    async function nextPhoto() {
        if (!photos.length) return;
        retirePhoto(performance.now());
        const revision = photoRevision;
        photoIndex = (photoIndex + 1) % photos.length;
        activePhoto = photos[photoIndex];
        photo.src = activePhoto;
        try {
            await photo.decode();
        } catch {
            if (revision === photoRevision) {
                activePhoto = null;
            }
            return;
        }
        if (revision !== photoRevision) return;
        photo.hidden = false;
        photo.style.opacity = '0';
        photoAt = performance.now();
        makePhotoCloud(photoAt, true);
    }

    function setPhotoSources(sources) {
        const recent = photos[photoIndex];
        photos = sources;
        tree.setPhotos(sources);
        if (activePhoto && !photos.includes(activePhoto)) closePhoto(performance.now());
        const nextIndex = photos.indexOf(recent);
        photoIndex = nextIndex >= 0 ? nextIndex : Math.min(photoIndex - 1, photos.length - 1);
        photoIndex = Math.max(photoIndex, -1);
    }

    function samplePhoto() {
        const rect = photo.getBoundingClientRect();
        if (!rect.width || !rect.height) return [];
        const sample = document.createElement('canvas');
        const step = Math.max(3, Math.sqrt(rect.width * rect.height / (compact ? 1650 : 3600)));
        sample.width = Math.max(1, Math.round(rect.width / step));
        sample.height = Math.max(1, Math.round(rect.height / step));
        const sampleCtx = sample.getContext('2d');
        const cols = sample.width, rows = sample.height;
        sampleCtx.drawImage(photo, 0, 0, cols, rows);
        const pixels = sampleCtx.getImageData(0, 0, cols, rows).data;
        const points = [];
        const travel = Math.min(width, height) * .17;
        for (let i = 0; i < cols * rows; i++) {
            const offset = i * 4;
            const alpha = pixels[offset + 3] / 255;
            if (alpha < .08) continue;
            const red = pixels[offset], green = pixels[offset + 1], blue = pixels[offset + 2];
            const light = (.21 * red + .72 * green + .07 * blue) / 255;
            const u = (i % cols + rand(.13, .87)) / cols;
            const v = (Math.floor(i / cols) + rand(.13, .87)) / rows;
            const tone = light > .75 ? 0 : green > red + 28 ? 2 : red > blue + 60 ? 5 : red > blue + 20 ? 4 : 3;
            const angle = rand(0, TAU);
            const speed = travel * rand(.17, .94);
            points.push({
                x: (rect.left + u * rect.width) / width,
                y: (rect.top + v * rect.height) / height,
                dx: (Math.cos(angle) * speed + (u - .5) * travel) / width,
                dy: (Math.sin(angle) * speed + (v - .5) * travel * .45) / height,
                size: rand(.73, 1.74), phase: rand(0, TAU), tone,
                light: (.36 + .62 * light) * alpha,
                driftAt: rand(0, .46),
            });
        }
        return points;
    }

    function makePhotoCloud(now, gather = false) {
        // Reuse the same image-sampled points in both directions until the layout changes.
        const points = photoPoints ?? (photoPoints = samplePhoto());
        if (!points.length) return;
        const prior = photoClouds.filter(cloud => !cloud.gather);
        const speed = gather ? MOLECULE_GATHER_SPEED : MOLECULE_DISPERSE_SPEED;
        const expiresAt = now + (gather ? 1250 : 2150) / speed;
        photoClouds = [...prior.slice(-1), { born: now, points, gather, speed, expiresAt }];
    }

    function drawSpark(point, x, y, age, opacity, size = point.size) {
        const twinkle = .61 + .39 * Math.abs(Math.sin(age * 8 + point.phase));
        ctx.globalAlpha = Math.min(1, opacity * twinkle);
        const radius = size * 1.82;
        ctx.drawImage(sprites[point.tone], x - radius, y - radius, radius * 2, radius * 2);
    }

    function drawPhotoHalo(now) {
        if (photo.hidden || photoAt === null) return;
        const r = photo.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const age = (now - photoAt) / 1000;
        const opacity = Number(photo.style.opacity) * .82;
        for (const p of photoHalo) {
            const distance = p.distance * (.84 + .22 * Math.sin(age * 2 + p.phase));
            const x = p.side < 2 ? r.left + r.width * p.along : p.side === 2 ? r.left - distance : r.right + distance;
            const y = p.side >= 2 ? r.top + r.height * p.along : p.side === 0 ? r.top - distance : r.bottom + distance;
            drawSpark(p, x, y, age, opacity);
        }
    }

    function drawEffects(now) {
        ctx.clearRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'lighter';
        bursts = bursts.filter(b => now < b.born + 3200);
        for (const b of bursts) {
            const age = (now - b.born) / 1000;
            if (age < 0) continue;
            const expand = 1 - Math.exp(-3.15 * age);
            if (age < .34) {
                ctx.globalAlpha = (1 - age / .34) * .88;
                const radius = Math.min(width, height) * .035 * (1 - age);
                const glow = sprites[b.paletteOffset + 1];
                ctx.drawImage(glow, b.x - radius, b.y - radius, radius * 2, radius * 2);
            }
            const intensity = Math.pow(Math.max(0, 1 - age / 3.2), 1.1);
            const fall = age * age * 3.5;
            const trail = Math.max(0, expand - .05 - age * .065);
            const trailFade = Math.max(0, 1 - age / 1.8) * intensity;
            const trace = age > .10 && trailFade > .14;
            if (trace) ctx.beginPath();
            for (const p of b.points) {
                const x = b.x + p.dx * expand;
                const y = b.y + p.dy * expand + fall;
                if (p.trail && trailFade) {
                    const tailX = b.x + p.dx * trail;
                    const tailY = b.y + p.dy * trail + fall;
                    drawSpark(p, tailX, tailY, age, trailFade * .67, p.size * .76);
                    if (trace) {
                        ctx.moveTo(tailX, tailY);
                        ctx.lineTo(x, y);
                    }
                }
                drawSpark(p, x, y, age, intensity);
            }
            if (trace) {
                ctx.lineWidth = 1.15;
                ctx.lineCap = 'round';
                ctx.strokeStyle = FIREWORK_COLORS[b.paletteOffset - SPARKS.length + 1];
                ctx.globalAlpha = trailFade * .92;
                ctx.stroke();
            }
        }
        drawPhotoHalo(now);
        photoClouds = photoClouds.filter(cloud => now < cloud.expiresAt);
        for (const cloud of photoClouds) {
            const age = (now - cloud.born) * cloud.speed / 1000;
            const envelope = cloud.gather
                ? THREE.MathUtils.smoothstep(age, 0, .18) * (1 - THREE.MathUtils.smoothstep(age, .69, 1.25))
                : Math.min(1, .46 + age * 2.8) * (1 - THREE.MathUtils.smoothstep(age, .42, 2.15));
            if (!envelope) continue;
            for (const p of cloud.points) {
                const drift = cloud.gather
                    ? 1 - THREE.MathUtils.smoothstep(age, p.driftAt * .55, .76 + p.driftAt * .48)
                    : Math.pow(Math.max(0, age - p.driftAt) / 1.8, 1.26);
                drawSpark(p, (p.x + p.dx * drift) * width,
                    (p.y + p.dy * drift) * height + (cloud.gather ? 0 : age * age * 3),
                    age, envelope * p.light);
            }
        }
        ctx.globalAlpha = 1;
    }

    const clock = new THREE.Clock();

    function render() {
        requestAnimationFrame(render);
        const dt = clock.getDelta();
        const time = clock.elapsedTime;
        const now = performance.now();
        sequence.tick(now);
        ongoingFireworks(now);
        if (photoAt !== null) {
            if (photoExitAt === null) {
                photo.style.opacity = THREE.MathUtils.smoothstep((now - photoAt) * MOLECULE_GATHER_SPEED, 590, 1140);
            } else {
                const progress = (now - photoExitAt) * MOLECULE_DISPERSE_SPEED / PHOTO_FADE;
                if (progress >= 1) retirePhoto(now);
                else photo.style.opacity = photoExitOpacity * (1 - progress);
            }
        }

        const lit = shownAt !== null;
        const flare = lit && !reducedMotion ? Math.exp(-(now - shownAt) / 172) : 0;
        group.rotation.y = time * .40;
        tree.update(time, 0, lit, flare);
        stars.material.uniforms.uTime.value = time;
        push = THREE.MathUtils.damp(push, Number(lit), 2.3, dt);
        camera.position.z = distance - push * (compact ? 4 : 5);
        drawEffects(now);
        composer.render();
    }

    const greeting = document.getElementById('greeting-input');
    document.getElementById('main-title').textContent = greeting.value.trim() || greeting.defaultValue;
    const recipient = wish.querySelector('strong');
    const message = wish.querySelector('span');
    recipient.textContent = document.getElementById('recipient-input').value.trim();
    message.textContent = document.getElementById('wish-input').value.trim() || '圣诞节快乐';
    recipient.classList.toggle('long-text', recipient.textContent.length > 8);
    message.classList.toggle('long-text', message.textContent.length > 16);
    setPhotoSources(sources);
    document.body.dataset.moleculePhase = 'waiting';
    story.hidden = false;
    albumDialog.addEventListener('close', sequence.resetHands);
    addEventListener('resize', resize);
    render();

    return {
        setPhotoSources,
        resetHands: sequence.resetHands,
        hand(landmarks, now, world = [], aspect = 1) {
            if (albumDialog.open) return;
            if (sequence.phase === 'photos') {
                sequence.hand([], landmarks.map((hand, index) => classifyPhotoGesture(hand, world[index], aspect)), now);
                return;
            }
            const counts = landmarks.map((hand, index) => classifyCountdownGesture(classifyHand(hand), hand, world[index], aspect));
            sequence.hand(counts, [], now);
        },
        handFeedback(handTotal) {
            return sequence.feedback(handTotal, photos.length, activePhoto && photoExitAt === null);
        },
    };
}
