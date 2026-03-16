use std::collections::{HashMap, HashSet};
use std::time::Instant;

use crate::occupancy_map::OccupancyMap;
use crate::stack_checker::{
    add_to_stack_context, build_stack_context, check_stack_incremental, StackContext,
};
use crate::types::*;
use crate::voxelizer::{compute_composite_aabb, compute_rotated_aabb};

// ─── Score weight presets ───────────────────────────────────────

#[derive(Debug, Clone, Copy)]
struct ScoreWeights {
    floor: f64,
    back_wall: f64,
    side: f64,
    support: f64,
    rotation: f64,
    cog: f64,
    grouping: f64,
    caving: f64,
}

const DEFAULT_WEIGHTS: ScoreWeights = ScoreWeights {
    floor: 1.2,
    back_wall: 1.0,
    side: 0.9,
    support: 0.6,
    rotation: 0.2,
    cog: 0.05,
    grouping: 0.0,
    caving: 0.0,
};

const GROUPING_FALLBACK_WEIGHTS: ScoreWeights = ScoreWeights {
    floor: 1.2,
    back_wall: 1.0,
    side: 0.9,
    support: 0.6,
    rotation: 0.2,
    cog: 0.05,
    grouping: 1.0,
    caving: 0.0,
};

const LFF_WEIGHTS: ScoreWeights = ScoreWeights {
    floor: 0.6,
    back_wall: 0.4,
    side: 0.4,
    support: 0.8,
    rotation: 0.2,
    cog: 0.05,
    grouping: 0.8,
    caving: 1.5,
};

// ─── Constants ──────────────────────────────────────────────────

/// 6 axis-aligned orientations covering all W×H×D permutations.
const ORIENTATIONS: [Vec3; 6] = [
    Vec3 { x: 0.0, y: 0.0, z: 0.0 },     // W×H×D (original)
    Vec3 { x: 0.0, y: 90.0, z: 0.0 },    // D×H×W
    Vec3 { x: 90.0, y: 0.0, z: 0.0 },    // W×D×H
    Vec3 { x: 90.0, y: 90.0, z: 0.0 },   // H×D×W
    Vec3 { x: 0.0, y: 0.0, z: 90.0 },    // H×W×D
    Vec3 { x: 90.0, y: 0.0, z: 90.0 },   // D×W×H
];

/// Y-axis-only orientations for noFlip items.
const NOFLIP_ORIENTATIONS: [Vec3; 2] = [
    Vec3 { x: 0.0, y: 0.0, z: 0.0 },
    Vec3 { x: 0.0, y: 90.0, z: 0.0 },
];

const MIN_SUPPORT_RATIO: f64 = 0.5;

// ─── Orientation helpers ────────────────────────────────────────

#[derive(Debug, Clone)]
struct OrientationCandidate {
    rot: Vec3,
    eff_w: f64,
    eff_h: f64,
    eff_d: f64,
    offset_x: f64,
    offset_y: f64,
    offset_z: f64,
}

/// Get unique orientation candidates for a cargo def, deduplicating identical AABB sizes.
fn get_orientation_candidates(def: &CargoItemDef) -> Vec<OrientationCandidate> {
    let orientations: &[Vec3] = if def.no_flip == Some(true) {
        &NOFLIP_ORIENTATIONS
    } else {
        &ORIENTATIONS
    };

    let mut seen = HashSet::new();
    let mut candidates = Vec::new();

    for &rot in orientations {
        let aabb = compute_rotated_aabb(
            def.width_cm,
            def.height_cm,
            def.depth_cm,
            Vec3::zero(),
            rot,
        );
        let eff_w = aabb.max.x - aabb.min.x;
        let eff_h = aabb.max.y - aabb.min.y;
        let eff_d = aabb.max.z - aabb.min.z;

        // Dedup by snapped integer tuple (matching TS behavior of string key)
        let key = (eff_w as i64, eff_h as i64, eff_d as i64);
        if seen.contains(&key) {
            continue;
        }
        seen.insert(key);

        candidates.push(OrientationCandidate {
            rot,
            eff_w,
            eff_h,
            eff_d,
            offset_x: -aabb.min.x,
            offset_y: -aabb.min.y,
            offset_z: -aabb.min.z,
        });
    }

    candidates
}

// ─── Internal types ────────────────────────────────────────────

#[derive(Default)]
struct GroupCentroid {
    sum_x: f64,
    sum_y: f64,
    sum_z: f64,
    count: u32,
}

struct RunningCog {
    total_weight: f64,
    cog_x: f64,
    cog_y: f64,
    cog_z: f64,
}

struct ScoredCandidate {
    placement: PlacedCargo,
    aabb: AABB,
    score: f64,
}

// ─── Utility functions ──────────────────────────────────────────

fn get_placement_center(p: &PlacedCargo, def: &CargoItemDef) -> Vec3 {
    let aabb = compute_rotated_aabb(
        def.width_cm,
        def.height_cm,
        def.depth_cm,
        p.position_cm,
        p.rotation_deg,
    );
    Vec3::new(
        (aabb.min.x + aabb.max.x) / 2.0,
        (aabb.min.y + aabb.max.y) / 2.0,
        (aabb.min.z + aabb.max.z) / 2.0,
    )
}

fn dedupe_defs(defs: &[CargoItemDef]) -> Vec<CargoItemDef> {
    let mut map: HashMap<String, CargoItemDef> = HashMap::new();
    for def in defs {
        map.entry(def.id.clone()).or_insert_with(|| def.clone());
    }
    map.into_values().collect()
}

fn build_aabb_list(placements: &[PlacedCargo], defs: &[CargoItemDef]) -> Vec<AABB> {
    let def_map: HashMap<&str, &CargoItemDef> =
        defs.iter().map(|d| (d.id.as_str(), d)).collect();
    let mut list = Vec::new();
    for p in placements {
        let Some(def) = def_map.get(p.cargo_def_id.as_str()) else {
            continue;
        };
        let aabb = compute_rotated_aabb(
            def.width_cm,
            def.height_cm,
            def.depth_cm,
            p.position_cm,
            p.rotation_deg,
        );
        list.push(aabb);
    }
    list
}

fn is_inside_container(aabb: &AABB, container: &ContainerDef) -> bool {
    !(aabb.min.x < 0.0
        || aabb.min.y < 0.0
        || aabb.min.z < 0.0
        || aabb.max.x > container.width_cm
        || aabb.max.y > container.height_cm
        || aabb.max.z > container.depth_cm)
}

