use crate::types::{Vec3, AABB};

const DEG_TO_RAD: f64 = std::f64::consts::PI / 180.0;

/// Check if all rotation components are multiples of 90 degrees.
#[allow(dead_code)]
pub fn is_axis_aligned(rotation_deg: Vec3) -> bool {
    let check = |v: f64| {
        let m = ((v % 360.0) + 360.0) % 360.0;
        (m % 90.0) < 0.001 || (90.0 - (m % 90.0)) < 0.001
    };
    check(rotation_deg.x) && check(rotation_deg.y) && check(rotation_deg.z)
}

/// Build 3x3 rotation matrix (row-major) for Y-X-Z order: R = Rz * Rx * Ry
pub fn build_rotation_3x3(rot_deg: Vec3) -> [f64; 9] {
    let rx = rot_deg.x * DEG_TO_RAD;
    let ry = rot_deg.y * DEG_TO_RAD;
    let rz = rot_deg.z * DEG_TO_RAD;
    let (sx, cx) = rx.sin_cos();
    let (sy, cy) = ry.sin_cos();
    let (sz, cz) = rz.sin_cos();

    // R = Rz * Rx * Ry (row-major)
    [
        cz * cy - sz * sx * sy,
        -sz * cx,
        cz * sy + sz * sx * cy,
        sz * cy + cz * sx * sy,
        cz * cx,
        sz * sy - cz * sx * cy,
        -cx * sy,
        sx,
        cx * cy,
    ]
}

/// Rotate a point by the 3x3 matrix (row-major).
pub fn rotate_point(m: &[f64; 9], x: f64, y: f64, z: f64) -> Vec3 {
    Vec3 {
        x: m[0] * x + m[1] * y + m[2] * z,
        y: m[3] * x + m[4] * y + m[5] * z,
        z: m[6] * x + m[7] * y + m[8] * z,
    }
}

/// Snap near-integer values to avoid floating-point floor/ceil overshoot.
fn snap(v: f64) -> f64 {
    if (v - v.round()).abs() < 0.001 {
        v.round()
    } else {
        v
    }
}

/// Compute the AABB of a rotated box at the given position.
/// exact=true returns raw floating-point bounds (for picking);
/// exact=false (default) snaps to integer voxel bounds.
pub fn compute_rotated_aabb(
    w: f64,
    h: f64,
    d: f64,
    position: Vec3,
    rotation_deg: Vec3,
) -> AABB {
    compute_rotated_aabb_inner(w, h, d, position, rotation_deg, false)
}

#[allow(dead_code)]
pub fn compute_rotated_aabb_exact(
    w: f64,
    h: f64,
    d: f64,
    position: Vec3,
    rotation_deg: Vec3,
) -> AABB {
    compute_rotated_aabb_inner(w, h, d, position, rotation_deg, true)
}

fn compute_rotated_aabb_inner(
    w: f64,
    h: f64,
    d: f64,
    position: Vec3,
    rotation_deg: Vec3,
    exact: bool,
) -> AABB {
    let rot = build_rotation_3x3(rotation_deg);

    // 8 corners of the box
    let corners: [[f64; 3]; 8] = [
        [0.0, 0.0, 0.0],
        [w, 0.0, 0.0],
        [0.0, h, 0.0],
        [0.0, 0.0, d],
        [w, h, 0.0],
        [w, 0.0, d],
        [0.0, h, d],
        [w, h, d],
    ];

    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut min_z = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    let mut max_z = f64::NEG_INFINITY;

    for c in &corners {
        let p = rotate_point(&rot, c[0], c[1], c[2]);
        let px = p.x + position.x;
        let py = p.y + position.y;
        let pz = p.z + position.z;
        if px < min_x {
            min_x = px;
        }
        if py < min_y {
            min_y = py;
        }
        if pz < min_z {
            min_z = pz;
        }
        if px > max_x {
            max_x = px;
        }
        if py > max_y {
            max_y = py;
        }
        if pz > max_z {
            max_z = pz;
        }
    }

    if exact {
        AABB {
            min: Vec3::new(min_x, min_y, min_z),
            max: Vec3::new(max_x, max_y, max_z),
        }
    } else {
        AABB {
            min: Vec3::new(snap(min_x).floor(), snap(min_y).floor(), snap(min_z).floor()),
            max: Vec3::new(snap(max_x).ceil(), snap(max_y).ceil(), snap(max_z).ceil()),
        }
    }
}

/// Rotate a Vec3 by Y-X-Z Euler angles (same rotation order used throughout the engine).
pub fn rotate_vec3(v: Vec3, rotation_deg: Vec3) -> Vec3 {
    let m = build_rotation_3x3(rotation_deg);
    rotate_point(&m, v.x, v.y, v.z)
}

