import * as THREE from 'three';

// Adapted for this local preview from moleculemmeng020425/christmas-tree,
// src/App.tsx at 78cc4e7181a2ef5f5a9e8d646fd980d87636f74e.
// The upstream README declares MIT. See MOLECULE-SOURCE.md.
const height = 22;
const radius = 9;
const foliageCount = 15000;
const TAU = Math.PI * 2;
const ornamentColors = ['#D32F2F', '#FFD700', '#1976D2', '#2E7D32'];
const lampColors = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00'];
const random = (min, max) => min + Math.random() * (max - min);
const pick = values => values[Math.floor(Math.random() * values.length)];

function treePosition(edge = 0) {
    const y = random(-height / 2, height / 2);
    const section = radius * (1 - (y + height / 2) / height);
    const spread = edge === 0 ? Math.random() * section : edge === 1 ? section * .95 : section + .3;
    const theta = random(0, TAU);
    return new THREE.Vector3(Math.cos(theta) * spread, y, Math.sin(theta) * spread);
}

function createFoliage(root) {
    const positions = new Float32Array(foliageCount * 3);
    const targets = new Float32Array(positions.length);
    const randoms = new Float32Array(foliageCount);
    for (let i = 0; i < foliageCount; i++) {
        const z = random(-1, 1);
        const theta = random(0, TAU);
        const extent = 25 * Math.cbrt(Math.random());
        const across = Math.sqrt(1 - z * z);
        positions.set([extent * across * Math.cos(theta), extent * z, extent * across * Math.sin(theta)], i * 3);
        treePosition().toArray(targets, i * 3);
        randoms[i] = Math.random();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aTargetPos', new THREE.BufferAttribute(targets, 3));
    geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 }, uProgress: { value: 1 }, uPixelRatio: { value: 1 },
            uBrightness: { value: .57 },
            uColor: { value: new THREE.Color('#004225') },
        },
        vertexShader: `
            uniform float uTime, uProgress, uPixelRatio;
            attribute vec3 aTargetPos;
            attribute float aRandom;
            varying float vMix;
            float cubicInOut(float t) {
                return t < .5 ? 4. * t * t * t : .5 * pow(2. * t - 2., 3.) + 1.;
            }
            void main() {
                vec3 noise = vec3(sin(uTime * 1.5 + position.x), cos(uTime + position.y),
                    sin(uTime * 1.5 + position.z)) * .15;
                vMix = cubicInOut(uProgress);
                vec3 point = mix(position, aTargetPos + noise, vMix);
                vec4 view = modelViewMatrix * vec4(point, 1.);
                gl_PointSize = uPixelRatio * 60. * (1. + aRandom) / max(.1, -view.z);
                gl_Position = projectionMatrix * view;
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uBrightness;
            varying float vMix;
            void main() {
                if (distance(gl_PointCoord, vec2(.5)) > .5) discard;
                gl_FragColor = vec4(mix(uColor * .3, uColor * 1.2, vMix) * uBrightness, 1.);
            }
        `,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geometry, material);
    points.name = 'Molecule · 15000 foliage particles';
    points.frustumCulled = false;
    root.add(points);
    return material.uniforms;
}

