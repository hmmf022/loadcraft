use std::collections::{HashMap, HashSet};

use crate::types::{CargoItemDef, PlacedCargo, Vec3};
use crate::voxelizer::compute_rotated_aabb;

/// Tolerance in cm for "touching" detection.
const EPSILON: f64 = 1.5;

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct StackViolation {
    pub instance_id: u32,
    pub cargo_def_id: String,
    pub name: String,
    pub max_stack_weight_kg: f64,
    pub actual_stack_weight_kg: f64,
}

#[derive(Debug, Clone)]
struct PlacedAABB {
    instance_id: u32,
    def_id: String,
    min: Vec3,
    max: Vec3,
    weight_kg: f64,
}

pub struct StackContext {
    aabbs: Vec<PlacedAABB>,
    on_top_of: Vec<Vec<usize>>,
    supported_by: Vec<Vec<usize>>,
    weight_above_cache: HashMap<usize, f64>,
    def_map: HashMap<String, CargoItemDef>,
}

impl StackContext {
    fn get_weight_above(&mut self, idx: usize) -> f64 {
        if let Some(&cached) = self.weight_above_cache.get(&idx) {
            return cached;
        }

        let above_indices: Vec<usize> = self.on_top_of[idx].clone();
        let mut total = 0.0;
        for above_idx in above_indices {
            total += self.aabbs[above_idx].weight_kg + self.get_weight_above(above_idx);
        }

        self.weight_above_cache.insert(idx, total);
        total
    }
}

/// Build an incremental stack context from existing placements.
pub fn build_stack_context(placements: &[PlacedCargo], defs: &[CargoItemDef]) -> StackContext {
    let def_map: HashMap<String, CargoItemDef> =
        defs.iter().map(|d| (d.id.clone(), d.clone())).collect();

    let mut aabbs = Vec::new();
    for p in placements {
        let Some(def) = def_map.get(&p.cargo_def_id) else {
            continue;
        };
        let aabb = compute_rotated_aabb(
            def.width_cm,
            def.height_cm,
            def.depth_cm,
            p.position_cm,
            p.rotation_deg,
        );
        aabbs.push(PlacedAABB {
            instance_id: p.instance_id,
            def_id: def.id.clone(),
            min: aabb.min,
            max: aabb.max,
            weight_kg: def.weight_kg,
        });
    }

    let n = aabbs.len();
    let mut on_top_of: Vec<Vec<usize>> = (0..n).map(|_| Vec::new()).collect();
    let mut supported_by: Vec<Vec<usize>> = (0..n).map(|_| Vec::new()).collect();

    for i in 0..n {
        for j in (i + 1)..n {
            let a = &aabbs[i];
            let b = &aabbs[j];
            let overlap_x = a.min.x < b.max.x && a.max.x > b.min.x;
            let overlap_z = a.min.z < b.max.z && a.max.z > b.min.z;
            if !overlap_x || !overlap_z {
                continue;
            }
            if (b.min.y - a.max.y).abs() < EPSILON {
                on_top_of[i].push(j);
                supported_by[j].push(i);
            }
            if (a.min.y - b.max.y).abs() < EPSILON {
                on_top_of[j].push(i);
                supported_by[i].push(j);
            }
        }
    }

    StackContext {
        aabbs,
        on_top_of,
        supported_by,
        weight_above_cache: HashMap::new(),
        def_map,
    }
}

/// Check if adding new_placement would violate any stack constraints.
/// Only checks items affected by the new placement (O(N) instead of O(N²)).
pub fn check_stack_incremental(
    ctx: &mut StackContext,
    new_placement: &PlacedCargo,
    new_def: &CargoItemDef,
) -> Vec<StackViolation> {
    let aabb = compute_rotated_aabb(
        new_def.width_cm,
        new_def.height_cm,
        new_def.depth_cm,
        new_placement.position_cm,
        new_placement.rotation_deg,
    );
    let new_aabb = PlacedAABB {
        instance_id: new_placement.instance_id,
        def_id: new_def.id.clone(),
        min: aabb.min,
        max: aabb.max,
        weight_kg: new_def.weight_kg,
    };

    // Find which existing items the new placement sits on top of
    let mut direct_supporters = Vec::new();
    for i in 0..ctx.aabbs.len() {
        let existing = &ctx.aabbs[i];
        let overlap_x = existing.min.x < new_aabb.max.x && existing.max.x > new_aabb.min.x;
        let overlap_z = existing.min.z < new_aabb.max.z && existing.max.z > new_aabb.min.z;
        if !overlap_x || !overlap_z {
            continue;
        }
        if (new_aabb.min.y - existing.max.y).abs() < EPSILON {
            direct_supporters.push(i);
        }
    }

    if direct_supporters.is_empty() {
        return Vec::new();
    }

    let added_weight = new_def.weight_kg;
    let mut violations = Vec::new();
    let mut visited = HashSet::new();
    let mut queue: Vec<usize> = direct_supporters;

    while let Some(idx) = queue.pop() {
        if !visited.insert(idx) {
            continue;
        }

        // Extract needed data before mutable borrow
        let item_instance_id = ctx.aabbs[idx].instance_id;
        let item_def_id = ctx.aabbs[idx].def_id.clone();

        // Clone constraint info to avoid borrow conflict with get_weight_above
        let constraint_info = ctx.def_map.get(&item_def_id).map(|def| {
            let max_stack = if def.no_stack == Some(true) {
                Some(0.0)
            } else {
                def.max_stack_weight_kg
            };
            (def.id.clone(), def.name.clone(), max_stack)
        });

        if let Some((def_id, def_name, Some(max_stack))) = constraint_info {
            let current_weight_above = ctx.get_weight_above(idx);
            if current_weight_above + added_weight > max_stack {
                violations.push(StackViolation {
                    instance_id: item_instance_id,
                    cargo_def_id: def_id,
                    name: def_name,
                    max_stack_weight_kg: max_stack,
                    actual_stack_weight_kg: current_weight_above + added_weight,
                });
            }
        }

        // Propagate downward through supporters
        for &below_idx in &ctx.supported_by[idx] {
            if !visited.contains(&below_idx) {
                queue.push(below_idx);
            }
        }
    }

    violations
}

