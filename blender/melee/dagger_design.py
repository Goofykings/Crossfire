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

# Fast strikes last only 2-3 frames at 60 Hz, so the GLB is sampled at 120 Hz.
FPS = 120
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


def arm_joints(side: str, wrist: Vec, pole: Vec) -> tuple[Vec, Vec]:
    """Elbow and (reach-clamped) wrist of ArmChain.solve for a wrist target and elbow hint."""
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
    return elbow, add(sh, d, dist)


def forearm(side: str, wrist: Vec, pole: Vec) -> Vec:
    """Forearm direction of ArmChain.solve for a wrist target and elbow hint (aim frame)."""
    elbow, end = arm_joints(side, wrist, pole)
    return norm(add(end, elbow, -1.0))


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


def pose_arm(side: str, pose: dict) -> tuple[Vec, Vec]:
    """Elbow and wrist the runtime IK reaches for a hand pose (aim frame)."""
    pole = norm(D_ELBOW[side] if pose["e"] is None else pose["e"])
    cock = COCK if pose["cock"] is None else pose["cock"]
    sh = (SHOULDER_X if side == "r" else -SHOULDER_X, 0.0, 0.0)
    k = norm(add(pose["p"], sh, -1.0))
    wrist = pose["p"]
    for _ in range(12):  # same fixed point as hand_axes: the knuckle direction follows the arm
        xs, _, _ = socket_axes(k, pose["b"])
        bk = xs if side == "r" else (-xs[0], -xs[1], -xs[2])
        wrist = add(add(pose["p"], bk, GRIP_DEPTH), k, -WRIST_TO_PALM)
        f = forearm(side, wrist, pole)
        n = norm(add(pose["b"], f, -dot(pose["b"], f)))
        k = norm(add((f[0] * math.cos(cock), f[1] * math.cos(cock), f[2] * math.cos(cock)), n, -math.sin(cock)))
    return arm_joints(side, wrist, pole)


def segment_gap(a0: Vec, a1: Vec, b0: Vec, b1: Vec) -> float:
    """Closest distance between two segments (sampled; the arms are short)."""
    best = 1e9
    for i in range(21):
        pa = add(a0, add(a1, a0, -1.0), i / 20)
        for j in range(21):
            pb = add(b0, add(b1, b0, -1.0), j / 20)
            d = add(pa, pb, -1.0)
            best = min(best, math.sqrt(dot(d, d)))
    return best


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
#
# Stage 1 (attack_cross) and stage 2 (attack_forward) keep their ids because gameplay and the
# network refer to them: they are now the right and left diagonal slashes. Stage 3
# (attack_finisher) is the crossover. Attacks 1 and 2 begin in their own wind-up, not in the
# guard: the crossfade into them starts from wherever the arms are (the guard, or the previous
# attack's follow-through), so a chain never detours through the guard.

