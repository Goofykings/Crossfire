"""Dual-dagger design data: dimensions, hand attachment, animation keys and timing metadata.

Pure Python (no bpy), shared by generate_daggers.py and tools. Everything is authored in
game coordinates (metres, +x right, +y up, -z forward).

Dagger model frame: origin at the handle centre (where the gripping glove wraps), blade
toward -Z, edge toward -Y, spine +Y, flats facing +/-X.

Clip frame ("aim frame"): relative to the point between the two shoulder joints, +x right,
+y up, -z along the look. A hand pose is authored hand-first, because the wrist is what
looks wrong when it is off: `k` is where the knuckles point (the hand bone's axis, roughly
continuing the forearm) and `b` a hint for where the blade should point. The dagger orientation then
follows from the grip (HOLD), exactly as a real fist would carry it.
"""
from __future__ import annotations

import math

Vec = tuple[float, float, float]

FPS = 60
# Handle slant across the palm: the fist holds the handle diagonally (like the project's
# pistol grips), which tips the blade toward the knuckles and keeps wrists straighter.
SLANT = math.radians(20.0)
# Palm centre to handle axis (palm half-thickness plus the handle's half-depth), metres.
GRIP_DEPTH = 0.029
# Hand bone axis (wrist to knuckles) and back-of-hand normal, in dagger coordinates.
HOLD = {
    "r": {"fingers": (0.0, -math.cos(SLANT), -math.sin(SLANT)), "back": (1.0, 0.0, 0.0), "depth": GRIP_DEPTH},
    "l": {"fingers": (0.0, -math.cos(SLANT), -math.sin(SLANT)), "back": (-1.0, 0.0, 0.0), "depth": GRIP_DEPTH},
}

# Finger-spin flourish: rotation about the flat normal through the thumb/index pinch point,
# so the blade turns in its own plane around the front of the fist.
SPIN_PIVOT: Vec = (0.0, 0.0, -0.034)
SPIN_AXIS: Vec = (1.0, 0.0, 0.0)
# Twirl: the left dagger rolls about its own handle axis (no part passes through the fist).
TWIRL_AXIS: Vec = (0.0, 0.0, 1.0)

# Matched pair with individual variation: the right blade is longer with a straight spine
# and a ring pommel; the left is shorter, slightly recurved, with a faceted spike pommel.
DAGGERS = {
    "r": {"blade": 0.150, "width": 0.029, "spine": 0.0048, "swedge": 0.38, "recurve": 0.0, "guard": 0.056,
          "handle": 0.100, "grip_from_guard": 0.045, "pommel": "ring", "jimping": False},
    "l": {"blade": 0.140, "width": 0.028, "spine": 0.0048, "swedge": 0.30, "recurve": 0.0035, "guard": 0.052,
          "handle": 0.100, "grip_from_guard": 0.045, "pommel": "spike", "jimping": True},
}

# First-person presentation: the same clips and arm geometry as third person, framed for a
# 90 degree horizontal FOV by placing the whole shoulder rig `shoulders` from the eye (camera
# space; higher than anatomical so the daggers sit in the lower view, clear of the crosshair).
# Moving the rig rather than the targets keeps every wrist and elbow identical to third person.
# `body` scales the torso channel (shoulder sway) for the camera-mounted rig.
FIRST_PERSON = {"shoulders": (0.0, -0.075, 0.02), "body": 0.6}

# Arm used to derive hand orientation (char_geometry bones, ArmChain's two-bone solve).
UPPER_ARM, FOREARM, SHOULDER_X = 0.285, 0.255, 0.19
WRIST_TO_PALM = 0.08
# Default ulnar deviation: the fist tips toward the little finger, so the blade leans forward.
COCK = math.radians(20.0)


def norm(v: Vec) -> Vec:
    n = math.sqrt(sum(c * c for c in v)) or 1.0
    return (v[0] / n, v[1] / n, v[2] / n)


def cross(a: Vec, b: Vec) -> Vec:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def dot(a: Vec, b: Vec) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def add(a: Vec, b: Vec, s: float = 1.0) -> Vec:
    return (a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s)