fn is_colliding(aabb: &AABB, existing: &[AABB]) -> bool {
    for e in existing {
        if aabb.min.x < e.max.x
            && aabb.max.x > e.min.x
            && aabb.min.y < e.max.y
            && aabb.max.y > e.min.y
            && aabb.min.z < e.max.z
            && aabb.max.z > e.min.z
        {
            return true;
        }
    }
    false
}

fn pick_failure_reason(
    def: &CargoItemDef,
    had_orientation_fit: bool,
    had_candidate_position: bool,
    had_stack_constraint: bool,
    had_no_support: bool,
    had_collision: bool,
    had_out_of_bounds: bool,
) -> PackFailureReason {
    if !had_orientation_fit {
        return PackFailureReason {
            cargo_def_id: def.id.clone(),
            cargo_name: def.name.clone(),
            code: PackFailureCode::OutOfBounds,
            detail: "Item does not fit container dimensions in any allowed orientation."
                .to_string(),
        };
    }
    if !had_candidate_position {
        return PackFailureReason {
            cargo_def_id: def.id.clone(),
            cargo_name: def.name.clone(),
            code: PackFailureCode::NoFeasiblePosition,
            detail: "No free position found in occupancy map search.".to_string(),
        };
    }
    if had_stack_constraint {
        return PackFailureReason {
            cargo_def_id: def.id.clone(),
            cargo_name: def.name.clone(),
            code: PackFailureCode::StackConstraint,
            detail: "Placement would violate stack weight constraints.".to_string(),
        };
    }
    if had_no_support {
        return PackFailureReason {
            cargo_def_id: def.id.clone(),
            cargo_name: def.name.clone(),
            code: PackFailureCode::NoSupport,
            detail: "Bottom support ratio was below the required threshold.".to_string(),
        };
    }
    if had_collision {
        return PackFailureReason {
            cargo_def_id: def.id.clone(),
            cargo_name: def.name.clone(),
            code: PackFailureCode::Collision,
            detail: "Candidate placement intersects existing cargo AABB.".to_string(),
        };
    }
    if had_out_of_bounds {
        return PackFailureReason {
            cargo_def_id: def.id.clone(),
            cargo_name: def.name.clone(),
            code: PackFailureCode::OutOfBounds,
            detail: "Candidate placement exceeded container bounds after rotation.".to_string(),
        };
    }
    PackFailureReason {
        cargo_def_id: def.id.clone(),
        cargo_name: def.name.clone(),
        code: PackFailureCode::NoFeasiblePosition,
        detail: "No candidate passed all placement checks.".to_string(),
    }
}

fn update_group_centroids(
    centroids: &mut HashMap<String, GroupCentroid>,
    placement: &PlacedCargo,
    def: &CargoItemDef,
) {
    let center = get_placement_center(placement, def);
    let gc = centroids.entry(def.id.clone()).or_default();
    gc.sum_x += center.x;
    gc.sum_y += center.y;
    gc.sum_z += center.z;
    gc.count += 1;
}

/// Compute cargo AABB, accounting for composite shapes.
fn compute_cargo_aabb_for_placement(
    def: &CargoItemDef,
    pos: Vec3,
    rot: Vec3,
) -> AABB {
    if let Some(blocks) = &def.blocks {
        compute_composite_aabb(blocks, pos, rot)
    } else {
        compute_rotated_aabb(def.width_cm, def.height_cm, def.depth_cm, pos, rot)
    }
}

// ─── Scoring ────────────────────────────────────────────────────

fn score_placement(
    placement: &PlacedCargo,
    def: &CargoItemDef,
    container: &ContainerDef,
    running_total_weight: f64,
    running_cog_x: f64,
    running_cog_y: f64,
    running_cog_z: f64,
    support_ratio: f64,
    weights: &ScoreWeights,
    group_centroid: Option<&GroupCentroid>,
) -> f64 {
    let center = get_placement_center(placement, def);
    let total_weight = running_total_weight + def.weight_kg;
    let cog_x = (running_cog_x + center.x * def.weight_kg) / total_weight;
    let cog_y = (running_cog_y + center.y * def.weight_kg) / total_weight;
    let cog_z = (running_cog_z + center.z * def.weight_kg) / total_weight;
    let target_x = container.width_cm / 2.0;
    let target_y = container.height_cm / 2.0;
    let target_z = container.depth_cm / 2.0;
    let dev_x = (cog_x - target_x).abs() / 1.0_f64.max(container.width_cm);
    let dev_y = (cog_y - target_y).abs() / 1.0_f64.max(container.height_cm);
    let dev_z = (cog_z - target_z).abs() / 1.0_f64.max(container.depth_cm);
    let cog_penalty = dev_x + dev_y * 0.25 + dev_z;

    let aabb = compute_rotated_aabb(
        def.width_cm,
        def.height_cm,
        def.depth_cm,
        placement.position_cm,
        placement.rotation_deg,
    );
    let floor_penalty = aabb.min.y / 1.0_f64.max(container.height_cm);
    let back_wall_penalty = placement.position_cm.x / 1.0_f64.max(container.width_cm);
    let side_penalty = placement.position_cm.z / 1.0_f64.max(container.depth_cm);
    let support_penalty = 1.0 - support_ratio;
    let rotation_penalty = (placement.rotation_deg.x.abs()
        + placement.rotation_deg.y.abs()
        + placement.rotation_deg.z.abs())
        / 270.0;

    let mut score = floor_penalty * weights.floor
        + back_wall_penalty * weights.back_wall
        + side_penalty * weights.side
        + cog_penalty * weights.cog
        + support_penalty * weights.support
        + rotation_penalty * weights.rotation;

    // Grouping penalty
    if weights.grouping > 0.0 {
        if let Some(gc) = group_centroid {
            if gc.count > 0 {
                let avg_x = gc.sum_x / gc.count as f64;
                let avg_y = gc.sum_y / gc.count as f64;
                let avg_z = gc.sum_z / gc.count as f64;
                let grouping_penalty = (center.x - avg_x).abs()
                    / 1.0_f64.max(container.width_cm)
                    + (center.y - avg_y).abs() / 1.0_f64.max(container.height_cm)
                    + (center.z - avg_z).abs() / 1.0_f64.max(container.depth_cm);
                score += grouping_penalty * weights.grouping;
            }
        }
    }

    // Caving penalty (wall contact)
    if weights.caving > 0.0 {
        let mut wall_contact = 0.0_f64;
        if aabb.min.x < 1.0 {
            wall_contact += 1.0;
        }
        if aabb.min.y < 1.0 {
            wall_contact += 1.0;
        }
        if aabb.min.z < 1.0 {
            wall_contact += 1.0;
        }
        if aabb.max.x > container.width_cm - 1.0 {
            wall_contact += 1.0;
        }
        if aabb.max.z > container.depth_cm - 1.0 {
            wall_contact += 1.0;
        }
        let caving_penalty = 1.0 - wall_contact / 5.0;
        score += caving_penalty * weights.caving;
    }

    score
}