# Attack 1: the right hand starts high on the right edge of the view, pulls back, then cuts
# across almost the whole view to the lower left in about 30 ms and follows through. The torso
# turns into the cut (yaw left), which carries the whole arm rig further across the screen than
# the arm alone can reach. The left hand ducks low and back, clear of the sweeping blade.
SLASH_R = [
    (0.000, P((0.255, 0.115, -0.34), (0.55, 0.40, 0.30), (0.85, -0.25, 0.40))),
    (0.040, P((0.262, 0.125, -0.325), (0.62, 0.35, 0.35), (0.90, -0.20, 0.45))),
    (0.072, P((0.04, 0.045, -0.43), (-0.30, 0.62, -0.74), (0.80, -0.30, 0.20))),
    (0.104, P((-0.20, -0.04, -0.385), (-0.60, 0.30, -0.74), (0.85, -0.45, -0.10))),
    (0.140, P((-0.235, -0.06, -0.36), (-0.68, 0.10, -0.72), (0.80, -0.60, -0.05))),
    (0.190, P((-0.05, -0.105, -0.37), (-0.30, 0.65, -0.70), (0.70, -0.65, 0.00))),
    (0.250, IDLE_R),
]
SLASH_R_SUPPORT = [  # left hand: lifts and tucks out of the blade's way (it is already cocked for attack 2)
    (0.000, IDLE_L),
    (0.060, P((-0.16, 0.0, -0.395), (0.15, 0.85, -0.45), ELBOW_L)),
    (0.110, P((-0.17, 0.07, -0.385), (0.20, 0.85, -0.35), (-0.85, -0.45, 0.2))),
    (0.170, P((-0.165, 0.03, -0.39), (0.16, 0.85, -0.45), ELBOW_L)),
    (0.250, IDLE_L),
]
SLASH_L = [(t, mirror(p)) for t, p in SLASH_R]
SLASH_L_SUPPORT = [(t, mirror(p)) for t, p in SLASH_R_SUPPORT]
# The guards are not exact mirrors of each other: begin/end exactly on the real guard poses.
SLASH_L[-1] = (0.250, IDLE_L)
SLASH_L_SUPPORT[0] = (0.000, IDLE_R)
SLASH_L_SUPPORT[-1] = (0.250, IDLE_R)

# Attack 3, the crossover: a slow, deliberate wind-up pulls both hands back toward the chest and
# crosses the forearms (right above left, elbows folded), holds ~110 ms with a little secondary
# drift, then both arms whip outward in opposite directions, much wider than the diagonal cuts,
# and settle back into the guard.
CROSSED_R = P((-0.135, 0.075, -0.275), (-0.55, 0.65, -0.35), (0.55, -0.80, 0.10))
CROSSED_L = P((0.14, -0.078, -0.385), (0.55, 0.65, -0.40), (-0.55, -0.80, 0.10))
OUT_R = P((0.315, 0.03, -0.40), (0.85, 0.30, -0.45), (0.90, -0.40, 0.10))
OUT_L = P((-0.315, 0.03, -0.40), (-0.85, 0.30, -0.45), (-0.90, -0.40, 0.10))
FINISH_R = [
    (0.000, IDLE_R),
    (0.040, P((0.095, 0.03, -0.30), (-0.20, 0.80, -0.40), (0.62, -0.72, 0.10))),
    (0.095, CROSSED_R),
    (0.150, P((-0.142, 0.079, -0.268), (-0.56, 0.66, -0.34), (0.55, -0.82, 0.10))),
    (0.205, P((-0.15, 0.082, -0.265), (-0.57, 0.66, -0.33), (0.55, -0.84, 0.10))),
    (0.2255, P((0.12, 0.05, -0.43), (0.50, 0.40, -0.65), (0.80, -0.55, 0.10))),
    (0.245, OUT_R),
    (0.290, P((0.335, 0.01, -0.375), (0.88, 0.22, -0.40), (0.93, -0.35, 0.10))),
    (0.345, P((0.27, -0.04, -0.385), (0.40, 0.60, -0.62), (0.82, -0.55, 0.10))),
    (0.400, IDLE_R),
]
FINISH_L = [
    (0.000, IDLE_L),
    (0.040, P((-0.085, -0.05, -0.335), (0.20, 0.80, -0.40), (-0.62, -0.72, 0.10))),
    (0.095, CROSSED_L),
    (0.150, P((0.148, -0.081, -0.388), (0.56, 0.66, -0.40), (-0.55, -0.82, 0.10))),
    (0.205, P((0.155, -0.084, -0.392), (0.57, 0.66, -0.40), (-0.55, -0.84, 0.10))),
    (0.2255, P((-0.12, 0.03, -0.43), (-0.50, 0.40, -0.65), (-0.80, -0.55, 0.10))),
    (0.245, OUT_L),
    (0.290, P((-0.335, 0.01, -0.375), (-0.88, 0.22, -0.40), (-0.93, -0.35, 0.10))),
    (0.345, P((-0.27, -0.035, -0.39), (-0.40, 0.60, -0.62), (-0.82, -0.55, 0.10))),
    (0.400, IDLE_L),
]