def socket_axes(knuckles: Vec, blade_hint: Vec) -> tuple[Vec, Vec, Vec]:
    """World directions of the dagger's local X, Y and Z for a hand pose.

    The hand maps HOLD fingers onto `knuckles`. With fingers = cos(s)*(-Y) + sin(s)*(-Z),
    the edge E = -Y and blade B = -Z satisfy knuckles = cos(s) E + sin(s) B, so the blade is
    always 90 - s degrees from the knuckles: the blade hint only picks the roll about them.
    N is the hint's part perpendicular to the knuckles and X = K x N completes the frame.
    """
    k = norm(knuckles)
    n = norm(add(blade_hint, k, -dot(blade_hint, k)))
    x_world = cross(k, n)
    c, s = math.cos(SLANT), math.sin(SLANT)
    edge = norm(add((k[0] * c, k[1] * c, k[2] * c), n, -s))
    blade = norm(add((k[0] * s, k[1] * s, k[2] * s), n, c))
    return x_world, (-edge[0], -edge[1], -edge[2]), (-blade[0], -blade[1], -blade[2])


def forearm(side: str, wrist: Vec, pole: Vec) -> Vec:
    """Forearm direction of ArmChain.solve for a wrist target and elbow hint (aim frame)."""
    sh = (SHOULDER_X if side == "r" else -SHOULDER_X, 0.0, 0.0)
    a, b = UPPER_ARM, FOREARM
    d = add(wrist, sh, -1.0)
    length = math.sqrt(dot(d, d))
    dist = max(abs(a - b) + 0.01, min(length, (a + b) * 0.994))
    d = norm(d)
    along = (a * a - b * b + dist * dist) / (2 * dist)
    bend = add(pole, d, -dot(pole, d))
    bend = norm(bend) if dot(bend, bend) > 1e-10 else (0.0, -1.0, 0.0)
    elbow = add(add(sh, d, along), bend, math.sqrt(max(0.0, a * a - along * along)))
    return norm(add(add(sh, d, dist), elbow, -1.0))


def hand_axes(side: str, pose: dict) -> tuple[Vec, Vec, Vec]:
    """Dagger axes for a pose: knuckles continue the solved forearm, cocked toward the little
    finger (away from the blade), rolled so the blade follows the hint. Fixed point of the
    grip -> wrist -> forearm loop (converges in a few steps)."""
    elbow = D_ELBOW[side] if pose["e"] is None else pose["e"]
    cock = COCK if pose["cock"] is None else pose["cock"]
    sh = (SHOULDER_X if side == "r" else -SHOULDER_X, 0.0, 0.0)
    k = norm(add(pose["p"], sh, -1.0))
    for _ in range(12):
        x, y, z = socket_axes(k, pose["b"])
        back = x if side == "r" else (-x[0], -x[1], -x[2])
        wrist = add(add(pose["p"], back, GRIP_DEPTH), k, -WRIST_TO_PALM)
        f = forearm(side, wrist, norm(elbow))
        n = norm(add(pose["b"], f, -dot(pose["b"], f)))
        k = norm(add((f[0] * math.cos(cock), f[1] * math.cos(cock), f[2] * math.cos(cock)), n, -math.sin(cock)))
    return socket_axes(k, pose["b"])