/// Add a confirmed placement to the stack context.
pub fn add_to_stack_context(
    ctx: &mut StackContext,
    placement: &PlacedCargo,
    def: &CargoItemDef,
) {
    let aabb = compute_rotated_aabb(
        def.width_cm,
        def.height_cm,
        def.depth_cm,
        placement.position_cm,
        placement.rotation_deg,
    );
    let new_idx = ctx.aabbs.len();
    ctx.aabbs.push(PlacedAABB {
        instance_id: placement.instance_id,
        def_id: def.id.clone(),
        min: aabb.min,
        max: aabb.max,
        weight_kg: def.weight_kg,
    });
    ctx.on_top_of.push(Vec::new());
    ctx.supported_by.push(Vec::new());

    // Build edges for the new item
    for i in 0..new_idx {
        let existing = &ctx.aabbs[i];
        let overlap_x = existing.min.x < aabb.max.x && existing.max.x > aabb.min.x;
        let overlap_z = existing.min.z < aabb.max.z && existing.max.z > aabb.min.z;
        if !overlap_x || !overlap_z {
            continue;
        }

        // New item sits on existing
        if (aabb.min.y - existing.max.y).abs() < EPSILON {
            ctx.on_top_of[i].push(new_idx);
            ctx.supported_by[new_idx].push(i);
        }
        // Existing sits on new item
        if (existing.min.y - aabb.max.y).abs() < EPSILON {
            ctx.on_top_of[new_idx].push(i);
            ctx.supported_by[i].push(new_idx);
        }
    }

    // Invalidate weight-above cache for affected items (transitive supporters)
    let mut to_invalidate = HashSet::new();
    let mut queue: Vec<usize> = ctx.supported_by[new_idx].clone();
    while let Some(idx) = queue.pop() {
        if !to_invalidate.insert(idx) {
            continue;
        }
        for &below_idx in &ctx.supported_by[idx] {
            if !to_invalidate.contains(&below_idx) {
                queue.push(below_idx);
            }
        }
    }
    for idx in to_invalidate {
        ctx.weight_above_cache.remove(&idx);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_def(id: &str, w: f64, h: f64, d: f64, weight: f64) -> CargoItemDef {
        CargoItemDef {
            id: id.to_string(),
            name: id.to_string(),
            width_cm: w,
            height_cm: h,
            depth_cm: d,
            weight_kg: weight,
            color: "#FF0000".to_string(),
            blocks: None,
            max_stack_weight_kg: None,
            no_stack: None,
            no_flip: None,
        }
    }

    #[test]
    fn test_no_violations_without_constraints() {
        let def = make_def("box", 100.0, 50.0, 100.0, 10.0);
        let p1 = PlacedCargo {
            instance_id: 1,
            cargo_def_id: "box".to_string(),
            position_cm: Vec3::zero(),
            rotation_deg: Vec3::zero(),
        };
        let p2 = PlacedCargo {
            instance_id: 2,
            cargo_def_id: "box".to_string(),
            position_cm: Vec3::new(0.0, 50.0, 0.0),
            rotation_deg: Vec3::zero(),
        };

        let mut ctx = build_stack_context(&[p1], &[def.clone()]);
        let violations = check_stack_incremental(&mut ctx, &p2, &def);
        assert!(violations.is_empty());
    }

    #[test]
    fn test_stack_violation() {
        let mut def = make_def("box", 100.0, 50.0, 100.0, 20.0);
        def.max_stack_weight_kg = Some(10.0);

        let p1 = PlacedCargo {
            instance_id: 1,
            cargo_def_id: "box".to_string(),
            position_cm: Vec3::zero(),
            rotation_deg: Vec3::zero(),
        };
        let p2 = PlacedCargo {
            instance_id: 2,
            cargo_def_id: "box".to_string(),
            position_cm: Vec3::new(0.0, 50.0, 0.0),
            rotation_deg: Vec3::zero(),
        };

        let mut ctx = build_stack_context(&[p1], &[def.clone()]);
        let violations = check_stack_incremental(&mut ctx, &p2, &def);
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].max_stack_weight_kg, 10.0);
        assert_eq!(violations[0].actual_stack_weight_kg, 20.0);
    }

    #[test]
    fn test_no_stack() {
        let mut def = make_def("fragile", 100.0, 50.0, 100.0, 5.0);
        def.no_stack = Some(true);

        let p1 = PlacedCargo {
            instance_id: 1,
            cargo_def_id: "fragile".to_string(),
            position_cm: Vec3::zero(),
            rotation_deg: Vec3::zero(),
        };
        let p2 = PlacedCargo {
            instance_id: 2,
            cargo_def_id: "fragile".to_string(),
            position_cm: Vec3::new(0.0, 50.0, 0.0),
            rotation_deg: Vec3::zero(),
        };

        let mut ctx = build_stack_context(&[p1], &[def.clone()]);
        let violations = check_stack_incremental(&mut ctx, &p2, &def);
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].max_stack_weight_kg, 0.0);
    }
}