// ─── tryPlaceItem — shared placement core ───────────────────────

enum TryPlaceResult {
    Placed {
        placement: PlacedCargo,
        #[allow(dead_code)]
        aabb: AABB,
    },
    Failed {
        failure_reason: PackFailureReason,
    },
}

fn try_place_item(
    def: &CargoItemDef,
    instance_id: u32,
    occ_map: &mut OccupancyMap,
    container: &ContainerDef,
    placed_aabbs: &mut Vec<AABB>,
    mut stack_ctx: Option<&mut StackContext>,
    weights: &ScoreWeights,
    group_centroids: Option<&HashMap<String, GroupCentroid>>,
    running_cog: &mut RunningCog,
    deadline: Option<Instant>,
    y_max: Option<f64>,
    allowed_orientations: Option<&[OrientationCandidate]>,
) -> TryPlaceResult {
    if let Some(dl) = deadline {
        if Instant::now() > dl {
            return TryPlaceResult::Failed {
                failure_reason: PackFailureReason {
                    cargo_def_id: def.id.clone(),
                    cargo_name: def.name.clone(),
                    code: PackFailureCode::NoFeasiblePosition,
                    detail: "Auto-pack timed out.".to_string(),
                },
            };
        }
    }

    let default_candidates;
    let candidates = match allowed_orientations {
        Some(c) => c,
        None => {
            default_candidates = get_orientation_candidates(def);
            &default_candidates
        }
    };

    let mut had_orientation_fit = false;
    let mut had_candidate_position = false;
    let mut had_out_of_bounds = false;
    let mut had_collision = false;
    let mut had_no_support = false;
    let mut had_stack_constraint = false;

    let mut scored_candidates: Vec<ScoredCandidate> = Vec::new();

    for c in candidates {
        if c.eff_w > container.width_cm
            || c.eff_h > container.height_cm
            || c.eff_d > container.depth_cm
        {
            continue;
        }
        had_orientation_fit = true;

        let pos_list = occ_map.find_candidate_positions(c.eff_w, c.eff_h, c.eff_d, 16, y_max);
        if pos_list.is_empty() {
            continue;
        }
        had_candidate_position = true;

        for candidate_pos in &pos_list {
            let mut pos = Vec3::new(
                candidate_pos.x + c.offset_x,
                candidate_pos.y + c.offset_y,
                candidate_pos.z + c.offset_z,
            );
            let mut aabb = compute_cargo_aabb_for_placement(def, pos, c.rot);

            // Correct slight out-of-bounds shifts
            let mut dx = 0.0_f64;
            let mut dy = 0.0_f64;
            let mut dz = 0.0_f64;
            if aabb.min.x < 0.0 {
                dx = -aabb.min.x;
            }
            if aabb.min.y < 0.0 {
                dy = -aabb.min.y;
            }
            if aabb.min.z < 0.0 {
                dz = -aabb.min.z;
            }
            if aabb.max.x > container.width_cm {
                dx = container.width_cm - aabb.max.x;
            }
            if aabb.max.y > container.height_cm {
                dy = container.height_cm - aabb.max.y;
            }
            if aabb.max.z > container.depth_cm {
                dz = container.depth_cm - aabb.max.z;
            }
            if dx != 0.0 || dy != 0.0 || dz != 0.0 {
                pos = Vec3::new(pos.x + dx, pos.y + dy, pos.z + dz);
                aabb = compute_cargo_aabb_for_placement(def, pos, c.rot);
            }

            if !is_inside_container(&aabb, container) {
                had_out_of_bounds = true;
                continue;
            }
            if is_colliding(&aabb, placed_aabbs) {
                had_collision = true;
                continue;
            }

            let support_ratio = occ_map.get_support_ratio(
                aabb.min.x,
                aabb.min.z,
                aabb.max.x - aabb.min.x,
                aabb.max.z - aabb.min.z,
                aabb.min.y,
            );
            if support_ratio < MIN_SUPPORT_RATIO {
                had_no_support = true;
                continue;
            }

            let placement = PlacedCargo {
                instance_id,
                cargo_def_id: def.id.clone(),
                position_cm: pos,
                rotation_deg: c.rot,
            };

            let group_centroid = group_centroids.and_then(|gc| gc.get(&def.id));

            let s = score_placement(
                &placement,
                def,
                container,
                running_cog.total_weight,
                running_cog.cog_x,
                running_cog.cog_y,
                running_cog.cog_z,
                support_ratio,
                weights,
                group_centroid,
            );

            scored_candidates.push(ScoredCandidate {
                placement,
                aabb,
                score: s,
            });
        }
    }

    if scored_candidates.is_empty() {
        return TryPlaceResult::Failed {
            failure_reason: pick_failure_reason(
                def,
                had_orientation_fit,
                had_candidate_position,
                had_stack_constraint,
                had_no_support,
                had_collision,
                had_out_of_bounds,
            ),
        };
    }

    scored_candidates.sort_by(|a, b| a.score.partial_cmp(&b.score).unwrap());

    for cand in &scored_candidates {
        if let Some(ref mut ctx) = stack_ctx.as_deref_mut() {
            let violations = check_stack_incremental(ctx, &cand.placement, def);
            if !violations.is_empty() {
                had_stack_constraint = true;
                continue;
            }
        }

        // Success — mutate shared state
        occ_map.mark_aabb(&cand.aabb);
        placed_aabbs.push(cand.aabb);
        if let Some(ref mut ctx) = stack_ctx.as_deref_mut() {
            add_to_stack_context(ctx, &cand.placement, def);
        }
        let center = get_placement_center(&cand.placement, def);
        running_cog.total_weight += def.weight_kg;
        running_cog.cog_x += center.x * def.weight_kg;
        running_cog.cog_y += center.y * def.weight_kg;
        running_cog.cog_z += center.z * def.weight_kg;

        return TryPlaceResult::Placed {
            placement: cand.placement.clone(),
            aabb: cand.aabb,
        };
    }

    TryPlaceResult::Failed {
        failure_reason: pick_failure_reason(
            def,
            had_orientation_fit,
            had_candidate_position,
            had_stack_constraint,
            had_no_support,
            had_collision,
            had_out_of_bounds,
        ),
    }
}