def quat_from_axes(x: Vec, y: Vec, z: Vec) -> tuple[float, float, float, float]:
    """(w, x, y, z) of the rotation whose columns are x, y, z."""
    m00, m01, m02 = x[0], y[0], z[0]
    m10, m11, m12 = x[1], y[1], z[1]
    m20, m21, m22 = x[2], y[2], z[2]
    tr = m00 + m11 + m22
    if tr > 0:
        s = math.sqrt(tr + 1.0) * 2
        q = (0.25 * s, (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s)
    elif m00 > m11 and m00 > m22:
        s = math.sqrt(1.0 + m00 - m11 - m22) * 2
        q = ((m21 - m12) / s, 0.25 * s, (m01 + m10) / s, (m02 + m20) / s)
    elif m11 > m22:
        s = math.sqrt(1.0 + m11 - m00 - m22) * 2
        q = ((m02 - m20) / s, (m01 + m10) / s, 0.25 * s, (m12 + m21) / s)
    else:
        s = math.sqrt(1.0 + m22 - m00 - m11) * 2
        q = ((m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, 0.25 * s)
    n = math.sqrt(sum(c * c for c in q))
    return (q[0] / n, q[1] / n, q[2] / n, q[3] / n)


def P(p: Vec, b: Vec, e: Vec | None = None, cock: float | None = None) -> dict:
    """Hand pose: handle centre `p`, blade direction hint `b`, elbow hint `e` and wrist cock
    (ulnar deviation, radians). The knuckle direction is not authored: hand_axes() derives
    it from the arm the IK actually produces, so the wrist stays natural by construction."""
    return {"p": p, "b": b, "e": e, "cock": cock}


# Elbow hints relative to each shoulder joint (aim frame): down and out.
ELBOW_R: Vec = (0.8, -0.6, 0.1)
ELBOW_L: Vec = (-0.8, -0.6, 0.1)
D_ELBOW = {"r": ELBOW_R, "l": ELBOW_L}

# Guard stance: blades up and a little forward, left hand staggered ahead and higher.
IDLE_R = P((0.175, -0.065, -0.365), (-0.12, 0.85, -0.5), ELBOW_R)
IDLE_L = P((-0.155, -0.035, -0.405), (0.12, 0.85, -0.5), ELBOW_L)

# Below the view and at the belt: where the daggers are drawn and put away.
DRAW_R = P((0.19, -0.40, -0.2), (0.08, 0.45, -0.9), (0.85, -0.45, 0.25))
DRAW_L = P((-0.18, -0.39, -0.19), (-0.08, 0.45, -0.9), (-0.85, -0.45, 0.25))


def breath(pose: dict, dy: float, droll: float) -> dict:
    p, b = pose["p"], pose["b"]
    return P((p[0], p[1] + dy, p[2]), (b[0] + droll, b[1], b[2]), pose["e"], pose["cock"])


def mirror(pose: dict, shift: Vec = (0.0, 0.0, 0.0)) -> dict:
    """Left-hand version of a right-hand pose (x flipped), optionally moved."""
    f = lambda v: None if v is None else (-v[0], v[1], v[2])
    return P(add(f(pose["p"]), shift), f(pose["b"]), f(pose["e"]), pose["cock"])


# Clip keys. Each channel is a list of (seconds, value). Hand channels hold poses; `spin_*`
# and `twirl_*` hold degrees about SPIN_AXIS/TWIRL_AXIS; `scale_*` the dagger reveal scale;
# `body` holds (yaw left, pitch up, roll right) radians of the torso.
CROSS_R = [  # wide wind-up, fast sweep across with the edge leading, crossed follow-through
    P((0.3, 0.09, -0.3), (0.55, 0.55, 0.6), (0.85, -0.25, 0.45)),
    P((0.12, 0.02, -0.47), (-0.2, 0.6, -0.78), (0.75, -0.35, 0.2)),
    P((-0.1, -0.09, -0.41), (-0.3, 0.45, -0.84), (0.85, -0.5, -0.1)),
    P((-0.13, -0.15, -0.36), (-0.4, 0.15, -0.9), (0.8, -0.6, -0.05)),
    P((0.03, -0.13, -0.37), (-0.2, 0.75, -0.62), (0.7, -0.65, 0.0)),
    P((0.165, -0.075, -0.37), (-0.12, 0.85, -0.5), ELBOW_R),
]
# The left arm trails the right by 10-20 ms and stays above and in front of it while crossing
# and uncrossing (forearms ~3.5 cm in radius need ~7 cm between them), so it is staggered.
CROSS_L = [mirror(p, (0.0, 0.11, -0.08)) for p in CROSS_R[:4]] + [mirror(CROSS_R[4], (0.0, 0.14, -0.07))] + [mirror(CROSS_R[5], (0.015, 0.03, -0.035))]

CLIPS: dict[str, dict] = {
    "equip": {
        "duration": 0.5, "loop": False, "blendIn": 0.0,
        "events": {"gunDown": [0.0, 0.15], "gunHidden": 0.15, "hands": [0.0, 0.17], "reveal": [0.15, 0.22],
                   "flourish": [0.19, 0.44]},
        "hand_r": [(0.0, DRAW_R), (0.15, P((0.2, -0.36, -0.23), (0.0, 0.65, -0.75), ELBOW_R)),
                   (0.27, P((0.205, -0.15, -0.34), (-0.08, 0.8, -0.6), ELBOW_R)),
                   (0.36, P((0.18, -0.045, -0.375), (-0.13, 0.86, -0.48), ELBOW_R)),
                   (0.43, P((0.176, -0.07, -0.363), (-0.12, 0.85, -0.5), ELBOW_R)),
                   (0.5, IDLE_R)],
        "hand_l": [(0.0, DRAW_L), (0.15, P((-0.19, -0.35, -0.22), (0.0, 0.65, -0.75), ELBOW_L)),
                   (0.3, P((-0.17, -0.12, -0.38), (0.1, 0.8, -0.6), ELBOW_L)),
                   (0.39, P((-0.152, -0.02, -0.41), (0.12, 0.86, -0.48), ELBOW_L)),
                   (0.5, IDLE_L)],
        "spin_r": [(0.0, 0.0), (0.19, 0.0), (0.41, 360.0), (0.5, 360.0)],
        "twirl_l": [(0.0, 0.0), (0.23, 0.0), (0.44, -360.0), (0.5, -360.0)],
        "scale_r": [(0.0, 0.0), (0.15, 0.0), (0.2, 1.08), (0.23, 1.0), (0.5, 1.0)],
        "scale_l": [(0.0, 0.0), (0.16, 0.0), (0.21, 1.08), (0.24, 1.0), (0.5, 1.0)],
        "body": [(0.0, (0.0, -0.03, 0.0)), (0.2, (0.0, -0.05, 0.0)), (0.38, (0.0, 0.01, 0.0)), (0.5, (0.0, 0.0, 0.0))],
    },
    "idle": {
        "duration": 2.4, "loop": True, "blendIn": 0.15, "events": {},
        "hand_r": [(0.0, IDLE_R), (0.6, breath(IDLE_R, 0.006, 0.02)), (1.2, IDLE_R),
                   (1.8, breath(IDLE_R, -0.004, -0.015)), (2.4, IDLE_R)],
        "hand_l": [(0.0, IDLE_L), (0.6, breath(IDLE_L, -0.004, -0.015)), (1.2, IDLE_L),
                   (1.8, breath(IDLE_L, 0.006, 0.02)), (2.4, IDLE_L)],
        "body": [(0.0, (0.0, 0.0, 0.0)), (0.6, (0.004, 0.006, 0.0)), (1.2, (0.0, 0.0, 0.0)),
                 (1.8, (-0.004, -0.004, 0.0)), (2.4, (0.0, 0.0, 0.0))],
    },
    "attack_cross": {
        "duration": 0.62, "loop": False, "blendIn": 0.15,
        "events": {"anticipation": [0.0, 0.1], "contact": [0.13, 0.22], "chainFrom": 0.3, "recovery": 0.38,
                   "trail": [0.1, 0.3]},
        "hand_r": [(0.0, IDLE_R)] + list(zip((0.09, 0.135, 0.19, 0.28, 0.38, 0.5), CROSS_R)) + [(0.62, IDLE_R)],
        "hand_l": [(0.0, IDLE_L)] + list(zip((0.1, 0.155, 0.21, 0.3, 0.4, 0.52), CROSS_L)) + [(0.62, IDLE_L)],
        "body": [(0.0, (0.0, 0.0, 0.0)), (0.09, (0.0, 0.05, 0.0)), (0.2, (0.0, -0.09, 0.0)),
                 (0.3, (0.0, -0.1, 0.0)), (0.45, (0.0, -0.02, 0.0)), (0.62, (0.0, 0.0, 0.0))],
    },
    "attack_forward": {
        "duration": 0.52, "loop": False, "blendIn": 0.15,
        "events": {"anticipation": [0.0, 0.09], "contact": [0.14, 0.23], "chainFrom": 0.29, "recovery": 0.33,
                   "trail": [0.09, 0.24]},
        "hand_r": [(0.0, IDLE_R),
                   (0.09, P((0.18, -0.1, -0.2), (0.0, 0.6, -0.8), (0.85, -0.5, 0.25))),
                   (0.165, P((0.07, -0.04, -0.555), (-0.05, 0.3, -0.95), (0.8, -0.55, 0.0))),
                   (0.225, P((0.065, -0.045, -0.565), (-0.05, 0.28, -0.96), (0.8, -0.55, 0.0))),
                   (0.33, P((0.15, -0.08, -0.41), (-0.1, 0.75, -0.65), ELBOW_R)),
                   (0.52, IDLE_R)],
        "hand_l": [(0.0, IDLE_L),
                   (0.09, P((-0.12, 0.0, -0.43), (0.2, 0.9, -0.35), (-0.8, -0.55, 0.1))),
                   (0.16, P((-0.16, -0.05, -0.31), (0.15, 0.85, -0.45), (-0.85, -0.5, 0.25))),
                   (0.3, P((-0.16, -0.04, -0.37), (0.12, 0.85, -0.5), ELBOW_L)),
                   (0.52, IDLE_L)],
        "body": [(0.0, (0.0, 0.0, 0.0)), (0.09, (-0.12, 0.0, 0.02)), (0.16, (0.13, -0.05, -0.02)),
                 (0.25, (0.1, -0.04, -0.01)), (0.4, (0.01, 0.0, 0.0)), (0.52, (0.0, 0.0, 0.0))],
    },
    "attack_finisher": {
        "duration": 0.82, "loop": False, "blendIn": 0.15,
        "events": {"anticipation": [0.0, 0.36], "flourish": [0.04, 0.28], "contact": [0.4, 0.5], "chainFrom": 0.6,
                   "recovery": 0.62, "trail": [0.36, 0.56]},
        # Left: rises while the finger spin plays, cocks over the shoulder, then a diagonal
        # downward sweep to the lower right. Right: tucked guard that pulls back to the hip.
        "hand_l": [(0.0, IDLE_L),
                   (0.14, P((-0.19, 0.07, -0.4), (0.2, 0.85, -0.2), (-0.85, -0.45, 0.2))),
                   (0.27, P((-0.2, 0.13, -0.38), (0.35, 0.3, 0.85), (-0.9, -0.1, 0.4))),
                   (0.35, P((-0.21, 0.17, -0.31), (0.45, -0.2, 0.85), (-0.85, 0.0, 0.5))),
                   (0.41, P((-0.07, 0.07, -0.49), (0.35, 0.6, -0.7), (-0.85, -0.35, 0.3))),
                   (0.47, P((0.09, -0.11, -0.44), (0.4, 0.45, -0.78), (-0.6, -0.7, 0.1))),
                   (0.55, P((0.15, -0.15, -0.36), (0.3, 0.2, -0.93), (-0.5, -0.8, 0.0))),
                   (0.66, P((-0.02, -0.1, -0.39), (0.2, 0.75, -0.6), (-0.75, -0.6, 0.1))),
                   (0.82, IDLE_L)],
        "hand_r": [(0.0, IDLE_R),
                   (0.2, P((0.12, -0.12, -0.35), (-0.15, 0.85, -0.5), ELBOW_R)),
                   (0.36, P((0.13, -0.1, -0.37), (-0.15, 0.86, -0.48), ELBOW_R)),
                   (0.46, P((0.21, -0.17, -0.27), (-0.05, 0.75, -0.65), (0.85, -0.5, 0.25))),
                   (0.6, P((0.2, -0.13, -0.31), (-0.08, 0.8, -0.6), ELBOW_R)),
                   (0.82, IDLE_R)],
        "spin_l": [(0.0, 0.0), (0.04, 0.0), (0.28, 360.0), (0.82, 360.0)],
        "body": [(0.0, (0.0, 0.0, 0.0)), (0.2, (0.04, 0.03, 0.0)), (0.35, (0.1, 0.06, -0.03)),
                 (0.45, (-0.06, -0.08, 0.04)), (0.55, (-0.13, -0.12, 0.05)), (0.68, (-0.04, -0.04, 0.01)),
                 (0.82, (0.0, 0.0, 0.0))],
    },
    "unequip": {
        "duration": 0.4, "loop": False, "blendIn": 0.1,
        "events": {"flourish": [0.03, 0.2], "hidden": 0.22, "gunUp": [0.22, 0.4], "hands": [0.22, 0.4]},
        "hand_r": [(0.0, IDLE_R),
                   (0.1, P((0.2, -0.17, -0.33), (-0.05, 0.6, -0.8), ELBOW_R)),
                   (0.24, DRAW_R), (0.4, DRAW_R)],
        "hand_l": [(0.0, IDLE_L),
                   (0.12, P((-0.19, -0.16, -0.34), (0.05, 0.6, -0.8), ELBOW_L)),
                   (0.25, DRAW_L), (0.4, DRAW_L)],
        "spin_r": [(0.0, 0.0), (0.03, 0.0), (0.19, -180.0), (0.4, -180.0)],
        "spin_l": [(0.0, 0.0), (0.05, 0.0), (0.21, -180.0), (0.4, -180.0)],
        "scale_r": [(0.0, 1.0), (0.17, 1.0), (0.22, 0.0), (0.4, 0.0)],
        "scale_l": [(0.0, 1.0), (0.18, 1.0), (0.23, 0.0), (0.4, 0.0)],
        "body": [(0.0, (0.0, 0.0, 0.0)), (0.12, (0.0, 0.03, 0.0)), (0.3, (0.0, -0.02, 0.0)), (0.4, (0.0, 0.0, 0.0))],
    },
}

# Combo order: each attack chains into the next and the finisher loops back to the cross.
COMBO = ["attack_cross", "attack_forward", "attack_finisher"]
CHANNELS = ("hand_r", "hand_l", "spin_r", "spin_l", "twirl_r", "twirl_l", "scale_r", "scale_l", "body")


def channel(clip: dict, name: str) -> list:
    """Channel keys, with the neutral constant for channels a clip does not animate."""
    if name in clip:
        return clip[name]
    end = clip["duration"]
    if name.startswith("hand_"):
        raise KeyError(name)
    if name.startswith("scale_"):
        return [(0.0, 1.0), (end, 1.0)]
    if name == "body":
        return [(0.0, (0.0, 0.0, 0.0)), (end, (0.0, 0.0, 0.0))]
    return [(0.0, 0.0), (end, 0.0)]


def metadata() -> dict:
    """Timing and attachment metadata shared with the runtime (written to daggers.json)."""
    clips = {}
    for name, clip in CLIPS.items():
        entry = {"name": name, "duration": clip["duration"], "loop": clip["loop"], "blendIn": clip["blendIn"],
                 **clip["events"]}
        if name in COMBO:
            entry["next"] = COMBO[(COMBO.index(name) + 1) % len(COMBO)]
            entry["stage"] = COMBO.index(name) + 1
        clips[name] = entry
    return {
        "version": 1,
        "fps": FPS,
        "frame": "aim: metres from the shoulder-joint midpoint, +x right, +y up, -z look; rotations follow",
        "hold": {side: {k: list(v) if isinstance(v, tuple) else v for k, v in h.items()} for side, h in HOLD.items()},
        "spin": {"pivot": list(SPIN_PIVOT), "axis": list(SPIN_AXIS), "twirlAxis": list(TWIRL_AXIS)},
        "firstPerson": {k: list(v) if isinstance(v, tuple) else v for k, v in FIRST_PERSON.items()},
        "combo": COMBO,
        "clips": clips,
    }


def validate() -> list[str]:
    """Static checks: continuity between clips, loop seams, event order and key timing."""
    errors = []
    for name, clip in CLIPS.items():
        d = clip["duration"]
        for ch in CHANNELS:
            keys = channel(clip, ch) if ch.startswith("hand_") or ch in clip else []
            times = [t for t, _ in keys]
            if keys and (times[0] != 0.0 or abs(times[-1] - d) > 1e-9 or times != sorted(times)):
                errors.append(f"{name}.{ch}: keys must start at 0, end at {d} and increase")
        ev = clip["events"]
        if "contact" in ev and not (0 < ev["contact"][0] < ev["contact"][1] < ev.get("chainFrom", d) <= d):
            errors.append(f"{name}: contact/chainFrom out of order")
        if clip["loop"] and (clip["hand_r"][0][1] != clip["hand_r"][-1][1] or clip["hand_l"][0][1] != clip["hand_l"][-1][1]):
            errors.append(f"{name}: loop seam")
    # Every attack starts and ends in the guard, so a chain or a return never snaps.
    for name in COMBO + ["unequip"]:
        if CLIPS[name]["hand_r"][0][1] != IDLE_R or CLIPS[name]["hand_l"][0][1] != IDLE_L:
            errors.append(f"{name}: must start in the guard pose")
    for name in COMBO + ["equip"]:
        if CLIPS[name]["hand_r"][-1][1] != IDLE_R or CLIPS[name]["hand_l"][-1][1] != IDLE_L:
            errors.append(f"{name}: must end in the guard pose")
    return errors


if __name__ == "__main__":
    import json

    problems = validate()
    print(json.dumps({"errors": problems, "clips": {n: c["duration"] for n, c in CLIPS.items()}}, indent=1))
    for side, pose in (("r", IDLE_R), ("l", IDLE_L)):
        x, y, z = hand_axes(side, pose)
        print(side, "idle blade", [round(-c, 2) for c in z], "edge", [round(-c, 2) for c in y], "flat", [round(c, 2) for c in x])
    raise SystemExit(1 if problems else 0)