function createDecorations(root) {
    const decorations = [[], [], []];
    for (let i = 0; i < 200; i++) {
        const type = Math.floor(Math.random() * decorations.length);
        decorations[type].push({
            color: new THREE.Color(type === 2 ? pick(['#D32F2F', '#FFFFFF']) : pick(ornamentColors)),
            scale: random(type === 0 ? .8 : type === 1 ? .6 : .7, type === 0 ? 1.2 : 1),
            rest: treePosition(1),
            scatter: new THREE.Vector3(random(-30, 30), random(-30, 30), random(-30, 30)),
            rotation: new THREE.Euler(random(0, Math.PI), random(0, Math.PI), random(0, Math.PI)),
            speed: new THREE.Vector3(random(-1, 1), random(-1, 1), random(-1, 1)),
        });
    }
    const geometries = [new THREE.BoxGeometry(.8, .8, .8), new THREE.SphereGeometry(.5, 16, 16),
        new THREE.CylinderGeometry(.15, .15, 1.2, 8)];
    const ornamentMaterial = new THREE.MeshStandardMaterial({
        roughness: .3, metalness: .4, emissive: 0x222222, emissiveIntensity: .2,
    });
    const lamps = Array.from({ length: 400 }, () => ({
        rest: treePosition(2),
        scatter: new THREE.Vector3(random(-30, 30), random(-30, 30), random(-30, 30)),
        color: new THREE.Color(pick(lampColors)), speed: random(2, 5),
        offset: random(0, 100),
    }));
    function instances(geometry, material, data) {
        const mesh = new THREE.InstancedMesh(geometry, material, data.length);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        data.forEach((item, i) => mesh.setColorAt(i, item.color));
        root.add(mesh);
        return mesh;
    }
    const ornamentMeshes = decorations.map((data, i) => instances(geometries[i], ornamentMaterial, data));
    const lampMaterial = new THREE.MeshBasicMaterial({
        toneMapped: false, transparent: true, opacity: 0, depthWrite: false,
    });
    const lampsMesh = instances(new THREE.SphereGeometry(.8, 8, 8), lampMaterial, lamps);
    lampsMesh.name = 'Molecule · tree lights';
    lampsMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    const proxy = new THREE.Object3D();
    const color = new THREE.Color();
    return (time, blend, lit, flare) => {
        ornamentMaterial.emissiveIntensity = lit ? .2 + .7 * flare : .025;
        for (let type = 0; type < decorations.length; type++) {
            const mesh = ornamentMeshes[type];
            decorations[type].forEach((item, i) => {
                proxy.position.lerpVectors(item.rest, item.scatter, blend);
                proxy.scale.setScalar(item.scale);
                proxy.rotation.set(item.rotation.x + time * item.speed.x,
                    item.rotation.y + time * item.speed.y, item.rotation.z + time * item.speed.z);
                proxy.updateMatrix();
                mesh.setMatrixAt(i, proxy.matrix);
            });
            mesh.instanceMatrix.needsUpdate = true;
        }
        // Keep the material and instance buffers ready during the countdown.
        lampMaterial.opacity = lit ? 1 : 0;
        proxy.rotation.set(0, 0, 0);
        proxy.scale.setScalar(.15);
        lamps.forEach((lamp, i) => {
            proxy.position.lerpVectors(lamp.rest, lamp.scatter, blend);
            proxy.updateMatrix();
            lampsMesh.setMatrixAt(i, proxy.matrix);
            const pulse = (Math.sin(time * lamp.speed + lamp.offset) + 1) / 2;
            const power = (1 + (1 - blend) * (2.4 + pulse * 2.5)) * (1 + 1.65 * flare);
            lampsMesh.setColorAt(i, color.copy(lamp.color).multiplyScalar(power));
        });
        lampsMesh.instanceMatrix.needsUpdate = true;
        lampsMesh.instanceColor.needsUpdate = true;
    };
}

function createTrunk(root) {
    const surface = document.createElement('canvas');
    surface.width = 144;
    surface.height = 192;
    const ctx = surface.getContext('2d');
    ctx.fillStyle = '#7b4128';
    ctx.fillRect(0, 0, surface.width, surface.height);
    for (let i = 0; i < 72; i++) {
        const x = random(0, surface.width), bend = random(-4, 4);
        ctx.strokeStyle = pick(['#eca46365', '#b570426d', '#481b15bd', '#361a146c']);
        ctx.lineWidth = random(.7, 3.4);
        ctx.beginPath();
        ctx.moveTo(x, -6);
        ctx.bezierCurveTo(x + bend, 52, x - bend, 133, x + bend, 198);
        ctx.stroke();
    }
    const branchShadow = ctx.createLinearGradient(0, 0, 0, surface.height * .40);
    branchShadow.addColorStop(0, '#1a0b05a8');
    branchShadow.addColorStop(1, '#1a0b0500');
    ctx.fillStyle = branchShadow;
    ctx.fillRect(0, 0, surface.width, surface.height);
    const bark = new THREE.CanvasTexture(surface);
    bark.colorSpace = THREE.SRGBColorSpace;
    const profile = [[0, 0], [1.22, 0], [1.31, .22], [1.13, .65], [.99, 1.4],
        [.89, 2.8], [.86, 4.9], [0, 4.9]].map(([r, y]) => new THREE.Vector2(r, y));
    const trunk = new THREE.Mesh(new THREE.LatheGeometry(profile, 14), new THREE.MeshStandardMaterial({
        map: bark, roughness: .94, emissive: '#8c3d20', emissiveIntensity: .06,
    }));
    trunk.name = 'Molecule · wooden trunk';
    trunk.position.y = -height / 2 - 4.2;
    root.add(trunk);
    return trunk;
}