// ─── Sorting ────────────────────────────────────────────────────

fn sort_for_strategy(
    items: &[CargoItemDef],
    strategy: PackStrategy,
    container: &ContainerDef,
) -> Vec<CargoItemDef> {
    let mut sorted = items.to_vec();
    if strategy == PackStrategy::Lff {
        // Less Flexibility First
        let mut flex_cache: HashMap<String, usize> = HashMap::new();
        let get_flexibility = |def: &CargoItemDef, cache: &mut HashMap<String, usize>| -> usize {
            if let Some(&v) = cache.get(&def.id) {
                return v;
            }
            let flex = get_orientation_candidates(def)
                .iter()
                .filter(|c| {
                    c.eff_w <= container.width_cm
                        && c.eff_h <= container.height_cm
                        && c.eff_d <= container.depth_cm
                })
                .count();
            cache.insert(def.id.clone(), flex);
            flex
        };

        // Pre-compute flexibility for all items
        for item in &sorted {
            get_flexibility(item, &mut flex_cache);
        }

        sorted.sort_by(|a, b| {
            // noStack items last
            let ns_a = if a.no_stack == Some(true) { 1 } else { 0 };
            let ns_b = if b.no_stack == Some(true) { 1 } else { 0 };
            if ns_a != ns_b {
                return ns_a.cmp(&ns_b);
            }
            let flex_a = *flex_cache.get(&a.id).unwrap();
            let flex_b = *flex_cache.get(&b.id).unwrap();
            if flex_a != flex_b {
                return flex_a.cmp(&flex_b);
            }
            let vol_a = a.width_cm * a.height_cm * a.depth_cm;
            let vol_b = b.width_cm * b.height_cm * b.depth_cm;
            if vol_a != vol_b {
                return vol_b.partial_cmp(&vol_a).unwrap();
            }
            a.id.cmp(&b.id)
        });
    } else {
        // default / layer / wall: volume descending, noStack items last
        sorted.sort_by(|a, b| {
            let ns_a = if a.no_stack == Some(true) { 1 } else { 0 };
            let ns_b = if b.no_stack == Some(true) { 1 } else { 0 };
            if ns_a != ns_b {
                return ns_a.cmp(&ns_b);
            }
            let vol_a = a.width_cm * a.height_cm * a.depth_cm;
            let vol_b = b.width_cm * b.height_cm * b.depth_cm;
            vol_b.partial_cmp(&vol_a).unwrap()
        });
    }
    sorted
}

// ─── Single-pass packing ────────────────────────────────────────

fn auto_pack_single_pass(
    items: &[CargoItemDef],
    container: &ContainerDef,
    start_instance_id: u32,
    weights: &ScoreWeights,
    base_occ_map: Option<&OccupancyMap>,
    existing_placements: &[PlacedCargo],
    existing_cargo_defs: &[CargoItemDef],
    deadline: Option<Instant>,
) -> PackResult {
    let mut placements = Vec::new();
    let mut failed_def_ids = Vec::new();
    let mut failure_reasons = Vec::new();

    let mut occ_map = match base_occ_map {
        Some(base) => base.clone_map(),
        None => OccupancyMap::new_default(
            container.width_cm,
            container.height_cm,
            container.depth_cm,
        ),
    };

    let mut next_id = start_instance_id;
    let mut all_defs_vec: Vec<CargoItemDef> = existing_cargo_defs.to_vec();
    all_defs_vec.extend_from_slice(items);
    let all_defs = dedupe_defs(&all_defs_vec);
    let mut placed_aabbs = build_aabb_list(existing_placements, &all_defs);

    let has_any_stack_constraints = all_defs
        .iter()
        .any(|d| d.no_stack == Some(true) || d.max_stack_weight_kg.is_some());

    let mut stack_ctx = if has_any_stack_constraints {
        Some(build_stack_context(existing_placements, &all_defs))
    } else {
        None
    };

    let mut running_cog = RunningCog {
        total_weight: 0.0,
        cog_x: 0.0,
        cog_y: 0.0,
        cog_z: 0.0,
    };

    // Initialize running COG from existing placements
    for p in existing_placements {
        if let Some(def) = all_defs.iter().find(|d| d.id == p.cargo_def_id) {
            let center = get_placement_center(p, def);
            running_cog.total_weight += def.weight_kg;
            running_cog.cog_x += center.x * def.weight_kg;
            running_cog.cog_y += center.y * def.weight_kg;
            running_cog.cog_z += center.z * def.weight_kg;
        }
    }

    // Build group centroids from existing placements
    let mut group_centroids: Option<HashMap<String, GroupCentroid>> =
        if weights.grouping > 0.0 {
            let mut gc = HashMap::new();
            for p in existing_placements {
                if let Some(def) = all_defs.iter().find(|d| d.id == p.cargo_def_id) {
                    update_group_centroids(&mut gc, p, def);
                }
            }
            Some(gc)
        } else {
            None
        };

    // Build orientation cache
    let mut orientation_cache: HashMap<String, Vec<OrientationCandidate>> = HashMap::new();

    for def in items {
        if let Some(dl) = deadline {
            if Instant::now() > dl {
                failed_def_ids.push(def.id.clone());
                failure_reasons.push(PackFailureReason {
                    cargo_def_id: def.id.clone(),
                    cargo_name: def.name.clone(),
                    code: PackFailureCode::NoFeasiblePosition,
                    detail: "Auto-pack timed out.".to_string(),
                });
                continue;
            }
        }

        let cached_orientations = orientation_cache
            .entry(def.id.clone())
            .or_insert_with(|| get_orientation_candidates(def));

        let result = try_place_item(
            def,
            next_id,
            &mut occ_map,
            container,
            &mut placed_aabbs,
            stack_ctx.as_mut(),
            weights,
            group_centroids.as_ref(),
            &mut running_cog,
            deadline,
            None,
            Some(cached_orientations),
        );

        match result {
            TryPlaceResult::Placed { placement, .. } => {
                if let Some(ref mut gc) = group_centroids {
                    update_group_centroids(gc, &placement, def);
                }
                placements.push(placement);
                next_id += 1;
            }
            TryPlaceResult::Failed { failure_reason } => {
                failed_def_ids.push(def.id.clone());
                failure_reasons.push(failure_reason);
            }
        }
    }

    PackResult {
        placements,
        failed_def_ids,
        failure_reasons,
    }
}