/// Compute the AABB for a composite shape (multiple blocks) at a given position with rotation.
/// Only computes the AABB union — no voxel enumeration.
pub fn compute_composite_aabb(
    blocks: &[crate::types::ShapeBlock],
    position: Vec3,
    rotation_deg: Vec3,
) -> AABB {
    if blocks.is_empty() {
        return AABB {
            min: position,
            max: position,
        };
    }

    let rot = build_rotation_3x3(rotation_deg);

    let mut g_min_x = f64::INFINITY;
    let mut g_min_y = f64::INFINITY;
    let mut g_min_z = f64::INFINITY;
    let mut g_max_x = f64::NEG_INFINITY;
    let mut g_max_y = f64::NEG_INFINITY;
    let mut g_max_z = f64::NEG_INFINITY;

    for block in blocks {
        let corners: [[f64; 3]; 8] = [
            [block.x, block.y, block.z],
            [block.x + block.w, block.y, block.z],
            [block.x, block.y + block.h, block.z],
            [block.x, block.y, block.z + block.d],
            [block.x + block.w, block.y + block.h, block.z],
            [block.x + block.w, block.y, block.z + block.d],
            [block.x, block.y + block.h, block.z + block.d],
            [block.x + block.w, block.y + block.h, block.z + block.d],
        ];

        let mut b_min_x = f64::INFINITY;
        let mut b_min_y = f64::INFINITY;
        let mut b_min_z = f64::INFINITY;
        let mut b_max_x = f64::NEG_INFINITY;
        let mut b_max_y = f64::NEG_INFINITY;
        let mut b_max_z = f64::NEG_INFINITY;

        for c in &corners {
            let p = rotate_point(&rot, c[0], c[1], c[2]);
            let px = p.x + position.x;
            let py = p.y + position.y;
            let pz = p.z + position.z;
            if px < b_min_x {
                b_min_x = px;
            }
            if py < b_min_y {
                b_min_y = py;
            }
            if pz < b_min_z {
                b_min_z = pz;
            }
            if px > b_max_x {
                b_max_x = px;
            }
            if py > b_max_y {
                b_max_y = py;
            }
            if pz > b_max_z {
                b_max_z = pz;
            }
        }

        // Snap per-block
        let v_min_x = snap(b_min_x).floor();
        let v_min_y = snap(b_min_y).floor();
        let v_min_z = snap(b_min_z).floor();
        let v_max_x = snap(b_max_x).ceil();
        let v_max_y = snap(b_max_y).ceil();
        let v_max_z = snap(b_max_z).ceil();

        if v_min_x < g_min_x {
            g_min_x = v_min_x;
        }
        if v_min_y < g_min_y {
            g_min_y = v_min_y;
        }
        if v_min_z < g_min_z {
            g_min_z = v_min_z;
        }
        if v_max_x > g_max_x {
            g_max_x = v_max_x;
        }
        if v_max_y > g_max_y {
            g_max_y = v_max_y;
        }
        if v_max_z > g_max_z {
            g_max_z = v_max_z;
        }
    }

    AABB {
        min: Vec3::new(g_min_x, g_min_y, g_min_z),
        max: Vec3::new(g_max_x, g_max_y, g_max_z),
    }
}

/// Compute the AABB of a cargo def (simple box or composite) at position with rotation.
#[allow(dead_code)]
pub fn compute_cargo_aabb(
    def: &crate::types::CargoItemDef,
    position: Vec3,
    rotation_deg: Vec3,
) -> AABB {
    if let Some(blocks) = &def.blocks {
        compute_composite_aabb(blocks, position, rotation_deg)
    } else {
        compute_rotated_aabb(def.width_cm, def.height_cm, def.depth_cm, position, rotation_deg)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_identity_rotation() {
        let aabb = compute_rotated_aabb(100.0, 50.0, 30.0, Vec3::zero(), Vec3::zero());
        assert_eq!(aabb.min.x, 0.0);
        assert_eq!(aabb.min.y, 0.0);
        assert_eq!(aabb.min.z, 0.0);
        assert_eq!(aabb.max.x, 100.0);
        assert_eq!(aabb.max.y, 50.0);
        assert_eq!(aabb.max.z, 30.0);
    }

    #[test]
    fn test_90_deg_y_rotation() {
        // 90 deg Y rotation: W×H×D (100×50×30) → D×H×W (30×50×100)
        let rot = Vec3::new(0.0, 90.0, 0.0);
        let aabb = compute_rotated_aabb(100.0, 50.0, 30.0, Vec3::zero(), rot);
        // After Y-90 rotation, the effective dims become D×H×W
        assert!((aabb.max.x - aabb.min.x - 30.0).abs() < 0.01);
        assert!((aabb.max.y - aabb.min.y - 50.0).abs() < 0.01);
        assert!((aabb.max.z - aabb.min.z - 100.0).abs() < 0.01);
    }

    #[test]
    fn test_is_axis_aligned() {
        assert!(is_axis_aligned(Vec3::zero()));
        assert!(is_axis_aligned(Vec3::new(90.0, 0.0, 0.0)));
        assert!(is_axis_aligned(Vec3::new(0.0, 90.0, 0.0)));
        assert!(is_axis_aligned(Vec3::new(90.0, 90.0, 90.0)));
        assert!(is_axis_aligned(Vec3::new(180.0, 270.0, 360.0)));
        assert!(!is_axis_aligned(Vec3::new(45.0, 0.0, 0.0)));
    }

    #[test]
    fn test_snap() {
        assert_eq!(snap(1.0001), 1.0);
        assert_eq!(snap(0.9999), 1.0);
        assert_eq!(snap(1.5), 1.5);
    }

    #[test]
    fn test_rotate_vec3_identity() {
        let v = Vec3::new(10.0, 20.0, 30.0);
        let r = rotate_vec3(v, Vec3::zero());
        assert!((r.x - 10.0).abs() < 1e-10);
        assert!((r.y - 20.0).abs() < 1e-10);
        assert!((r.z - 30.0).abs() < 1e-10);
    }
}