function createStar(root) {
    const shape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
        const length = i % 2 ? .7 : 1.3;
        const angle = i * TAU / 10 + Math.PI / 2;
        const x = length * Math.cos(angle), y = length * Math.sin(angle);
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
    }
    shape.closePath();
    const star = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, {
        depth: .4, bevelEnabled: true, bevelThickness: .1, bevelSize: .1, bevelSegments: 3,
    }), new THREE.MeshStandardMaterial({
        color: '#ffdc96', emissive: '#ffdba9', emissiveIntensity: 1.2, roughness: .2, metalness: 1,
    }));
    star.position.set(0, height / 2 + 1.8, 0);
    root.add(star);
    return star;
}

function createPhotoOrnaments(root) {
    const cards = new Map();
    const loader = new THREE.ImageLoader();
    const face = new THREE.PlaneGeometry(1, 1);
    const border = new THREE.BoxGeometry(1.2, 1.45, .045);
    const frame = new THREE.MeshStandardMaterial({ color: '#fffaf0', roughness: .82 });
    return {
        setPhotos(sources) {
            const visible = sources.slice(0, 32);
            for (const [source, entry] of cards) {
                if (visible.includes(source)) continue;
                cards.delete(source);
                if (!entry.card) continue;
                root.remove(entry.card);
                entry.image.dispose();
                entry.texture.dispose();
            }
            visible.forEach((source, index) => {
                const theta = index * 2.4 + .42;
                const y = -7 + (index * 5.3) % 14;
                const r = radius * (1 - (y + height / 2) / height) + .56;
                const rest = new THREE.Vector3(r * Math.sin(theta), y, r * Math.cos(theta));
                const existing = cards.get(source);
                if (existing) {
                    existing.rest = rest;
                    existing.theta = theta;
                    return;
                }
                const entry = { rest, theta, scatter: new THREE.Vector3(random(-26, 26), random(-25, 25), random(-30, 25)) };
                cards.set(source, entry);
                loader.load(source, photo => {
                    if (cards.get(source) !== entry) return;
                    const thumbnail = document.createElement('canvas');
                    const scale = Math.min(1, 192 / Math.max(photo.width, photo.height));
                    thumbnail.width = Math.max(1, Math.round(photo.width * scale));
                    thumbnail.height = Math.max(1, Math.round(photo.height * scale));
                    thumbnail.getContext('2d').drawImage(photo, 0, 0, thumbnail.width, thumbnail.height);
                    const texture = new THREE.CanvasTexture(thumbnail);
                    texture.colorSpace = THREE.SRGBColorSpace;
                    const image = new THREE.MeshBasicMaterial({ map: texture });
                    const card = new THREE.Group();
                    card.add(new THREE.Mesh(border, frame));
                    const front = new THREE.Mesh(face, image);
                    const back = new THREE.Mesh(face, image);
                    front.position.set(0, .09, .028);
                    back.position.set(0, .09, -.028);
                    back.rotation.y = Math.PI;
                    card.add(front, back);
                    const aspect = photo.width / photo.height;
                    front.scale.set(Math.min(1, aspect), Math.min(1, 1 / aspect), 1);
                    back.scale.copy(front.scale);
                    Object.assign(entry, { card, image, texture });
                    root.add(card);
                }, undefined, () => {
                    if (cards.get(source) === entry) cards.delete(source);
                });
            });
        },
        update(time, blend) {
            cards.forEach(({ card, rest, scatter, theta }) => {
                if (!card) return;
                card.position.lerpVectors(rest, scatter, blend);
                card.rotation.set(.07 * Math.sin(time + theta) + blend * time * .23,
                    theta + blend * time * .36, .08 * Math.cos(time + theta));
            });
        },
    };
}

export function createMoleculeTree(group) {
    const root = new THREE.Group();
    root.name = 'Molecule tree';
    root.scale.setScalar(1.13);
    root.position.y = -.4;
    group.add(root);
    const needles = createFoliage(root);
    const trunk = createTrunk(root);
    const decorate = createDecorations(root);
    const star = createStar(root);
    const photos = createPhotoOrnaments(root);
    return {
        resize(ratio) { needles.uPixelRatio.value = ratio; },
        setPhotos: photos.setPhotos,
        update(time, blend, lit, flare) {
            needles.uTime.value = time;
            needles.uProgress.value = 1 - blend;
            needles.uBrightness.value = lit ? 1.13 + 1.48 * flare : .57;
            decorate(time, blend, lit, flare);
            photos.update(time, blend);
            trunk.material.emissiveIntensity = lit ? .27 + .41 * flare : .06;
            star.material.emissiveIntensity = lit ? 1.2 + 2.9 * flare : .07;
            star.visible = blend < .98;
            star.scale.setScalar(1 - blend);
            star.rotation.y = -group.rotation.y + Math.sin(time * .65) * .22;
            star.position.y = height / 2 + 1.8 + Math.sin(time * 2) * .12;
        },
    };
}