// ─── Layer-building (repack only) ───────────────────────────────

fn auto_pack_layered(
    items: &[CargoItemDef],
    container: &ContainerDef,
    start_instance_id: u32,
    deadline: Option<Instant>,
) -> PackResult {
    let mut placements = Vec::new();
    let mut failed_def_ids = Vec::new();
    let mut failure_reasons = Vec::new();

    // 1. Group items by cargoDefId
    let mut group_map: HashMap<String, (CargoItemDef, u32)> = HashMap::new();
    for item in items {
        let entry = group_map
            .entry(item.id.clone())
            .or_insert_with(|| (item.clone(), 0));
        entry.1 += 1;
    }

    // 2. For each group, determine best orientation
    struct LayerGroup {
        def: CargoItemDef,
        count: u32,
        #[allow(dead_code)]
        best_orientation: OrientationCandidate,
        layer_height: f64,
    }

    let mut groups: Vec<LayerGroup> = Vec::new();
    for (_, (def, count)) in &group_map {
        let candidates = get_orientation_candidates(def);
        let mut fitting: Vec<OrientationCandidate> = candidates
            .into_iter()
            .filter(|c| {
                c.eff_w <= container.width_cm
                    && c.eff_h <= container.height_cm
                    && c.eff_d <= container.depth_cm
            })
            .collect();

        if fitting.is_empty() {
            for _ in 0..*count {
                failed_def_ids.push(def.id.clone());
                failure_reasons.push(PackFailureReason {
                    cargo_def_id: def.id.clone(),
                    cargo_name: def.name.clone(),
                    code: PackFailureCode::OutOfBounds,
                    detail:
                        "Item does not fit container dimensions in any allowed orientation."
                            .to_string(),
                });
            }
            continue;
        }

        // Best: min effH, then max bottom area
        fitting.sort_by(|a, b| {
            if a.eff_h != b.eff_h {
                return a.eff_h.partial_cmp(&b.eff_h).unwrap();
            }
            let area_b = b.eff_w * b.eff_d;
            let area_a = a.eff_w * a.eff_d;
            area_b.partial_cmp(&area_a).unwrap()
        });

        let best = fitting[0].clone();
        groups.push(LayerGroup {
            def: def.clone(),
            count: *count,
            best_orientation: best.clone(),
            layer_height: best.eff_h,
        });
    }

    // 3. Sort groups by layerHeight descending, noStack items last
    groups.sort_by(|a, b| {
        let ns_a = if a.def.no_stack == Some(true) { 1 } else { 0 };
        let ns_b = if b.def.no_stack == Some(true) { 1 } else { 0 };
        if ns_a != ns_b {
            return ns_a.cmp(&ns_b);
        }
        b.layer_height.partial_cmp(&a.layer_height).unwrap()
    });

    // 4. Build layers
    let mut occ_map =
        OccupancyMap::new_default(container.width_cm, container.height_cm, container.depth_cm);
    let mut next_id = start_instance_id;
    let all_defs = dedupe_defs(items);
    let mut placed_aabbs: Vec<AABB> = Vec::new();

    let has_any_stack_constraints = all_defs
        .iter()
        .any(|d| d.no_stack == Some(true) || d.max_stack_weight_kg.is_some());
    let mut stack_ctx = if has_any_stack_constraints {
        Some(build_stack_context(&[], &all_defs))
    } else {
        None
    };
    let mut running_cog = RunningCog {
        total_weight: 0.0,
        cog_x: 0.0,
        cog_y: 0.0,
        cog_z: 0.0,
    };

    let mut layer_y = 0.0_f64;

    // Build orientation cache
    let mut orientation_cache: HashMap<String, Vec<OrientationCandidate>> = HashMap::new();

    for group in &groups {
        if let Some(dl) = deadline {
            if Instant::now() > dl {
                for _ in 0..group.count {
                    failed_def_ids.push(group.def.id.clone());
                    failure_reasons.push(PackFailureReason {
                        cargo_def_id: group.def.id.clone(),
                        cargo_name: group.def.name.clone(),
                        code: PackFailureCode::NoFeasiblePosition,
                        detail: "Auto-pack timed out.".to_string(),
                    });
                }
                continue;
            }
        }

        // Check if layer fits
        if layer_y + group.layer_height > container.height_cm {
            for _ in 0..group.count {
                failed_def_ids.push(group.def.id.clone());
                failure_reasons.push(PackFailureReason {
                    cargo_def_id: group.def.id.clone(),
                    cargo_name: group.def.name.clone(),
                    code: PackFailureCode::NoFeasiblePosition,
                    detail: "No vertical space remaining for this layer.".to_string(),
                });
            }
            continue;
        }

        let layer_ceiling = layer_y + group.layer_height;

        // Filter orientations to those with effH <= layerHeight
        let all_candidates = orientation_cache
            .entry(group.def.id.clone())
            .or_insert_with(|| get_orientation_candidates(&group.def));
        let layer_candidates: Vec<OrientationCandidate> = all_candidates
            .iter()
            .filter(|c| {
                c.eff_h <= group.layer_height
                    && c.eff_w <= container.width_cm
                    && c.eff_d <= container.depth_cm
            })
            .cloned()
            .collect();

        for _ in 0..group.count {
            if let Some(dl) = deadline {
                if Instant::now() > dl {
                    failed_def_ids.push(group.def.id.clone());
                    failure_reasons.push(PackFailureReason {
                        cargo_def_id: group.def.id.clone(),
                        cargo_name: group.def.name.clone(),
                        code: PackFailureCode::NoFeasiblePosition,
                        detail: "Auto-pack timed out.".to_string(),
                    });
                    continue;
                }
            }

            let result = try_place_item(
                &group.def,
                next_id,
                &mut occ_map,
                container,
                &mut placed_aabbs,
                stack_ctx.as_mut(),
                &DEFAULT_WEIGHTS,
                None,
                &mut running_cog,
                deadline,
                Some(layer_ceiling),
                Some(&layer_candidates),
            );

            match result {
                TryPlaceResult::Placed { placement, .. } => {
                    placements.push(placement);
                    next_id += 1;
                }
                TryPlaceResult::Failed { failure_reason } => {
                    failed_def_ids.push(group.def.id.clone());
                    failure_reasons.push(failure_reason);
                }
            }
        }

        // Seal the layer
        occ_map.seal_to_height(layer_ceiling);
        layer_y = layer_ceiling;
    }

    PackResult {
        placements,
        failed_def_ids,
        failure_reasons,
    }
}

