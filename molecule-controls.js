const POSE_HOLD_MS = 170;
const COUNT_IDLE_MS = 7500;
const ZERO_HOLD_MS = 300;
const WISH_DELAY_MS = 870;
const OUTER_FINGERS = [9, 13, 17];
const FINGER_JOINTS = [6, 7, 10, 11, 14, 15, 18, 19];

function distance(a, b, aspect) {
    return Math.hypot((a.x - b.x) * aspect, a.y - b.y, ((a.z || 0) - (b.z || 0)) * aspect);
}

function reach(hand, base, aspect) {
    const length = distance(hand[base], hand[base + 1], aspect)
        + distance(hand[base + 1], hand[base + 2], aspect)
        + distance(hand[base + 2], hand[base + 3], aspect);
    return length ? distance(hand[base], hand[base + 3], aspect) / length : 0;
}

// A deliberate spread has the thumb to the side and the other fingers relaxed.
// For a visible pinch, the image landmarks also help when the world model misjudges fingertip depth.
export function classifyPhotoGesture(landmarks, world, aspect = 1) {
    const hand = world || landmarks;
    const scale = world ? 1 : aspect;
    const palm = distance(hand[0], hand[9], scale);
    const visiblePalm = Math.hypot((landmarks[0].x - landmarks[9].x) * aspect, landmarks[0].y - landmarks[9].y);
    if (visiblePalm < .026 || palm < .0001) return '';

    const thumb = hand[4], indexBase = hand[5], pinkyBase = hand[17];
    const span = distance(indexBase, pinkyBase, scale);
    if (span < .0001) return '';
    const thumbSide = ((indexBase.x - pinkyBase.x) * (thumb.x - indexBase.x) * scale ** 2
        + (indexBase.y - pinkyBase.y) * (thumb.y - indexBase.y)
        + ((indexBase.z || 0) - (pinkyBase.z || 0)) * ((thumb.z || 0) - (indexBase.z || 0)) * scale ** 2)
        / (palm * span);
    const spatialGap = distance(thumb, hand[8], scale) / palm;
    const visibleGap = Math.hypot((landmarks[4].x - landmarks[8].x) * aspect, landmarks[4].y - landmarks[8].y) / visiblePalm;
    const index = reach(hand, 5, scale);
    if (visibleGap >= .58 && spatialGap >= .58 && index >= .76 && thumbSide >= .08
        && OUTER_FINGERS.every(base => reach(hand, base, scale) <= .81)) return 'photo-open';
    const projectedGap = distance(landmarks[4], landmarks[8], aspect) / visiblePalm;
    const touch = visibleGap <= .36 && (spatialGap < .64 || projectedGap <= .27);
    if (touch && index >= .49 && index <= .96 && thumbSide >= -.12) return 'photo-close';
    return '';
}

export function classifyCountdownGesture(pose, landmarks, world, aspect) {
    if (pose === '3') return '3';
    const hand = world || landmarks;
    const scale = world ? 1 : aspect;
    const fingers = OUTER_FINGERS.map(base => reach(hand, base, scale));
    const okFingers = fingers.every(length => length >= .83) && fingers.filter(length => length >= .92).length >= 2;
    if (okFingers && (pose === 'pinch' || classifyPhotoGesture(landmarks, world, aspect) === 'photo-close')) return '3';
    if (pose === 'fist' && fingers.every(length => length < .79)) {
        const palm = distance(hand[0], hand[9], scale);
        const tuckedThumb = FINGER_JOINTS.some(joint => distance(hand[4], hand[joint], scale) <= palm * .62);
        if (tuckedThumb && !classifyPhotoGesture(landmarks, world, aspect)) return '0';
    }
    return pose;
}

export function createMoleculeSequence({ onPhase, onCount, onFireworks, onWish, onPhoto }) {
    let phase = 'waiting';
    let digit = null;
    let digitAt = 0;
    let wishAt = 0;
    let candidate = '';
    let candidateAt = 0;
    let accepted = '';

    function moveTo(next) {
        phase = next;
        onPhase(next);
    }

    function showDigit(value, now) {
        if (digit === value) return;
        digit = value;
        digitAt = now;
        onCount(String(digit));
        if (phase !== 'countdown') moveTo('countdown');
    }

    function reveal(now) {
        digit = null;
        candidate = accepted = '';
        onCount('');
        moveTo('fireworks');
        onFireworks(now);
        wishAt = now + WISH_DELAY_MS;
    }

    function resetHands() {
        candidate = accepted = '';
        if (phase === 'countdown' && digit !== 0) {
            digit = null;
            onCount('');
            moveTo('waiting');
        }
    }

    function tick(now) {
        if (phase === 'countdown') {
            if (digit === 0) {
                if (now - digitAt >= ZERO_HOLD_MS) reveal(now);
            } else if (now - digitAt > COUNT_IDLE_MS) {
                resetHands();
            }
        } else if (phase === 'fireworks' && now >= wishAt) {
            moveTo('photos');
            onWish();
        }
    }

    function hand(counts, photoPoses, now) {
        if (phase === 'fireworks' || digit === 0) return;
        const expected = String(digit === null ? 3 : digit - 1);
        const pose = phase === 'photos' ? (photoPoses.find(Boolean) || '')
            : counts.includes(expected) ? expected : '';
        if (pose !== candidate) {
            candidate = pose;
            candidateAt = now;
        }
        if (pose === accepted || now - candidateAt < POSE_HOLD_MS) return;
        if (!pose) {
            accepted = '';
            return;
        }
        if (phase === 'photos') {
            accepted = pose;
            onPhoto(pose === 'photo-open', now);
        } else if (digit === null || now - digitAt >= 270) {
            accepted = pose;
            showDigit(Number(pose), now);
        }
    }

    return {
        get phase() { return phase; },
        tick, hand, resetHands,
        feedback(handTotal, photoCount, photoOn) {
            if (phase === 'waiting') return handTotal ? '比三指或 OK 开始倒数。' : '请将整只手放入镜头。';
            if (phase === 'countdown') {
                if (digit === 0) return '已识别握拳，准备亮灯';
                if (digit === 1) return '已识别一指，握拳比 0';
                return digit === 3 ? '已识别 3，请比二指' : '已识别 2，请比一指';
            }
            if (phase === 'fireworks') return '烟花绽放中';
            if (!photoCount) return '添加照片后，拇指与食指张开即可显图。';
            return photoOn ? '捏拢拇指和食指，收起照片。' : '收拢其余三指，张开拇指和食指显图。';
        },
    };
}