def flourish(side: str) -> dict:
    """Idle finger-spin flourish: one hand lifts a little and spins its dagger a full turn about
    the thumb/index pinch point, then settles back into the guard; the other hand stays put."""
    guard = IDLE_R if side == "r" else IDLE_L
    other = "l" if side == "r" else "r"
    other_guard = IDLE_L if side == "r" else IDLE_R
    sgn = 1.0 if side == "r" else -1.0
    g = guard["p"], guard["b"]
    lift = P((g[0][0] + 0.012 * sgn, g[0][1] + 0.045, g[0][2] + 0.035), (g[1][0], 0.9, g[1][2] + 0.05), guard["e"], guard["cock"])
    flick = P((g[0][0] + 0.008 * sgn, g[0][1] + 0.052, g[0][2] + 0.025), (g[1][0], 0.92, g[1][2] + 0.05), guard["e"], guard["cock"])
    return {
        "duration": 0.52, "loop": False, "blendIn": 0.1,
        "events": {"flourish": [0.1, 0.34]},
        f"hand_{side}": [(0.0, guard), (0.09, lift), (0.34, flick), (0.43, breath(guard, 0.004, 0.01)), (0.52, guard)],
        f"hand_{other}": [(0.0, other_guard), (0.52, other_guard)],
        f"spin_{side}": [(0.0, 0.0), (0.1, 0.0), (0.22, 200.0), (0.34, 360.0), (0.52, 360.0)],
        "body": [(0.0, (0.0, 0.0, 0.0)), (0.2, (0.01 * sgn, 0.012, 0.0)), (0.52, (0.0, 0.0, 0.0))],
    }


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
    "attack_cross": {  # stage 1: right-hand diagonal, upper right to lower left
        "duration": 0.25, "loop": False, "blendIn": 0.07,
        "events": {"anticipation": [0.0, 0.055], "contact": [0.07, 0.16], "chainFrom": 0.17, "recovery": 0.15,
                   "trail": [0.045, 0.14]},
        "hand_r": SLASH_R, "hand_l": SLASH_R_SUPPORT,
        "body": [(0.0, (0.0, 0.0, 0.0)), (0.04, (-0.06, 0.05, -0.04)), (0.104, (0.30, -0.08, 0.08)), (0.15, (0.27, -0.06, 0.06)),
                 (0.25, (0.0, 0.0, 0.0))],
    },
    "attack_forward": {  # stage 2: left-hand diagonal, upper left to lower right (mirror of stage 1)
        "duration": 0.25, "loop": False, "blendIn": 0.07,
        "events": {"anticipation": [0.0, 0.055], "contact": [0.07, 0.16], "chainFrom": 0.17, "recovery": 0.15,
                   "trail": [0.045, 0.14]},
        "hand_l": SLASH_L, "hand_r": SLASH_L_SUPPORT,
        "body": [(0.0, (0.0, 0.0, 0.0)), (0.04, (0.06, 0.05, 0.04)), (0.104, (-0.30, -0.08, -0.08)), (0.15, (-0.27, -0.06, -0.06)),
                 (0.25, (0.0, 0.0, 0.0))],
    },
    "attack_finisher": {  # stage 3: crossover, ~100 ms crossed hold, then both arms snap outward
        "duration": 0.4, "loop": False, "blendIn": 0.09,
        "events": {"anticipation": [0.0, 0.205], "contact": [0.215, 0.305], "chainFrom": 0.31, "recovery": 0.29,
                   "trail": [0.205, 0.33]},
        "hand_r": FINISH_R, "hand_l": FINISH_L,
        "body": [(0.0, (0.0, 0.0, 0.0)), (0.095, (-0.03, -0.09, 0.0)), (0.15, (0.0, -0.095, 0.012)), (0.205, (0.02, -0.10, 0.0)),
                 (0.245, (0.0, 0.13, 0.0)), (0.3, (0.0, 0.09, 0.0)), (0.4, (0.0, 0.0, 0.0))],
    },
    "flourish_r": flourish("r"),
    "flourish_l": flourish("l"),
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
# Cosmetic idle flourishes: one hand spins its dagger while the other holds the guard.
FLOURISH = ["flourish_r", "flourish_l"]
FLOURISH_INTERVAL = (6.0, 12.0)
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
        "flourish": {"clips": FLOURISH, "interval": list(FLOURISH_INTERVAL)},
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
    # Attacks 1 and 2 begin in their own wind-up (the blend picks the arms up wherever they are);
    # everything else starts and ends in the guard, so a return or a flourish never snaps.
    for name in ["attack_finisher", "unequip", *FLOURISH]:
        if CLIPS[name]["hand_r"][0][1] != IDLE_R or CLIPS[name]["hand_l"][0][1] != IDLE_L:
            errors.append(f"{name}: must start in the guard pose")
    for name in COMBO + ["equip", *FLOURISH]:
        if CLIPS[name]["hand_r"][-1][1] != IDLE_R or CLIPS[name]["hand_l"][-1][1] != IDLE_L:
            errors.append(f"{name}: must end in the guard pose")
    for name in FLOURISH:
        other = "hand_l" if name.endswith("_r") else "hand_r"
        if any(pose != IDLE_L and pose != IDLE_R for _, pose in CLIPS[name][other]):
            errors.append(f"{name}: the other hand must hold its guard")
    # Targets for the animation (the brief): strike speed, total length, crossed hold.
    for name, limit in (("attack_cross", 0.26), ("attack_forward", 0.26), ("attack_finisher", 0.41)):
        if CLIPS[name]["duration"] > limit:
            errors.append(f"{name}: slower than {limit} s")
    # Forearms must not pass through each other (a forearm is ~3.5 cm in radius): sample the
    # interpolated arms every 5 ms and require 6 cm between the centrelines.
    for name in COMBO:
        clip, worst = CLIPS[name], (1e9, 0.0)
        steps = round(clip["duration"] / 0.005)
        for i in range(steps + 1):
            t = i * 0.005
            arms = {}
            for side in ("r", "l"):
                keys = clip[f"hand_{side}"]
                j = max(k for k in range(len(keys) - 1) if keys[k][0] <= t) if t < keys[-1][0] else len(keys) - 2
                (t0, p0), (t1, p1) = keys[j], keys[j + 1]
                u = min(1.0, max(0.0, (t - t0) / (t1 - t0)))
                lerp = lambda v0, v1: None if v0 is None or v1 is None else add(v0, add(v1, v0, -1.0), u)
                pose = P(lerp(p0["p"], p1["p"]), lerp(p0["b"], p1["b"]), lerp(p0["e"] or D_ELBOW[side], p1["e"] or D_ELBOW[side]),
                         p0["cock"] if p0["cock"] is not None else None)
                arms[side] = pose_arm(side, pose)
            gap = segment_gap(arms["r"][0], arms["r"][1], arms["l"][0], arms["l"][1])
            if gap < worst[0]:
                worst = (gap, t)
        if worst[0] < 0.06:
            errors.append(f"{name}: forearms {worst[0] * 100:.1f} cm apart at {worst[1]:.3f} s (need 6 cm)")
    return errors


if __name__ == "__main__":
    import json

    problems = validate()
    print(json.dumps({"errors": problems, "clips": {n: c["duration"] for n, c in CLIPS.items()}}, indent=1))
    for side, pose in (("r", IDLE_R), ("l", IDLE_L)):
        x, y, z = hand_axes(side, pose)
        print(side, "idle blade", [round(-c, 2) for c in z], "edge", [round(-c, 2) for c in y], "flat", [round(c, 2) for c in x])
    raise SystemExit(1 if problems else 0)