// ─── Wall-building (repack only) ────────────────────────────────

fn auto_pack_walled(
    items: &[CargoItemDef],
    container: &ContainerDef,
    start_instance_id: u32,
    deadline: Option<Instant>,
) -> PackResult {
    let mut placements = Vec::new();
    let mut failed_def_ids = Vec::new();
    let mut failure_reasons = Vec::new();

    // Track unplaced items
    struct UnplacedItem {
        def: CargoItemDef,
        idx: usize,
    }

    let mut unplaced: Vec<UnplacedItem> = items
        .iter()
        .enumerate()
        .map(|(idx, def)| UnplacedItem {
            def: def.clone(),
            idx,
        })
        .collect();

    let all_defs = dedupe_defs(items);
    let has_any_stack_constraints = all_defs
        .iter()
        .any(|d| d.no_stack == Some(true) || d.max_stack_weight_kg.is_some());
    let mut global_stack_ctx = if has_any_stack_constraints {
        Some(build_stack_context(&[], &all_defs))
    } else {
        None
    };
    let mut _global_running_cog = RunningCog {
        total_weight: 0.0,
        cog_x: 0.0,
        cog_y: 0.0,
        cog_z: 0.0,
    };
    let mut global_placed_aabbs: Vec<AABB> = Vec::new();

    let mut wall_x = 0.0_f64;
    let mut next_id = start_instance_id;

    // Orientation cache
    let mut orientation_cache: HashMap<String, Vec<OrientationCandidate>> = HashMap::new();

    while !unplaced.is_empty() && wall_x < container.width_cm {
        if let Some(dl) = deadline {
            if Instant::now() > dl {
                for u in &unplaced {
                    failed_def_ids.push(u.def.id.clone());
                    failure_reasons.push(PackFailureReason {
                        cargo_def_id: u.def.id.clone(),
                        cargo_name: u.def.name.clone(),
                        code: PackFailureCode::NoFeasiblePosition,
                        detail: "Auto-pack timed out.".to_string(),
                    });
                }
                break;
            }
        }

        // Select LDB using George-Robinson criteria
        let mut def_counts: HashMap<String, usize> = HashMap::new();
        for u in &unplaced {
            *def_counts.entry(u.def.id.clone()).or_insert(0) += 1;
        }

        let mut seen_defs: HashMap<String, usize> = HashMap::new();
        for (i, u) in unplaced.iter().enumerate() {
            seen_defs.entry(u.def.id.clone()).or_insert(i);
        }

        let mut ldb_idx: Option<usize> = None;
        let mut ldb_min_dim: f64 = -1.0;
        let mut ldb_count: usize = 0;
        let mut ldb_volume: f64 = -1.0;

        for (&ref def_id, &representative_idx) in &seen_defs {
            let d = &unplaced[representative_idx].def;
            let min_dim = d.width_cm.min(d.height_cm).min(d.depth_cm);
            let volume = d.width_cm * d.height_cm * d.depth_cm;
            let count = *def_counts.get(def_id).unwrap_or(&0);

            if min_dim > ldb_min_dim
                || (min_dim == ldb_min_dim && count > ldb_count)
                || (min_dim == ldb_min_dim && count == ldb_count && volume > ldb_volume)
            {
                ldb_min_dim = min_dim;
                ldb_count = count;
                ldb_volume = volume;
                ldb_idx = Some(representative_idx);
            }
        }

        let Some(ldb_idx) = ldb_idx else {
            break;
        };
        let ldb_def = unplaced[ldb_idx].def.clone();
        let ldb_def_id = ldb_def.id.clone();

        // Determine wallDepth from LDB's best X-thin orientation
        let ldb_candidates = orientation_cache
            .entry(ldb_def.id.clone())
            .or_insert_with(|| get_orientation_candidates(&ldb_def));
        let remaining_w = container.width_cm - wall_x;
        let mut fitting_ldb: Vec<OrientationCandidate> = ldb_candidates
            .iter()
            .filter(|c| {
                c.eff_w <= remaining_w
                    && c.eff_h <= container.height_cm
                    && c.eff_d <= container.depth_cm
            })
            .cloned()
            .collect();

        if fitting_ldb.is_empty() {
            // LDB doesn't fit in remaining space
            let removed_ids: Vec<String> = unplaced
                .iter()
                .filter(|u| u.def.id == ldb_def_id)
                .map(|u| u.def.id.clone())
                .collect();
            for id in &removed_ids {
                failed_def_ids.push(id.clone());
                failure_reasons.push(PackFailureReason {
                    cargo_def_id: id.clone(),
                    cargo_name: ldb_def.name.clone(),
                    code: PackFailureCode::NoFeasiblePosition,
                    detail: "LDB does not fit in remaining container width.".to_string(),
                });
            }
            unplaced.retain(|u| u.def.id != ldb_def_id);
            continue;
        }

        // Pick orientation with smallest effW (thinnest wall)
        fitting_ldb.sort_by(|a, b| a.eff_w.partial_cmp(&b.eff_w).unwrap());
        let mut wall_depth = fitting_ldb[0].eff_w;
        if wall_x + wall_depth > container.width_cm {
            wall_depth = container.width_cm - wall_x;
        }

        // Create wall-local OccupancyMap
        let wall_container = ContainerDef {
            width_cm: wall_depth,
            height_cm: container.height_cm,
            depth_cm: container.depth_cm,
            max_payload_kg: container.max_payload_kg,
        };
        let mut wall_occ_map = OccupancyMap::new_default(
            wall_depth,
            container.height_cm,
            container.depth_cm,
        );
        let mut wall_placed_aabbs: Vec<AABB> = Vec::new();
        let mut wall_stack_ctx = if has_any_stack_constraints {
            Some(build_stack_context(&[], &all_defs))
        } else {
            None
        };
        let mut wall_running_cog = RunningCog {
            total_weight: 0.0,
            cog_x: 0.0,
            cog_y: 0.0,
            cog_z: 0.0,
        };

        struct WallPlacement {
            placement: PlacedCargo,
            item_idx: usize,
        }
        let mut wall_placements: Vec<WallPlacement> = Vec::new();

        // Place LDB defId items first
        let ldb_items: Vec<usize> = unplaced
            .iter()
            .enumerate()
            .filter(|(_, u)| u.def.id == ldb_def_id)
            .map(|(i, _)| i)
            .collect();
        let non_ldb_items: Vec<usize> = unplaced
            .iter()
            .enumerate()
            .filter(|(_, u)| u.def.id != ldb_def_id)
            .map(|(i, _)| i)
            .collect();

        for &ui in &ldb_items {
            if let Some(dl) = deadline {
                if Instant::now() > dl {
                    break;
                }
            }

            let u = &unplaced[ui];
            let orientations: Vec<OrientationCandidate> = orientation_cache
                .entry(u.def.id.clone())
                .or_insert_with(|| get_orientation_candidates(&u.def))
                .iter()
                .filter(|c| {
                    c.eff_w <= wall_depth
                        && c.eff_h <= container.height_cm
                        && c.eff_d <= container.depth_cm
                })
                .cloned()
                .collect();
            if orientations.is_empty() {
                continue;
            }

            let result = try_place_item(
                &u.def,
                next_id,
                &mut wall_occ_map,
                &wall_container,
                &mut wall_placed_aabbs,
                wall_stack_ctx.as_mut(),
                &DEFAULT_WEIGHTS,
                None,
                &mut wall_running_cog,
                deadline,
                None,
                Some(&orientations),
            );

            if let TryPlaceResult::Placed { placement, .. } = result {
                wall_placements.push(WallPlacement {
                    placement,
                    item_idx: u.idx,
                });
                next_id += 1;
            }
        }

        // Try remaining items
        let fittable_non_ldb: Vec<usize> = non_ldb_items
            .iter()
            .filter(|&&i| {
                let u = &unplaced[i];
                let min_dim = u.def.width_cm.min(u.def.height_cm).min(u.def.depth_cm);
                min_dim <= wall_depth
            })
            .copied()
            .collect();

        for &ui in &fittable_non_ldb {
            if let Some(dl) = deadline {
                if Instant::now() > dl {
                    break;
                }
            }

            let u = &unplaced[ui];
            let orientations: Vec<OrientationCandidate> = orientation_cache
                .entry(u.def.id.clone())
                .or_insert_with(|| get_orientation_candidates(&u.def))
                .iter()
                .filter(|c| {
                    c.eff_w <= wall_depth
                        && c.eff_h <= container.height_cm
                        && c.eff_d <= container.depth_cm
                })
                .cloned()
                .collect();
            if orientations.is_empty() {
                continue;
            }

            let result = try_place_item(
                &u.def,
                next_id,
                &mut wall_occ_map,
                &wall_container,
                &mut wall_placed_aabbs,
                wall_stack_ctx.as_mut(),
                &DEFAULT_WEIGHTS,
                None,
                &mut wall_running_cog,
                deadline,
                None,
                Some(&orientations),
            );

            if let TryPlaceResult::Placed { placement, .. } = result {
                wall_placements.push(WallPlacement {
                    placement,
                    item_idx: u.idx,
                });
                next_id += 1;
            }
        }

        // Convert wall-local placements to global coordinates
        let mut placed_idx_set = HashSet::new();
        for wp in &wall_placements {
            placed_idx_set.insert(wp.item_idx);

            let global_pos = Vec3::new(
                wp.placement.position_cm.x + wall_x,
                wp.placement.position_cm.y,
                wp.placement.position_cm.z,
            );

            let global_placement = PlacedCargo {
                instance_id: wp.placement.instance_id,
                cargo_def_id: wp.placement.cargo_def_id.clone(),
                position_cm: global_pos,
                rotation_deg: wp.placement.rotation_deg,
            };

            let def = &items[wp.item_idx];
            let global_aabb = compute_cargo_aabb_for_placement(def, global_pos, wp.placement.rotation_deg);

            placements.push(global_placement.clone());
            global_placed_aabbs.push(global_aabb);
            if let Some(ref mut ctx) = global_stack_ctx {
                add_to_stack_context(ctx, &global_placement, def);
            }

            let center = get_placement_center(&global_placement, def);
            _global_running_cog.total_weight += def.weight_kg;
            _global_running_cog.cog_x += center.x * def.weight_kg;
            _global_running_cog.cog_y += center.y * def.weight_kg;
            _global_running_cog.cog_z += center.z * def.weight_kg;
        }

        // Remove placed items from unplaced list
        unplaced.retain(|u| !placed_idx_set.contains(&u.idx));

        // Advance wall position
        wall_x += wall_depth;
    }

    // Remaining unplaced items
    for u in &unplaced {
        failed_def_ids.push(u.def.id.clone());
        failure_reasons.push(PackFailureReason {
            cargo_def_id: u.def.id.clone(),
            cargo_name: u.def.name.clone(),
            code: PackFailureCode::NoFeasiblePosition,
            detail: "Could not fit in any wall.".to_string(),
        });
    }

    PackResult {
        placements,
        failed_def_ids,
        failure_reasons,
    }
}

// ─── Main dispatcher ────────────────────────────────────────────

pub struct AutoPackContext<'a> {
    pub existing_placements: &'a [PlacedCargo],
    pub existing_cargo_defs: &'a [CargoItemDef],
}

/// Main entry point for auto-packing.
pub fn auto_pack(
    items: &[CargoItemDef],
    container: &ContainerDef,
    start_instance_id: u32,
    base_occ_map: Option<&OccupancyMap>,
    context: Option<AutoPackContext<'_>>,
    deadline: Option<Instant>,
    strategy: PackStrategy,
) -> PackResult {
    let is_repack = base_occ_map.is_none();

    let existing_placements = context
        .as_ref()
        .map(|c| c.existing_placements)
        .unwrap_or(&[]);
    let existing_cargo_defs = context
        .as_ref()
        .map(|c| c.existing_cargo_defs)
        .unwrap_or(&[]);

    match strategy {
        PackStrategy::Layer => {
            if is_repack {
                return auto_pack_layered(items, container, start_instance_id, deadline);
            }
            // pack_staged fallback: default pass with grouping weights
            let sorted = sort_for_strategy(items, PackStrategy::Default, container);
            auto_pack_single_pass(
                &sorted,
                container,
                start_instance_id,
                &GROUPING_FALLBACK_WEIGHTS,
                base_occ_map,
                existing_placements,
                existing_cargo_defs,
                deadline,
            )
        }
        PackStrategy::Wall => {
            if is_repack {
                return auto_pack_walled(items, container, start_instance_id, deadline);
            }
            let sorted = sort_for_strategy(items, PackStrategy::Default, container);
            auto_pack_single_pass(
                &sorted,
                container,
                start_instance_id,
                &GROUPING_FALLBACK_WEIGHTS,
                base_occ_map,
                existing_placements,
                existing_cargo_defs,
                deadline,
            )
        }
        PackStrategy::Lff => {
            let sorted = sort_for_strategy(items, PackStrategy::Lff, container);
            auto_pack_single_pass(
                &sorted,
                container,
                start_instance_id,
                &LFF_WEIGHTS,
                base_occ_map,
                existing_placements,
                existing_cargo_defs,
                deadline,
            )
        }
        PackStrategy::Default => {
            let sorted = sort_for_strategy(items, PackStrategy::Default, container);
            auto_pack_single_pass(
                &sorted,
                container,
                start_instance_id,
                &DEFAULT_WEIGHTS,
                base_occ_map,
                existing_placements,
                existing_cargo_defs,
                deadline,
            )
        }
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

    fn make_container() -> ContainerDef {
        ContainerDef {
            width_cm: 590.0,
            height_cm: 239.0,
            depth_cm: 235.0,
            max_payload_kg: 28200.0,
        }
    }

    #[test]
    fn test_empty_items() {
        let container = make_container();
        let result = auto_pack(&[], &container, 1, None, None, None, PackStrategy::Default);
        assert!(result.placements.is_empty());
        assert!(result.failed_def_ids.is_empty());
    }

    #[test]
    fn test_single_item() {
        let container = make_container();
        let def = make_def("box1", 100.0, 50.0, 100.0, 10.0);
        let result = auto_pack(
            &[def],
            &container,
            1,
            None,
            None,
            None,
            PackStrategy::Default,
        );
        assert_eq!(result.placements.len(), 1);
        assert_eq!(result.placements[0].instance_id, 1);
        assert_eq!(result.placements[0].position_cm.x, 0.0);
        assert_eq!(result.placements[0].position_cm.y, 0.0);
        assert_eq!(result.placements[0].position_cm.z, 0.0);
    }

    #[test]
    fn test_item_too_large() {
        let container = make_container();
        let def = make_def("huge", 1000.0, 1000.0, 1000.0, 10.0);
        let result = auto_pack(
            &[def],
            &container,
            1,
            None,
            None,
            None,
            PackStrategy::Default,
        );
        assert!(result.placements.is_empty());
        assert_eq!(result.failed_def_ids.len(), 1);
    }

    #[test]
    fn test_multiple_items_stack() {
        let container = make_container();
        let def = make_def("box", 100.0, 50.0, 100.0, 10.0);
        let items: Vec<CargoItemDef> = (0..3).map(|_| def.clone()).collect();
        let result = auto_pack(
            &items,
            &container,
            1,
            None,
            None,
            None,
            PackStrategy::Default,
        );
        assert_eq!(result.placements.len(), 3);
    }

    #[test]
    fn test_no_flip_orientations() {
        let mut def = make_def("noflip", 100.0, 200.0, 50.0, 10.0);
        def.no_flip = Some(true);
        let candidates = get_orientation_candidates(&def);
        // noFlip should only have Y-axis rotations
        for c in &candidates {
            assert_eq!(c.rot.x, 0.0);
            assert_eq!(c.rot.z, 0.0);
        }
    }

    #[test]
    fn test_orientation_dedup() {
        // Cube: all orientations produce same AABB, should dedup to 1
        let def = make_def("cube", 100.0, 100.0, 100.0, 10.0);
        let candidates = get_orientation_candidates(&def);
        assert_eq!(candidates.len(), 1);
    }

    #[test]
    fn test_layer_strategy() {
        let container = make_container();
        let def = make_def("box", 100.0, 50.0, 100.0, 10.0);
        let items: Vec<CargoItemDef> = (0..5).map(|_| def.clone()).collect();
        let result = auto_pack(
            &items,
            &container,
            1,
            None,
            None,
            None,
            PackStrategy::Layer,
        );
        assert_eq!(result.placements.len(), 5);
    }

    #[test]
    fn test_wall_strategy() {
        let container = make_container();
        let def = make_def("box", 100.0, 50.0, 100.0, 10.0);
        let items: Vec<CargoItemDef> = (0..5).map(|_| def.clone()).collect();
        let result = auto_pack(
            &items,
            &container,
            1,
            None,
            None,
            None,
            PackStrategy::Wall,
        );
        assert_eq!(result.placements.len(), 5);
    }

    #[test]
    fn test_lff_strategy() {
        let container = make_container();
        let def = make_def("box", 100.0, 50.0, 100.0, 10.0);
        let items: Vec<CargoItemDef> = (0..5).map(|_| def.clone()).collect();
        let result = auto_pack(
            &items,
            &container,
            1,
            None,
            None,
            None,
            PackStrategy::Lff,
        );
        assert_eq!(result.placements.len(), 5);
    }

    #[test]
    fn test_pack_staged() {
        let container = make_container();
        let def1 = make_def("box1", 100.0, 50.0, 100.0, 10.0);
        let existing = vec![PlacedCargo {
            instance_id: 1,
            cargo_def_id: "box1".to_string(),
            position_cm: Vec3::zero(),
            rotation_deg: Vec3::zero(),
        }];

        let occ_map =
            OccupancyMap::from_placements(&existing, &[def1.clone()], &container);

        let def2 = make_def("box2", 80.0, 40.0, 80.0, 5.0);
        let result = auto_pack(
            &[def2.clone()],
            &container,
            2,
            Some(&occ_map),
            Some(AutoPackContext {
                existing_placements: &existing,
                existing_cargo_defs: &[def1],
            }),
            None,
            PackStrategy::Default,
        );
        assert_eq!(result.placements.len(), 1);
        assert_eq!(result.placements[0].instance_id, 2);
    }
}
